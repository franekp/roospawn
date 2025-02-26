import * as vscode from 'vscode';
import { v4 as uuidv4 } from 'uuid';
import { ClineController, type Message } from './cline_controller';

type TaskStatus = 'queued' | 'active' | 'completed' | 'paused' | 'deleted';

export class Task {
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
                task_dozer._paused_tasks.push(this);
                task_dozer._queued_tasks = task_dozer._queued_tasks.filter(t => t !== this);
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
                task_dozer._queued_tasks.push(this);
                task_dozer._paused_tasks = task_dozer._paused_tasks.filter(t => t !== this);
                task_dozer.schedule_ui_repaint();
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
            task_dozer._queued_tasks = task_dozer._queued_tasks.filter(t => t !== this);
            task_dozer._paused_tasks = task_dozer._paused_tasks.filter(t => t !== this);
            task_dozer._completed_tasks = task_dozer._completed_tasks.filter(t => t !== this);
            task_dozer.schedule_ui_repaint();
        }
    }

    remove() { this.delete(); }
}

export class TaskDozerStatus {
    public mime_type = 'application/x-taskdozer-status';
    constructor(public html: string) {}
}

let task_dozer: TaskDozer | undefined;

export class TaskDozer {
    _queued_tasks: Task[] = [];
    _active_task: Task | undefined;
    _completed_tasks: Task[] = [];
    _paused_tasks: Task[] = [];

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
                    [...this._queued_tasks].forEach(task => task.pause());
                    this.outputChannel.appendLine('Paused all tasks');
                })
            );
            // Register command to resume all tasks
            extensionContext.subscriptions.push(
                vscode.commands.registerCommand('taskdozer.resumeAllTasks', () => {
                    [...this._paused_tasks].forEach(task => task.resume());
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
                    html: this.render_status_html()
                });
            })
        );
    }

    private async worker() {
        while (true) {
            if (this._queued_tasks.length === 0) {
                await new Promise<void>(resolve => { this.wakeupWorker = resolve; });
                this.wakeupWorker = undefined;
                continue;
            }

            try {
                const rx = await this._clineController.run(() => {
                    const task = this._queued_tasks.shift();
                    if (task === undefined) {
                        return;
                    }

                    this._active_task = task;
                    this.schedule_ui_repaint();
                    return task;
                });

                if (rx === undefined) {
                    // `this._queued_tasks.shift()` returned undefined
                    continue;
                }

                for await (const msg of rx) {
                    this._active_task!.conversation.push(msg);
                }
            } catch {
                console.error('Error running task', this._active_task);
            }

            if (this._active_task !== undefined) {
                this._completed_tasks.push(this._active_task);
                this._active_task = undefined;
            }
            this.schedule_ui_repaint();
        }
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
        this._queued_tasks.push(task);
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
        return [...this._queued_tasks];
    }

    active_task(): Task | undefined {
        return this._active_task;
    }

    completed_tasks(): Task[] {
        return [...this._completed_tasks];
    }

    paused_tasks(): Task[] {
        return [...this._paused_tasks];
    }

    status(): TaskDozerStatus {
        return new TaskDozerStatus(this.render_status_html());
    }

    async showRooCodeSidebar(): Promise<void> {
        await vscode.commands.executeCommand('workbench.view.extension.roo-cline-ActivityBar');
    }

    render_status_html(): string {
        const styles = `
            <style>
                .task-container { font-family: system-ui; margin: 4px 0; }
                .task { padding: 4px 8px; border-radius: 4px; }
                .task-id { font-size: 0.8em; opacity: 0.7; }
                .task-prompt { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 300px; display: inline-block; }
                .active { 
                    background: linear-gradient(270deg, #ff9933, #ffb366);
                    background-size: 200% 100%;
                    color: white;
                    animation: gradient 2s ease infinite;
                }
                @keyframes gradient {
                    0% { background-position: 0% 50%; }
                    50% { background-position: 100% 50%; }
                    100% { background-position: 0% 50%; }
                }
                .queued { background: #ffff00; color: black; }
                .completed { background: #008080; color: white; }
                .paused { background: #808080; color: white; }
            </style>
        `;

        const renderTask = (task: Task, status: string) => {
            return `
                <div class="task-container">
                    <div class="task ${status}">
                        <span class="task-id">#${task.id}</span>
                        <span class="task-prompt">${task.prompt}</span>
                    </div>
                </div>
            `;
        };

        const sections = [];

        // Active task
        if (this._active_task) {
            sections.push(renderTask(this._active_task, 'active'));
        }

        // Queued tasks
        this._queued_tasks.forEach(task => {
            sections.push(renderTask(task, 'queued'));
        });

        // Completed tasks
        this._completed_tasks.forEach(task => {
            sections.push(renderTask(task, 'completed'));
        });

        // Paused tasks
        this._paused_tasks.forEach(task => {
            sections.push(renderTask(task, 'paused'));
        });

        return styles + sections.join('');
    }
}