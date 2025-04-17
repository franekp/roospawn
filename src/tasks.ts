import EventEmitter from 'events';
import { v4 as uuidv4 } from 'uuid';
import * as vscode from 'vscode';
import { Message, MessagesTx } from './cline_controller';
import { Hooks, HookKind, HookRun } from './hooks';
import { PromptSummarizer } from './prompt_summarizer';
import { RendererTask } from './renderer_interface';
import { RooSpawn } from './roospawn';
import * as telemetry from './telemetry';
import { TaskLifecycle } from './worker';

export type TaskStatus =
    | 'prepared' | 'queued' | 'running'
    | 'completed' | 'asking' | 'aborted' | 'error'
    ;

/**
 * Array containing all possible task statuses
 */
export const ALL_TASK_STATUSES: TaskStatus[] = [
    'prepared', 'queued', 'running', 'completed', 'asking', 'aborted', 'error'
];

export class Task {
    readonly id: string;
    prompt: string;
    mode: string;
    hooks: Hooks | undefined;
    private _status: TaskStatus = 'prepared';
    private _archived: boolean = false;

    previousAttempts: TaskStatus[] = [];
    conversation: Message[] = [];
    hookRuns: HookRun[] = [];

    // Data for renderer (managed by Tasks class)
    summary?: string[];

    // Data for worker (managed by Worker class and appropriate ClineController class)
    clineId?: string;
    tx?: MessagesTx;
    taskLifecycle?: TaskLifecycle;
    

    constructor(prompt: string, mode: string, hooks?: Hooks) {
        this.id = uuidv4().slice(0, 5);
        this.prompt = prompt;
        this.mode = mode;
        this.hooks = hooks;
    }

    get status(): TaskStatus {
        return this._status;
    }

    set status(value: TaskStatus) {
        if (this._status !== value) {
            const previousStatus = this._status;
            this._status = value;
            telemetry.tasksStatusChange(previousStatus, value);
            RooSpawn.get().tasks.emit('update');
        }
    }

    get archived(): boolean {
        return this._archived;
    }

    set archived(value: boolean) {
        if (this._archived !== value) {
            this._archived = value;
            if (value) {
                telemetry.tasksArchive(this.status);
            } else {
                telemetry.tasksUnarchive(this.status);
            }
            RooSpawn.get().tasks.emit('update');
        }
    }

    submit(verbose: boolean = true) {
        switch (this.status) {
            case 'prepared':
                this.status = 'queued';
                break;
            case 'queued':
                if (verbose) {
                    vscode.window.showInformationMessage(`Cannot submit: task #${this.id} is already in queue ("${this.summary.join(' ... ')}")`);
                }
                break;
            case 'running':
                if (verbose) {
                    vscode.window.showInformationMessage(`Cannot submit: task #${this.id} is already running ("${this.summary.join(' ... ')}")`);
                }
                break;
            case 'completed':
            case 'asking':
            case 'aborted':
            case 'error': 
                // resubmit task
                this.previousAttempts.unshift(this.status);
                this.status = 'queued';
                break;
        }
    }

    cancel(verbose: boolean = true) {
        switch (this.status) {
            case 'prepared':
                if (verbose) {
                    vscode.window.showInformationMessage(`Cannot cancel: task #${this.id} is not in queue, nothing to cancel ("${this.summary.join(' ... ')}")`);
                }
                break;
            case 'queued':
                this.status = this.previousAttempts.shift() ?? 'prepared';
                break;
            case 'running':
                if (verbose) {
                    vscode.window.showInformationMessage(`Cannot cancel: task #${this.id} is already running ("${this.summary.join(' ... ')}")`);
                }
                break;
            case 'completed':
            case 'asking':
            case 'aborted':
            case 'error':
                if (verbose) {
                    vscode.window.showInformationMessage(`Cannot cancel: task #${this.id} has already finished ("${this.summary.join(' ... ')}")`);
                }
                break;
        }
    }

    archive(verbose: boolean = true) {
        if (this.archived) {
            if (verbose) {
                vscode.window.showInformationMessage(`Cannot archive: task #${this.id} is already archived ("${this.summary.join(' ... ')}")`);
            }
            return;
        }

        switch (this.status) {
            case 'prepared':
            case 'completed':
            case 'asking':
            case 'aborted':
            case 'error':
                this.archived = true;
                break;
            case 'queued':
                vscode.window.showInformationMessage(`Cannot archive: task #${this.id} is already in queue ("${this.summary.join(' ... ')}")`);
                break;
            case 'running':
                vscode.window.showInformationMessage(`Cannot archive: task #${this.id} is already running ("${this.summary.join(' ... ')}")`);
                break;
        }
    }

    unarchive(verbose: boolean = true) {
        if (!this.archived) {
            if (verbose) {
                vscode.window.showInformationMessage(`Cannot unarchive: task #${this.id} is not archived ("${this.summary.join(' ... ')}")`);
            }
            return;
        }
        this.archived = false;
    }

    conversation_as_json(): string {
        return JSON.stringify(this.conversation);
    }

    hookRunsAsJson(): string {
        return JSON.stringify(this.hookRuns);
    }

    async runHook(hook: HookKind): Promise<HookRun> {
        const rsp = RooSpawn.get();
        if (rsp.currentHookRun !== undefined) {
            throw new Error('Running hook when the previous one has not finished yet');
        }

        telemetry.hooksPyStart(hook);

        const hookFunc = this.hooks?.[hook] ?? rsp.globalHooks[hook];
        if (hookFunc === undefined) {
            const run = new HookRun(hook);
            this.hookRuns.push(run);
            return run;
        }
        
        const hookRun = new HookRun(hook);
        this.hookRuns.push(hookRun);
        rsp.currentHookRun = hookRun;
        let command: string | undefined | null = null;
        try {
            command = await hookFunc(this);
        } catch {
            hookRun.failed = true;
            rsp.currentHookRun = undefined;
            
            telemetry.hooksPyException(hook, Date.now() - hookRun.timestamp);
            
            return hookRun;
        }

        if (command !== undefined) {
            const cmdRun = await rsp.currentHookRun!.command(command, { cwd: rsp.workingDirectory, timeout: 300_000 });
            if (cmdRun.exitCode !== 0) {
                hookRun.failed = true;
            }
            
            rsp.outputChannel.append('--------\n' + cmdRun.toString() + '\n--------\n');
        }

        rsp.currentHookRun = undefined;
        
        telemetry.hooksPySuccess(hook, Date.now() - hookRun.timestamp);
        
        return hookRun;
    }
}

export type TasksEvents = {
    update: [];
}

export class Tasks extends EventEmitter<TasksEvents> {
    private _tasks: Task[] = [];
    private _promptSummarizer: PromptSummarizer = new PromptSummarizer();

    constructor() {
        super();
    }
    
    getTask(): Task | undefined {
        return this._tasks.find(t => t.status === 'queued');
    }

    getTaskByClineId(clineId: string): Task | undefined {
        return this._tasks.find(t => t.clineId === clineId);
    }

    get queued(): Task[] {
        return this._tasks.filter(t => t.status === 'queued');
    }

    get running(): Task | undefined {
        return this._tasks.find(t => t.status === 'running');
    }

    get completed(): Task[] {
        return this._tasks.filter(t => t.status === 'completed');
    }

    get prepared(): Task[] {
        return this._tasks.filter(t => t.status === 'prepared');
    }

    push(...tasks: Task[]) {
        const cleanedPrompts = tasks.map(t => clean_whitespace(t.prompt));
        for (const prompt of cleanedPrompts) {
            this._promptSummarizer.insert(prompt);
        }

        for (let [index, task] of tasks.entries()) {
            const cleanedPrompt = cleanedPrompts[index];
            const score = this._promptSummarizer.score(cleanedPrompt);
            const summary = this._promptSummarizer.summary(cleanedPrompt, score, 65);
            task.summary = summary;
        }

        this._tasks.push(...tasks);
        this.emit('update');
    }

    move(taskIds: string[], target: { taskId: string, position: 'before' | 'after' }) {
        const selectedTasksSet = new Set(taskIds);
        const targetIndex = this._tasks.findIndex(t => t.id === target.taskId);

        if (targetIndex === -1) {
            throw new Error('Target task not found');
        }

        const newTasks: Task[] = [];
        for (const [i, task] of this._tasks.entries()) {
            if (selectedTasksSet.has(task.id)) {
                continue;
            }
            if (i === targetIndex && target.position === 'before') {
                newTasks.push(...taskIds.map(t => this._tasks.find(t2 => t2.id === t)).filter(t => t !== undefined));
            }
            newTasks.push(task);
            if (i === targetIndex && target.position === 'after') {
                newTasks.push(...taskIds.map(t => this._tasks.find(t2 => t2.id === t)).filter(t => t !== undefined));
            }
        }

        this._tasks.length = 0;  // clear the array
        this._tasks.push(...newTasks);
        this.emit('update');
    }

    [Symbol.iterator]() {
        return this._tasks[Symbol.iterator]();
    }

    getRendererTasks(): RendererTask[] {
        return this._tasks.map(t => ({
            id: t.id,
            prompt: t.prompt,
            summary: t.summary ?? [t.prompt],
            mode: t.mode,
            status: t.status,
            archived: t.archived
        }));
    }
}

function clean_whitespace(text: string): string {
    return text.replace(/\s+/g, ' ').trim();
}
