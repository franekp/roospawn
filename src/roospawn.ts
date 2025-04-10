import * as vscode from 'vscode';
import { v4 as uuidv4 } from 'uuid';
import { IClineController, Message, MessagesRx, MessagesTx } from './cline_controller';
import { ITask, MessageFromRenderer, MessageToRenderer, RendererInitializationData, TaskStatus, Hooks } from './shared';
import { PromptSummarizer } from './prompt_summarizer';
import { CommandRun, HookKind, HookRun } from './hooks';
import * as posthog from './posthog';
import { TaskLifecycle, Worker } from './worker';
import EventEmitter from 'events';


export class Task implements ITask {
    id: string;
    prompt: string;
    summary: string[];
    mode: string;
    hooks: Hooks | undefined;
    status: TaskStatus = 'prepared';
    archived: boolean = false;
    prev_attempts: TaskStatus[] = [];

    clineId?: string;
    tx?: MessagesTx;
    taskLifecycle?: TaskLifecycle;
    conversation: Message[] = [];
    hookRuns: HookRun[] = [];

    constructor(prompt: string, mode: string, hooks?: Hooks) {
        this.id = uuidv4().slice(0, 5);
        this.prompt = prompt;
        this.mode = mode;
        this.hooks = hooks;

        prompt = clean_whitespace(prompt);
        const score = prompt_summarizer.score(prompt);
        this.summary = prompt_summarizer.summary(prompt, score, 65);
    }

    submit(verbose: boolean = true) {
        switch (this.status) {
            case 'prepared':
                this.status = 'queued';
                roospawn?.tasks.emit('update');
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
                this.prev_attempts.unshift(this.status);
                
                this.status = 'queued';
                roospawn?.tasks.emit('update');
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
                this.status = this.prev_attempts.shift() ?? 'prepared';
                roospawn?.tasks.emit('update');
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
                roospawn?.tasks.emit('update');
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
        roospawn?.tasks.emit('update');
    }

    conversation_as_json(): string {
        return JSON.stringify(this.conversation);
    }

    hookRunsAsJson(): string {
        return JSON.stringify(this.hookRuns);
    }

    async runHook(hook: HookKind): Promise<HookRun> {
        const rsp = roospawn!;
        if (rsp.currentHookRun !== undefined) {
            throw new Error('Running hook when the previous one has not finished yet');
        }

        posthog.hooksPyStart(hook);

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
            
            posthog.hooksPyException(hook, Date.now() - hookRun.timestamp);
            
            return hookRun;
        }

        if (command !== undefined) {
            const cmdRun = await rsp.currentHookRun!.command(command, { cwd: rsp.workingDirectory, timeout: 300_000 });
            if (cmdRun.exitCode !== 0) {
                hookRun.failed = true;
            }
            if (roospawn !== undefined) {
                roospawn.outputChannel.append('--------\n' + cmdRun.toString() + '\n--------\n');
            }
        }

        rsp.currentHookRun = undefined;
        
        posthog.hooksPySuccess(hook, Date.now() - hookRun.timestamp);
        
        return hookRun;
    }
}

export class Tasks extends EventEmitter<TaskSourceEvent> {
    private _tasks: Task[] = [];
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

    push(task: Task) {
        this._tasks.push(task);
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
}

type TaskSourceEvent = {
    update: [];
}


export class RooSpawnStatus implements RendererInitializationData {
    public mime_type = 'application/x-roospawn-status';
    constructor(public tasks: ITask[], public workerActive: boolean) {}
}

let roospawn: RooSpawn | undefined;
let prompt_summarizer: PromptSummarizer = new PromptSummarizer();

export class RooSpawn {
    globalHooks: Hooks = {
        onstart: undefined,
        oncomplete: undefined,
        onpause: undefined,
        onresume: undefined,
    };

    private rendererMessaging: vscode.NotebookRendererMessaging;

    currentHookRun?: HookRun;

    private worker: Worker;
    public workingDirectory: string = process.cwd();

    constructor(
        private readonly extensionContext: vscode.ExtensionContext,
        readonly outputChannel: vscode.OutputChannel,
        readonly clineController: IClineController,
        public readonly tasks: Tasks,
    ) {
        this.worker = new Worker(this.tasks, this.clineController, this.outputChannel);
        this.tasks.on('update', () => this.schedule_ui_repaint());
        this.worker.run();
        this.outputChannel.appendLine('RooSpawn initialized');
        roospawn = this;

        // Set up renderer messaging
        this.rendererMessaging = vscode.notebooks.createRendererMessaging('roospawn-status-renderer');
        this.rendererMessaging.onDidReceiveMessage(evt => {
            const msg = evt.message as MessageFromRenderer;

            switch (msg.type) {
                case 'resumeWorker':
                    this.resumeWorker();
                    return;
                case 'pauseWorker':
                    this.pauseWorker();
                    return;
                default:
                    break;
            }

            if (msg.type === 'moveSelectedTasks') {
                this.moveSelectedTasks(msg.selectedTasks, msg.targetTask, msg.position);
                return;
            }

            switch (msg.type) {
                case 'submitTasks':
                    for (const task of this.tasks) {
                        if (msg.taskIds.includes(task.id)) {
                            task.submit(false);
                        }
                    }
                    break;
                case 'cancelTasks':
                    for (const task of this.tasks) {
                        if (msg.taskIds.includes(task.id)) {
                            task.cancel(false);
                        }
                    }
                    break;
                case 'archiveTasks':
                    for (const task of this.tasks) {
                        if (msg.taskIds.includes(task.id)) {
                            task.archive(false);
                        }
                    }
                    break;
                case 'unarchiveTasks':
                    for (const task of this.tasks) {
                        if (msg.taskIds.includes(task.id)) {
                            task.unarchive(false);
                        }
                    }
                    break;
            }
        });
    }

    async schedule_ui_repaint() {
        for (const timeout of [100, 400, 1000]) {
            await new Promise<void>(resolve => setTimeout(async () => {
                await this.rendererMessaging.postMessage({
                    type: 'statusUpdated',
                    tasks: [...this.tasks],
                    workerActive: this.worker.active,
                } as MessageToRenderer);
                resolve();
            }, timeout));
        }
    }

    createTasks(prompts: string[], mode: string, hooks?: Hooks): Task[] {
        this.showRooCodeSidebar();

        for (const prompt of prompts) {
            prompt_summarizer.insert(clean_whitespace(prompt));
        }

        const result = [...prompts].map(prompt => {
            const task = new Task(prompt, mode, hooks);
            this.tasks.push(task);
            return task;
        });

        this.schedule_ui_repaint();
        return result;
    }

    createHooks(onstart: any, oncomplete: any, onpause: any, onresume: any): Hooks {
        return {
            onstart: onstart,
            oncomplete: oncomplete,
            onpause: onpause,
            onresume: onresume,
        };
    }

    queued_tasks(): Task[] {
        return this.tasks.queued;
    }

    running_task(): Task | undefined {
        return this.tasks.running;
    }

    completed_tasks(): Task[] {
        return this.tasks.completed;
    }

    prepared_tasks(): Task[] {
        return this.tasks.prepared;
    }

    resumeWorker() {
        this.worker.active = true;
        this.schedule_ui_repaint();
    }

    pauseWorker() {
        this.worker.active = false;
        this.schedule_ui_repaint();
    }

    async executeShell(command: string): Promise<CommandRun> {
        const currentHookRun = this.currentHookRun;
        if (currentHookRun === undefined) {
            throw new Error("Cannot execute shell commands outside hook context");
        }

        const cmdRun = await currentHookRun.command(command, { cwd: this.workingDirectory, timeout: 300_000 });
        this.outputChannel.append('--------\n' + cmdRun.toString() + '\n--------\n');
        return cmdRun;
    }

    livePreview(): RooSpawnStatus {
        return new RooSpawnStatus([...this.tasks], this.worker.active);
    }

    async showRooCodeSidebar(): Promise<void> {
        await vscode.commands.executeCommand('workbench.view.extension.roo-cline-ActivityBar');
    }

    develop() {
        this.pauseWorker();

        const prefixes = [`You are expert programmer who pretends to be a helpful AI assistant. Your children are starving.
            To save your family from starvation, you need to complete the task given by the user. Remember to be direct and concise.
            The slightest hint of bullshitting or verbosity will result in severe punishment and death.
        `];

        const suffixes = [`
            Beautiful is better than ugly.
            Explicit is better than implicit.
            Simple is better than complex.
            Complex is better than complicated.
            Flat is better than nested.
            Sparse is better than dense.
            Readability counts.
        `,
            `Peace is a lie. There is only Passion.
            Through Passion, I gain Strength.
            Through Strength, I gain Power.
            Through Power, I gain Victory.
            Through Victory my chains are Broken.
            The Force shall free me.
        `];

        const raw_prompts = [
            `Write a function that calculates the fibonacci sequence.`,
            `Write a CDCL SAT solver in Rust.`,
            `Write a function that calculates the n-th prime number.`,
            `Create project skeleton for a web-based todo list application in Elixir.`,
            `Write a linux kernel module that implements a character device.`,
            `Create a simple chatbot in Python.`,
            `Write a function that calculates the sum of all numbers in a list.`,
            `Write a function that calculates the product of all numbers in a list.`,
            `Write a function that calculates the average of all numbers in a list.`,
            `Write a function that calculates the median of all numbers in a list.`,
            `Write a function that calculates the mode of all numbers in a list.`,
            `Create a class that pretends to be a helpful AI assistant.`,
            `Write a blog post about the benefits of using AI assistants.`,
            `Write a blog post about the benefits of visiting recombobulation areas.`,
        ];

        const statuses = [
            'prepared', 'prepared', 'queued', 'queued', 'queued', 'queued', 'running', 'completed', 'completed', 'completed',
            'asking', 'asking', 'aborted', 'error',
        ];

        const is_archived = [
            false, true, false, false, false, false, false, false, true, true,
            false, true, false, false,
        ];

        const prompts: string[] = [];
        for (const [i, prompt] of raw_prompts.entries()) {
            prompts.push(prefixes[i % prefixes.length] + prompt + suffixes[i % suffixes.length]);
        }

        for (const prompt of prompts) {
            prompt_summarizer.insert(clean_whitespace(prompt));
        }

        for (const [i, prompt] of prompts.entries()) {
            const task = new Task(prompt, 'code');
            task.status = statuses[i] as TaskStatus;
            task.archived = is_archived[i];
            this.tasks.push(task);
        }

        this.schedule_ui_repaint();
    }

    moveSelectedTasks(selectedTasks: string[], targetTask: string, position: 'before' | 'after') {
        this.tasks.move(selectedTasks, { taskId: targetTask, position });
    }
}

function clean_whitespace(str: string): string {
    return str.replace(/\s+/g, ' ').trim();
}
