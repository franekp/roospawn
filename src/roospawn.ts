import * as vscode from 'vscode';
import { v4 as uuidv4 } from 'uuid';
import { ClineController, Status, MessagesRx, type Message, type MessagesTx } from './cline_controller';
import { ITask, MessageFromRenderer, MessageToRenderer, RendererInitializationData, TaskStatus, Hooks } from './shared';
import { PromptSummarizer } from './prompt_summarizer';


export class Task implements ITask {
    id: string;
    prompt: string;
    summary: string[];
    mode: string;
    hooks: Hooks | undefined;
    status: TaskStatus = 'prepared';

    clineId?: string;
    tx?: MessagesTx;
    conversation: Message[] = [];

    constructor(prompt: string, mode: string, hooks?: Hooks) {
        this.id = uuidv4().slice(0, 5);
        this.prompt = prompt;
        this.mode = mode;
        this.hooks = hooks;

        prompt = clean_whitespace(prompt);
        const score = prompt_summarizer.score(prompt);
        this.summary = prompt_summarizer.summary(prompt, score, 65);
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
        switch (this.status) {
            case 'prepared':
            case 'asking':
                this.status = 'queued';
                if (roospawn) {
                    roospawn.schedule_ui_repaint();
                    roospawn.wakeupWorker?.();
                }
                return;
            default:
                return;
        }
    }

    delete() {
        if (this.status === 'running') {
            throw new Error('Cannot delete running task');
        }
        if (this.status === 'prepared') {
            this.status = 'archived-prepared';
        }
        if (this.status === 'completed') {
            this.status = 'archived-completed';
        }
        if (this.status === 'asking') {
            this.status = 'archived-asking';
        }
        if (this.status === 'aborted') {
            this.status = 'archived-aborted';
        }
        if (roospawn) {
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

    submit() {
        if (this.status === 'prepared') {
            this.status = 'queued';
            if (roospawn) {
                roospawn.schedule_ui_repaint();
                roospawn.wakeupWorker?.();
            }
        }
    }
}

export class RooSpawnStatus implements RendererInitializationData {
    public mime_type = 'application/x-roospawn-status';
    constructor(public tasks: ITask[], public enabled: boolean) {}
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

    enabled: boolean = true;

    _tasks_updated: vscode.EventEmitter<void> = new vscode.EventEmitter<void>();
    tasks_updated: vscode.Event<void> = this._tasks_updated.event;

    wakeupWorker?: () => void;

    constructor(
        private readonly extensionContext: vscode.ExtensionContext,
        private readonly outputChannel: vscode.OutputChannel,
        private readonly clineController: ClineController,
        public tasks: Task[]
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

            if (msg.type === 'moveSelectedTasks') {
                this.moveSelectedTasks(msg.selectedTasks, msg.targetTask, msg.position);
                return;
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

            let task: Task | undefined = undefined;
            try {
                const result = await this.clineController.run(() => {
                    if (!this.enabled) {
                        return;
                    }
                    const task = this.getFirstQueuedTask();
                    if (task === undefined) {
                        return;
                    }

                    task.status = 'running';
                    this.schedule_ui_repaint();

                    const onstartResult = this.globalHooks.onstart !== undefined ? this.globalHooks.onstart(task) : undefined;
                    console.log('onstartResult to execute', onstartResult);
                    
                    return task;
                });

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
                    t.status = value.status;
                    switch (t.status) {
                        case 'completed':
                            const hooks = t.hooks ?? this.globalHooks;
                            if (hooks.oncomplete) {
                                const result = hooks.oncomplete(t);
                                console.log('oncompleteResult to execute', result);
                            }
                            break;
                        default:
                            console.log('task.status', t.status);
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

    enable() {
        this.enabled = true;
        this.wakeupWorker?.();
        this.schedule_ui_repaint();
    }

    disable() {
        this.enabled = false;
        this.schedule_ui_repaint();
    }

    livePreview(): RooSpawnStatus {
        return new RooSpawnStatus([...this.tasks], this.enabled);
    }

    async showRooCodeSidebar(): Promise<void> {
        await vscode.commands.executeCommand('workbench.view.extension.roo-cline-ActivityBar');
    }

    develop() {
        this.disable();

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
            'waiting-for-input', 'waiting-for-input', 'aborted', 'thrown-exception',
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

        this.tasks = newTasks;
        this.schedule_ui_repaint();
    }
}

function clean_whitespace(str: string): string {
    return str.replace(/\s+/g, ' ').trim();
}
