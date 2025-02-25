import * as vscode from 'vscode';
import { v4 as uuidv4 } from 'uuid';
import { ClineAPI, ClineAsk, ClineProvider, ClineSay } from './cline';

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
                task_dozer._tasks_updated.fire();
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
                task_dozer._tasks_updated.fire();
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
            task_dozer._tasks_updated.fire();
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

    _clineApi: ClineAPI;
    _clineController: ClineController;

    _tasks_updated: vscode.EventEmitter<void> = new vscode.EventEmitter<void>();
    tasks_updated: vscode.Event<void> = this._tasks_updated.event;

    wakeupWorker?: () => void;

    constructor(
        private readonly extensionContext: vscode.ExtensionContext,
        private readonly outputChannel: vscode.OutputChannel
    ) {
        let clineApi = vscode.extensions.getExtension<ClineAPI>('rooveterinaryinc.roo-cline')?.exports;
        if (!clineApi) {
            throw new Error('TaskDozer: roo-cline extension not found');
        }
        this._clineApi = clineApi;

        const provider = clineApi.sidebarProvider;
        this._clineController = new ClineController(provider);

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
            const task = this._queued_tasks.shift();
            if (task === undefined) {
                await new Promise<void>(resolve => { this.wakeupWorker = resolve; });
                continue;
            }

            this._active_task = task;

            const rx = this._clineController.run(task);
            for await (const msg of rx) {
                console.log(msg);
            }

            this._completed_tasks.push(task);
            this._active_task = undefined;
        }
    }

    add_task(prompt: string, cmd_before: string | undefined, cmd_after: string | undefined, fire_event: boolean = true): Task {
        const task = new Task(prompt, cmd_before, cmd_after);
        this._queued_tasks.push(task);
        if (fire_event) {
            this._tasks_updated.fire();
        }
        this.wakeupWorker?.();
        return task;
    }

    add_tasks(tasks: string[], cmd_before: string | undefined, cmd_after: string | undefined): Task[] {
        const result = [...tasks].map(prompt => this.add_task(prompt, cmd_before, cmd_after, false));
        this._tasks_updated.fire();
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

class ClineController {
    private channel?: Channel<Message, void>;
    private task?: Task;

    constructor(private provider: ClineProvider) {
        const controller = this;

        const oldInitClineWithTask = provider.initClineWithTask.bind(provider);
        provider.initClineWithTask = async (task, images) => {
            console.log('initClineWithTask', task, images);
            await oldInitClineWithTask(task, images);

            // Only tamper in Cline instances that handle our tasks
            if (controller.task !== undefined && controller.channel !== undefined) {
                // Obtain the channel TX
                let channel = controller.channel;
                controller.channel = undefined;

                let cline = provider.cline!;
                const oldSay = cline.say.bind(cline);
                const oldAsk = cline.ask.bind(cline);

                cline.say = async (type, text, images, partial, checkpoint) => {
                    if (partial === false || partial === undefined) {
                        const message: Message = { type: { type: 'say', say: type }, text, images };
                        channel.send(message);

                        if (type === 'completion_result') {
                            this.task = undefined;
                            cline.say = oldSay;
                            cline.ask = oldAsk;

                            channel.ret();
                        }
                    }
                    await oldSay(type, text, images, partial, checkpoint);
                };

                cline.ask = async (type, text, partial) => {
                    if (partial === false || partial === undefined) {
                        channel.send({ type: { type: 'ask', ask: type }, text });
                    }
                    const response = await oldAsk(type, text, partial);
                    // TODO: do we want to handle the response too?
                    return response;
                };
            }
            
        };
    }

    run(task: Task): AsyncGenerator<Message, void, void> {
        if (this.task !== undefined) {
            throw new Error('ClineController: already running a task');
        }
        const { tx, rx } = Channel.create<Message, void>();

        this.channel = tx;
        this.task = task;

        this.provider.initClineWithTask(task.prompt);
        return rx;
    }
}

type MessageType = { type: 'say', say: ClineSay } | { type: 'ask', ask: ClineAsk };

interface Message {
    type: MessageType;
    text?: string;
    images?: string[];
}


class Channel<T, Tr> {
    private resolvers: ((data: Data<T, Tr>) => void)[] = [];
    private data: Data<T, Tr>[] = [];
    private returned: boolean = false;

    private constructor() {}

    static create<T, Tr>(): { tx: Channel<T, Tr>, rx: AsyncGenerator<T, Tr, void> } {
        const channel = new Channel<T, Tr>();
        const rx = async function* () {
            while (true) {
                const data = await channel.receive();
                switch (data.type) {
                    case 'send':
                        yield data.value;
                        break;
                    case 'ret':
                        return data.value;
                }
            }
        }();
        return { tx: channel, rx };
    }

    send(value: T) {
        if (this.returned) {
            throw new Error('Channel: cannot send after ret');
        }

        const data: Data<T, Tr> = { type: 'send', value };
        const resolver = this.resolvers.shift();
        if (resolver !== undefined) {
            resolver(data);
        } else {
            this.data.push(data);
        }
    }

    ret(value: Tr) {
        if (this.returned) {
            throw new Error('Channel: cannot ret after ret');
        }
        this.returned = true;

        const data: Data<T, Tr> = { type: 'ret', value };
        const resolver = this.resolvers.shift();
        if (resolver !== undefined) {
            resolver(data);
        } else {
            this.data.push(data);
        }
    }

    private receive(): Promise<Data<T, Tr>> {
        const data = this.data.shift();
        if (data !== undefined) {
            return Promise.resolve(data);
        }

        if (this.returned) {
            throw new Error('Channel: cannot receive after ret');
        }

        return new Promise((resolve) => {
            this.resolvers.push(resolve);
        });
    }
}

type Data<T, Tr> = { type: 'send', value: T } | { type: 'ret', value: Tr };