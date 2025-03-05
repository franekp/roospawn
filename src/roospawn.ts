import * as vscode from 'vscode';
import { v4 as uuidv4 } from 'uuid';
import { ClineController, ExitReason, type Message } from './cline_controller';
import { ITask, MessageFromRenderer, MessageToRenderer, RendererInitializationData, TaskStatus } from './shared';
import { PromptSummarizer } from './prompt_summarizer';

export class Task implements ITask {
    id: string;
    prompt: string;
    summary: string[];
    cmd_before: string | undefined;
    cmd_after: string | undefined;
    conversation: Message[] = [];
    status: TaskStatus = 'queued';

    constructor(prompt: string, cmd_before?: string, cmd_after?: string) {
        this.id = uuidv4().slice(0, 8);
        this.prompt = prompt;
        this.cmd_before = cmd_before;
        this.cmd_after = cmd_after;

        const score = prompt_summarizer.score(prompt);
        this.summary = prompt_summarizer.summary(prompt, score, 30);
    }

    pause() {
        if (this.status === 'running') {
            throw new Error('Task is already running');
        }
        if (this.status === 'prepared') { return; }
        if (this.status === 'completed') { return; }
        if (this.status === 'queued') {
            this.status = 'prepared';
            if (roospawn) {
                roospawn.schedule_ui_repaint();
            }
        }
    }

    cancel() { this.pause(); }
    stop() { this.pause(); }

    resume() {
        if (this.status === 'running') { return; }
        if (this.status === 'prepared') {
            this.status = 'queued';
            if (roospawn) {
                roospawn.schedule_ui_repaint();
                roospawn.wakeupWorker?.();
            }
        }
        if (this.status === 'completed') { return; }
        if (this.status === 'queued') { return; }
    }

    delete() {
        if (this.status === 'running') {
            throw new Error('Cannot delete running task');
        }
        this.status = 'deleted';
        if (roospawn) {
            roospawn.tasks = roospawn.tasks.filter(t => t !== this);
            roospawn.schedule_ui_repaint();
        }
    }

    remove() { this.delete(); }

    move_up() {
        if(!roospawn) { return; }
        const index = roospawn.tasks.indexOf(this);
        if(index === -1) { throw new Error("Task not found on the task list"); }
        if(index === 0) { return; }
        roospawn.tasks[index] = roospawn.tasks[index - 1];
        roospawn.tasks[index - 1] = this;
        roospawn.schedule_ui_repaint();
    }
    
    move_down() {
        if(!roospawn) { return; }
        const index = roospawn.tasks.indexOf(this);
        if(index === -1) { throw new Error("Task not found on the task list"); }
        if(index === roospawn.tasks.length - 1) { return; }
        roospawn.tasks[index] = roospawn.tasks[index + 1];
        roospawn.tasks[index + 1] = this;
        roospawn.schedule_ui_repaint();
    }

    move_to_top() {
        if(!roospawn) { return; }
        const index = roospawn.tasks.indexOf(this);
        if(index === -1) { throw new Error("Task not found on the task list"); }
        if(index === 0) { return; }
        roospawn.tasks.splice(index, 1);
        roospawn.tasks.unshift(this);
        roospawn.schedule_ui_repaint();
    }

    move_to_bottom() {
        if(!roospawn) { return; }
        const index = roospawn.tasks.indexOf(this);
        if(index === -1) { throw new Error("Task not found on the task list"); }
        if(index === roospawn.tasks.length - 1) { return; }
        roospawn.tasks.splice(index, 1);
        roospawn.tasks.push(this);
        roospawn.schedule_ui_repaint();
    }

    conversation_as_json(): string {
        return JSON.stringify(this.conversation);
    }
}

export class RooSpawnStatus implements RendererInitializationData {
    public mime_type = 'application/x-roospawn-status';
    constructor(public tasks: ITask[], public enabled: boolean) {}
}

let roospawn: RooSpawn | undefined;
let prompt_summarizer: PromptSummarizer = new PromptSummarizer();

export class RooSpawn {
    tasks: Task[] = [];
    currentlyRunningTask: Task | undefined;
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
        this.outputChannel.appendLine('RooSpawn initialized');
        roospawn = this;
        {
            // Register command to pause all tasks
            extensionContext.subscriptions.push(
                vscode.commands.registerCommand('roospawn.pauseAllTasks', () => {
                    [...this.tasks].filter(t => t.status === 'queued').forEach(task => task.pause());
                    this.outputChannel.appendLine('prepared all tasks');
                })
            );
            // Register command to resume all tasks
            extensionContext.subscriptions.push(
                vscode.commands.registerCommand('roospawn.resumeAllTasks', () => {
                    [...this.tasks].filter(t => t.status === 'prepared').forEach(task => task.resume());
                    this.outputChannel.appendLine('Resumed all tasks');
                })
            );
        }
        // Set up renderer messaging
        const messageChannel = vscode.notebooks.createRendererMessaging('roospawn-status-renderer');
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

            let exit_reason: ExitReason;
            try {
                const rx = await this._clineController.run(() => {
                    if (!this.enabled) {
                        return;
                    }
                    const task = this.getFirstQueuedTask();
                    if (task === undefined) {
                        return;
                    }
                    task.status = 'running';

                    this.currentlyRunningTask = task;
                    this.schedule_ui_repaint();
                    return task;
                });

                if (rx === undefined) {
                    // There is no queued task (probably one was deleted or prepared)
                    // or RooSpawn is disabled, so we need to wait more.
                    continue;
                }

                let msg;
                while (!(msg = await rx.next()).done) {
                    this.currentlyRunningTask!.conversation.push(msg.value as Message);
                }
                exit_reason = msg.value as ExitReason;
            } catch {
                exit_reason = 'thrown-exception';
                console.error('Error running task', this.currentlyRunningTask);
            }

            if (this.currentlyRunningTask !== undefined) {
                this.currentlyRunningTask.status = exit_reason;
                this.currentlyRunningTask = undefined;
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

    add_task(prompt: string, cmd_before: string | undefined, cmd_after: string | undefined): Task {
        return this.add_tasks([prompt], cmd_before, cmd_after)[0];
    }

    add_tasks(tasks: string[], cmd_before: string | undefined, cmd_after: string | undefined): Task[] {
        this.showRooCodeSidebar();

        for (const prompt of tasks) {
            prompt_summarizer.insert(prompt);
        }

        const result = [...tasks].map(prompt => {
            const task = new Task(prompt, cmd_before, cmd_after);
            this.tasks.push(task);
            return task;
        });

        this.schedule_ui_repaint();
        this.wakeupWorker?.();
        return result;
    }

    queued_tasks(): Task[] {
        return this.tasks.filter(t => t.status === 'queued');
    }

    active_task(): Task | undefined {
        return this.currentlyRunningTask;
    }

    completed_tasks(): Task[] {
        return this.tasks.filter(t => t.status === 'completed');
    }

    prepared_tasks(): Task[] {
        return this.tasks.filter(t => t.status === 'prepared');
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

    status(): RooSpawnStatus {
        return new RooSpawnStatus([...this.tasks], this.enabled);
    }

    async showRooCodeSidebar(): Promise<void> {
        await vscode.commands.executeCommand('workbench.view.extension.roo-cline-ActivityBar');
    }
}
