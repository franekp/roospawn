import * as vscode from 'vscode';
import { v4 as uuidv4 } from 'uuid';
import { IClineController, Message, MessagesRx, MessagesTx } from './cline_controller';
import { ITask, MessageFromRenderer, MessageToRenderer, RendererInitializationData, TaskStatus, Hooks } from './shared';
import { PromptSummarizer } from './prompt_summarizer';
import { CommandRun, HookKind, HookRun } from './hooks';


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
                if (roospawn) {
                    roospawn.schedule_ui_repaint();
                    roospawn.wakeupWorker?.();
                }
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
                if (roospawn) {
                    roospawn.schedule_ui_repaint();
                    roospawn.wakeupWorker?.();
                }
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
                if (roospawn) {
                    roospawn.schedule_ui_repaint();
                }
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
                if (roospawn) {
                    roospawn.schedule_ui_repaint();
                }
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
        if (roospawn) {
            roospawn.schedule_ui_repaint();
        }
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
            return hookRun;
        }

        if (command !== undefined) {
            const cmdRun = await rsp.currentHookRun!.command(command);
            if (cmdRun.exitCode !== 0) {
                hookRun.failed = true;
            }
            if (roospawn !== undefined) {
                roospawn.outputChannel.append('--------\n' + cmdRun.toString() + '\n--------\n');
            }
        }

        rsp.currentHookRun = undefined;
        return hookRun;
    }
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

    workerActive: boolean = true;

    _tasks_updated: vscode.EventEmitter<void> = new vscode.EventEmitter<void>();
    tasks_updated: vscode.Event<void> = this._tasks_updated.event;

    wakeupWorker?: () => void;

    currentHookRun?: HookRun;

    constructor(
        private readonly extensionContext: vscode.ExtensionContext,
        readonly outputChannel: vscode.OutputChannel,
        private readonly clineController: IClineController,
        public readonly tasks: Task[]
    ) {
        this.worker();
        this.outputChannel.appendLine('RooSpawn initialized');
        roospawn = this;

        // Set up renderer messaging
        const messageChannel = vscode.notebooks.createRendererMessaging('roospawn-status-renderer');
        this.extensionContext.subscriptions.push(
            this.tasks_updated(async () => {
                await messageChannel.postMessage({
                    type: 'statusUpdated',
                    tasks: [...this.tasks],
                    workerActive: this.workerActive,
                } as MessageToRenderer);
            })
        );
        messageChannel.onDidReceiveMessage(evt => {
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

    private async worker() {
        while (true) {
            while (!this.workerActive || this.getFirstQueuedTask() === undefined) {
                await new Promise<void>(resolve => { this.wakeupWorker = resolve; });
                this.wakeupWorker = undefined;
            }

            let task: Task | undefined = undefined;
            try {
                const result = await this.clineController.run(
                    () => {
                        if (!this.workerActive) {
                            return;
                        }
                        const task = this.getFirstQueuedTask();
                        if (task === undefined) {
                            return;
                        }

                        task.status = 'running';
                        this.schedule_ui_repaint();

                        return task;
                    },
                    async (task, isResuming) => {
                        const hookKind: HookKind = isResuming ? 'onresume' : 'onstart';
                        let hookResult = await task.runHook(hookKind);
                        if (hookResult.failed) {
                            task.status = 'error';
                        }
                        return { failed: hookResult.failed };
                    }
                );

                if (result === undefined) {
                    // There is no queued task (probably one was deleted or paused)
                    // or RooSpawn is disabled, so we need to wait more.
                    continue;
                }

                task = result.task;

                if (result.channel !== undefined) {
                    this.handleTaskMessages(new WeakRef(task), result.channel);
                }
            } catch (e) {
                if (task !== undefined) {
                    task.status = 'error';
                    console.error('Error running task', task, e);
                } else {
                    console.error('Error in RooSpawn', e);
                }
            }

            this.schedule_ui_repaint();
        }
    }

    private getFirstQueuedTask(): Task | undefined {
        return this.tasks.find(t => t.status === 'queued');
    }

    private async handleTaskMessages(task: WeakRef<Task>, rx: MessagesRx) {
        let msg: IteratorResult<Message, void>;
        while (!(msg = await rx.next()).done) {
            const value = msg.value as Message;

            if (value.type === 'exitMessageHandler') {
                return;
            }

            let t = task.deref();
            if (t !== undefined) {
                if (value.type === 'status') {
                    switch (value.status) {
                        case 'completed':
                            const hookResult1 = await t.runHook('oncomplete');
                            if (hookResult1.failed) {
                                t.status = 'error';
                            } else {
                                t.status = 'completed';
                            }
                            break;
                        case 'aborted':
                        case 'asking':
                            const hookResult2 = await t.runHook('onpause');
                            if (hookResult2.failed) {
                                t.status = 'error';
                            } else {
                                t.status = value.status;
                            }
                            break;
                        case 'error':
                            t.status = 'error';
                            break;
                    }
                    this.schedule_ui_repaint();
                } else {
                    t.conversation.push(value);
                }
            } else {
                return;
            }
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
        return this.tasks.filter(t => t.status === 'queued');
    }

    running_task(): Task | undefined {
        return this.tasks.find(t => t.status === 'running');
    }

    completed_tasks(): Task[] {
        return this.tasks.filter(t => t.status === 'completed');
    }

    prepared_tasks(): Task[] {
        return this.tasks.filter(t => t.status === 'prepared');
    }

    resumeWorker() {
        this.workerActive = true;
        this.wakeupWorker?.();
        this.schedule_ui_repaint();
    }

    pauseWorker() {
        this.workerActive = false;
        this.schedule_ui_repaint();
    }

    async executeShell(command: string): Promise<CommandRun> {
        const currentHookRun = this.currentHookRun;
        if (currentHookRun === undefined) {
            throw new Error("Cannot execute shell commands outside hook context");
        }

        const cmdRun = await currentHookRun.command(command);
        this.outputChannel.append('--------\n' + cmdRun.toString() + '\n--------\n');
        return cmdRun;
    }

    livePreview(): RooSpawnStatus {
        return new RooSpawnStatus([...this.tasks], this.workerActive);
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
        const selectedTasksSet = new Set(selectedTasks);
        const targetIndex = this.tasks.findIndex(t => t.id === targetTask);

        if (targetIndex === -1) {
            throw new Error('Target task not found');
        }

        const newTasks: Task[] = [];
        for (const [i, task] of this.tasks.entries()) {
            if (selectedTasksSet.has(task.id)) {
                continue;
            }
            if (i === targetIndex && position === 'before') {
                newTasks.push(...selectedTasks.map(t => this.tasks.find(t2 => t2.id === t)).filter(t => t !== undefined));
            }
            newTasks.push(task);
            if (i === targetIndex && position === 'after') {
                newTasks.push(...selectedTasks.map(t => this.tasks.find(t2 => t2.id === t)).filter(t => t !== undefined));
            }
        }

        this.tasks.length = 0;  // clear the array
        this.tasks.push(...newTasks);
        this.schedule_ui_repaint();
    }
}

function clean_whitespace(str: string): string {
    return str.replace(/\s+/g, ' ').trim();
}
