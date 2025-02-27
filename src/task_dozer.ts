import * as vscode from 'vscode';
import { v4 as uuidv4 } from 'uuid';
import { ClineController, type Message } from './cline_controller';
import { ITask, TaskStatus } from './shared';

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
}

export class TaskDozerStatus {
    public mime_type = 'application/x-taskdozer-status';
    constructor(public tasks: ITask[]) {}
}

let task_dozer: TaskDozer | undefined;

export class TaskDozer {
    tasks: Task[] = [];
    activeTask: Task | undefined;

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
                    type: 'status_updated',
                    tasks: [...this.tasks],
                });
            })
        );
        messageChannel.onDidReceiveMessage(evt => {
            const msg = evt.message;

            if (msg.type === 'pauseTask') {
                this.tasks.find(t => t.id === msg.id)?.pause();
            }
            if (msg.type === 'resumeTask') {
                this.tasks.find(t => t.id === msg.id)?.resume();
            }
        });
    }

    private async worker() {
        while (true) {
            if (this.getFirstQueuedTask() === undefined) {
                await new Promise<void>(resolve => { this.wakeupWorker = resolve; });
                this.wakeupWorker = undefined;
                continue;
            }

            try {
                const rx = await this._clineController.run(() => {
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
                    // There is no queued task (probably one was deleted or paused),
                    // so we need to wait for the next one.
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

    status(): TaskDozerStatus {
        return new TaskDozerStatus([...this.tasks]);
    }

    async showRooCodeSidebar(): Promise<void> {
        await vscode.commands.executeCommand('workbench.view.extension.roo-cline-ActivityBar');
    }
}
