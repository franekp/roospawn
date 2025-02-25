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

    constructor(
        private readonly extensionContext: vscode.ExtensionContext,
        private readonly outputChannel: vscode.OutputChannel
    ) {
        this.outputChannel.appendLine('TaskDozer initialized');
        task_dozer = this;
    }

    add_task(prompt: string, cmd_before: string | undefined, cmd_after: string | undefined): Task {
        const task = new Task(prompt, cmd_before, cmd_after);
        this._queued_tasks.push(task);
        return task;
    }

    add_tasks(tasks: string[], cmd_before: string | undefined, cmd_after: string | undefined): Task[] {
        return tasks.map(prompt => this.add_task(prompt, cmd_before, cmd_after));
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
}
