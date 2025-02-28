import * as vscode from 'vscode';
import { v4 as uuidv4 } from 'uuid';
import { ClineController, type Message } from './cline_controller';
import { ITask, MessageFromRenderer, MessageToRenderer, RendererInitializationData, TaskStatus } from './shared';

export class Task implements ITask {
    id: string;
    prompt: string;
    cmd_before: string | undefined;
    cmd_after: string | undefined;
    conversation: Message[] = [];
    status: TaskStatus = 'queued';

    constructor(prompt: string, cmd_before?: string, cmd_after?: string) {
        this.id = uuidv4().slice(0, 8);
        this.prompt = prompt;
        this.cmd_before = cmd_before;
        this.cmd_after = cmd_after;
    }

    pause() {
        if (this.status === 'active') {
            throw new Error('Task is already active');
        }
        if (this.status === 'paused') { return; }
        if (this.status === 'completed') { return; }
        if (this.status === 'queued') {
            this.status = 'paused';
            if (task_dozer) {
                task_dozer.schedule_ui_repaint();
            }
        }
    }

    cancel() { this.pause(); }
    stop() { this.pause(); }

    resume() {
        if (this.status === 'active') { return; }
        if (this.status === 'paused') {
            this.status = 'queued';
            if (task_dozer) {
                task_dozer.schedule_ui_repaint();
                task_dozer.wakeupWorker?.();
            }
        }
        if (this.status === 'completed') { return; }
        if (this.status === 'queued') { return; }
    }

    delete() {
        if (this.status === 'active') {
            throw new Error('Cannot delete active task');
        }
        this.status = 'deleted';
        if (task_dozer) {
            task_dozer.tasks = task_dozer.tasks.filter(t => t !== this);
            task_dozer.schedule_ui_repaint();
        }
    }

    remove() { this.delete(); }

    move_up() {
        if(!task_dozer) { return; }
        const index = task_dozer.tasks.indexOf(this);
        if(index === -1) { throw new Error("Task not found on the task list"); }
        if(index === 0) { return; }
        task_dozer.tasks[index] = task_dozer.tasks[index - 1];
        task_dozer.tasks[index - 1] = this;
        task_dozer.schedule_ui_repaint();
    }
    
    move_down() {
        if(!task_dozer) { return; }
        const index = task_dozer.tasks.indexOf(this);
        if(index === -1) { throw new Error("Task not found on the task list"); }
        if(index === task_dozer.tasks.length - 1) { return; }
        task_dozer.tasks[index] = task_dozer.tasks[index + 1];
        task_dozer.tasks[index + 1] = this;
        task_dozer.schedule_ui_repaint();
    }

    move_to_top() {
        if(!task_dozer) { return; }
        const index = task_dozer.tasks.indexOf(this);
        if(index === -1) { throw new Error("Task not found on the task list"); }
        if(index === 0) { return; }
        task_dozer.tasks.splice(index, 1);
        task_dozer.tasks.unshift(this);
        task_dozer.schedule_ui_repaint();
    }

    move_to_bottom() {
        if(!task_dozer) { return; }
        const index = task_dozer.tasks.indexOf(this);
        if(index === -1) { throw new Error("Task not found on the task list"); }
        if(index === task_dozer.tasks.length - 1) { return; }
        task_dozer.tasks.splice(index, 1);
        task_dozer.tasks.push(this);
        task_dozer.schedule_ui_repaint();
    }
}

export class TaskDozerStatus implements RendererInitializationData {
    public mime_type = 'application/x-taskdozer-status';
    constructor(public tasks: ITask[], public enabled: boolean) {}
}

let task_dozer: TaskDozer | undefined;

export class TaskDozer {
    tasks: Task[] = [];
    activeTask: Task | undefined;
    enabled: boolean = true;

    _tasks_updated: vscode.EventEmitter<void> = new vscode.EventEmitter<void>();
    tasks_updated: vscode.Event<void> = this._tasks_updated.event;

    wakeupWorker?: () => void;

    constructor(
        private readonly extensionContext: vscode.ExtensionContext,
        private readonly outputChannel: vscode.OutputChannel,
        private readonly _clineController: ClineController
    ) {
        this.worker();
        this.outputChannel.appendLine('TaskDozer initialized');
        task_dozer = this;
        {
            // Register command to pause all tasks
            extensionContext.subscriptions.push(
                vscode.commands.registerCommand('taskdozer.pauseAllTasks', () => {
                    [...this.tasks].filter(t => t.status === 'queued').forEach(task => task.pause());
                    this.outputChannel.appendLine('Paused all tasks');
                })
            );
            // Register command to resume all tasks
            extensionContext.subscriptions.push(
                vscode.commands.registerCommand('taskdozer.resumeAllTasks', () => {
                    [...this.tasks].filter(t => t.status === 'paused').forEach(task => task.resume());
                    this.outputChannel.appendLine('Resumed all tasks');
                })
            );
        }
        // Set up renderer messaging
        const messageChannel = vscode.notebooks.createRendererMessaging('taskdozer-status-renderer');
        this.extensionContext.subscriptions.push(
            this.tasks_updated(async () => {
                await messageChannel.postMessage({
                    type: 'statusUpdated',
                    tasks: [...this.tasks],
                    enabled: this.enabled,
                } as MessageToRenderer);
            })
        );
        messageChannel.onDidReceiveMessage(evt => {
            const msg = evt.message as MessageFromRenderer;

            switch (msg.type) {
                case 'enable':
                    this.enable();
                    return;
                case 'disable':
                    this.disable();
                    return;
                default:
                    break;
            }

            const task = this.tasks.find(t => t.id === msg.id);
            switch (msg.type) {
                case 'pause':
                    task?.pause();
                    break;
                case 'resume':
                    task?.resume();
                    break;
                case 'delete':
                    task?.delete();
                    break;
                case 'moveUp':
                    task?.move_up();
                    break;
                case 'moveDown':
                    task?.move_down();
                    break;
                case 'moveToTop':
                    task?.move_to_top();
                    break;
                case 'moveToBottom':
                    task?.move_to_bottom();
                    break;
            }
        });
    }

    private async worker() {
        while (true) {
            while (!this.enabled || this.getFirstQueuedTask() === undefined) {
                await new Promise<void>(resolve => { this.wakeupWorker = resolve; });
                this.wakeupWorker = undefined;
            }

            try {
                const rx = await this._clineController.run(() => {
                    if (!this.enabled) {
                        return;
                    }
                    const task = this.getFirstQueuedTask();
                    if (task === undefined) {
                        return;
                    }
                    task.status = 'active';

                    this.activeTask = task;
                    this.schedule_ui_repaint();
                    return task;
                });

                if (rx === undefined) {
                    // There is no queued task (probably one was deleted or paused)
                    // or TaskDozer is disabled, so we need to wait more.
                    continue;
                }

                for await (const msg of rx) {
                    this.activeTask!.conversation.push(msg);
                }
            } catch {
                console.error('Error running task', this.activeTask);
            }

            if (this.activeTask !== undefined) {
                this.activeTask.status = 'completed';
                this.activeTask = undefined;
            }
            this.schedule_ui_repaint();
        }
    }

    private getFirstQueuedTask(): Task | undefined {
        return this.tasks.find(t => t.status === 'queued');
    }

    schedule_ui_repaint() {
        setTimeout(() => {
            // quick fix for some race condition with sending notebook outputs
            this._tasks_updated.fire();
        }, 100);
        setTimeout(() => {
            // quick fix for some race condition with sending notebook outputs
            this._tasks_updated.fire();
        }, 500);
        setTimeout(() => {
            // quick fix for some race condition with sending notebook outputs
            this._tasks_updated.fire();
        }, 1500);
    }

    add_task(prompt: string, cmd_before: string | undefined, cmd_after: string | undefined, fire_event: boolean = true): Task {
        this.showRooCodeSidebar();
        const task = new Task(prompt, cmd_before, cmd_after);
        this.tasks.push(task);
        if (fire_event) {
            this.schedule_ui_repaint();
            this.wakeupWorker?.();
        }
        return task;
    }

    add_tasks(tasks: string[], cmd_before: string | undefined, cmd_after: string | undefined): Task[] {
        this.showRooCodeSidebar();
        const result = [...tasks].map(prompt => this.add_task(prompt, cmd_before, cmd_after, false));
        this.schedule_ui_repaint();
        this.wakeupWorker?.();
        return result;
    }

    queued_tasks(): Task[] {
        return this.tasks.filter(t => t.status === 'queued');
    }

    active_task(): Task | undefined {
        return this.activeTask;
    }

    completed_tasks(): Task[] {
        return this.tasks.filter(t => t.status === 'completed');
    }

    paused_tasks(): Task[] {
        return this.tasks.filter(t => t.status === 'paused');
    }

    enable() {
        this.enabled = true;
        this.wakeupWorker?.();
        this.schedule_ui_repaint();
    }

    disable() {
        this.enabled = false;
        this.schedule_ui_repaint();
    }

    status(): TaskDozerStatus {
        return new TaskDozerStatus([...this.tasks], this.enabled);
    }

    async showRooCodeSidebar(): Promise<void> {
        await vscode.commands.executeCommand('workbench.view.extension.roo-cline-ActivityBar');
    }
}
