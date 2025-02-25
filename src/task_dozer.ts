import * as vscode from 'vscode';
import { v4 as uuidv4 } from 'uuid';
type TaskStatus = 'queued' | 'active' | 'completed' | 'paused' | 'deleted';

export class Task {
    id: string;
    prompt: string;
    cmd_before: string | undefined;
    cmd_after: string | undefined;
    conversation: string[] = [];
    status: TaskStatus = 'queued';

    constructor(prompt: string, cmd_before: string | undefined, cmd_after: string | undefined) {
        this.id = uuidv4().slice(0, 8);
        this.prompt = prompt;
        this.cmd_before = cmd_before;
        this.cmd_after = cmd_after;
    }

    pause() {
        if (this.status == 'active') {
            throw new Error('Task is already active');
        }
        if (this.status == 'paused') return;
        if (this.status == 'completed') return;
        if (this.status == 'queued') {
            this.status = 'paused';
            if (task_dozer) {
                task_dozer._paused_tasks.push(this);
                task_dozer._queued_tasks = task_dozer._queued_tasks.filter(t => t !== this);
            }
        }
    }

    cancel() { this.pause(); }
    stop() { this.pause(); }

    resume() {
        if (this.status == 'active') return;
        if (this.status == 'paused') {
            this.status = 'queued';
            if (task_dozer) {
                task_dozer._queued_tasks.push(this);
                task_dozer._paused_tasks = task_dozer._paused_tasks.filter(t => t !== this);
            }
        }
        if (this.status == 'completed') return;
        if (this.status == 'queued') return;
    }

    delete() {
        if (this.status == 'active') {
            throw new Error('Cannot delete active task');
        }
        this.status = 'deleted';
        if (task_dozer) {
            task_dozer._queued_tasks = task_dozer._queued_tasks.filter(t => t !== this);
            task_dozer._paused_tasks = task_dozer._paused_tasks.filter(t => t !== this);
            task_dozer._completed_tasks = task_dozer._completed_tasks.filter(t => t !== this);
        }
    }

    remove() { this.delete(); }
}

let task_dozer: TaskDozer | undefined;

export class TaskDozer {
    _queued_tasks: Task[] = [];
    _active_task: Task | undefined;
    _completed_tasks: Task[] = [];
    _paused_tasks: Task[] = [];

    _tasks_updated: vscode.EventEmitter<void> = new vscode.EventEmitter<void>();
    tasks_updated: vscode.Event<void> = this._tasks_updated.event;

    constructor(
        private readonly extensionContext: vscode.ExtensionContext,
        private readonly outputChannel: vscode.OutputChannel
    ) {
        this.outputChannel.appendLine('TaskDozer initialized');
        task_dozer = this;
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
        // Register command to complete active task and pick next
        extensionContext.subscriptions.push(
            vscode.commands.registerCommand('taskdozer.completeActiveTask', () => {
                if (this._active_task) {
                    this._active_task.status = 'completed';
                    this._completed_tasks.push(this._active_task);
                    this._active_task = undefined;

                    // Pick next queued task if available
                    if (this._queued_tasks.length > 0) {
                        this._active_task = this._queued_tasks.shift();
                        this._active_task!.status = 'active';
                        this.outputChannel.appendLine(`Started task: ${this._active_task!.prompt}`);
                    }

                    this.outputChannel.appendLine('Completed active task');
                } else {
                    this.outputChannel.appendLine('No active task to complete');
                }
            })
        );
    }

    add_task(prompt: string, cmd_before: string | undefined, cmd_after: string | undefined, fire_event: boolean = true): Task {
        const task = new Task(prompt, cmd_before, cmd_after);
        this._queued_tasks.push(task);
        if (fire_event) {
            this._tasks_updated.fire();
        }
        return task;
    }

    add_tasks(tasks: string[], cmd_before: string | undefined, cmd_after: string | undefined): Task[] {
        const result = tasks.map(prompt => this.add_task(prompt, cmd_before, cmd_after, false));
        this._tasks_updated.fire();
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
