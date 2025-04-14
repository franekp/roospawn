import * as vscode from 'vscode';
import { IClineController } from './cline_controller';
import { MessageFromRenderer, MessageToRenderer, RendererInitializationData, RendererTask } from './renderer_interface';
import { CommandRun, Hooks, HookRun } from './hooks';
import * as posthog from './posthog';
import { Worker } from './worker';
import { Task, Tasks, TaskStatus } from './tasks';


export class RooSpawnStatus implements RendererInitializationData {
    public mime_type = 'application/x-roospawn-status';
    constructor(public tasks: RendererTask[], public workerActive: boolean) {}
}

let roospawn: RooSpawn | undefined;

export class RooSpawn {
    static get(): RooSpawn {
        if (roospawn === undefined) {
            throw new Error('RooSpawn not initialized');
        }
        return roospawn;
    }

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
        this.rendererMessaging = vscode.notebooks.createRendererMessaging('roospawn-status-renderer');
        roospawn = this;

        this.tasks.on('update', () => {
            // Schedule UI repaint
            this.schedule_ui_repaint();
            
            // Track task statuses after change
            posthog.tasksTaskStatusesAfterLastChange(this.tasks);
        });
        this.worker.run();

        this.rendererMessaging.onDidReceiveMessage(evt => {
            const msg = evt.message as MessageFromRenderer;
            
            posthog.rendererMessageReceived(msg);

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

        this.outputChannel.appendLine('RooSpawn initialized');
    }

    async schedule_ui_repaint() {
        for (const timeout of [100, 400, 1000]) {
            await new Promise<void>(resolve => setTimeout(async () => {
                await this.rendererMessaging.postMessage({
                    type: 'statusUpdated',
                    tasks: this.tasks.getRendererTasks(),
                    workerActive: this.worker.active,
                } as MessageToRenderer);
                resolve();
            }, timeout));
        }
    }

    createTasks(prompts: string[], mode: string, hooks?: Hooks): Task[] {
        this.showRooCodeSidebar();

        const tasks = [...prompts].map(prompt => new Task(prompt, mode, hooks));
        this.tasks.push(...tasks);
        this.schedule_ui_repaint();

        return tasks;
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
        return new RooSpawnStatus(this.tasks.getRendererTasks(), this.worker.active);
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
        ] as const;

        const is_archived = [
            false, true, false, false, false, false, false, false, true, true,
            false, true, false, false,
        ];

        const prompts: string[] = [];
        for (const [i, prompt] of raw_prompts.entries()) {
            prompts.push(prefixes[i % prefixes.length] + prompt + suffixes[i % suffixes.length]);
        }

        const tasks = prompts.map((prompt, i) => {
            const task = new Task(prompt, 'code');
            task.status = statuses[i];
            task.archived = is_archived[i];
            return task;
        });
        this.tasks.push(...tasks);

        this.schedule_ui_repaint();
    }

    moveSelectedTasks(selectedTasks: string[], targetTask: string, position: 'before' | 'after') {
        this.tasks.move(selectedTasks, { taskId: targetTask, position });
    }

    /**
     * Handles PostHog events emitted from Python code
     * This function is called by the Python code via the emitPosthogEvent API
     *
     * @param eventName The name of the event to emit
     * @param data The data to include with the event
     */
    emitPosthogEvent(eventName: string, data: any): void {
        // Extract the function name from the event name (format: python_api:{func_name}:call)
        const match = eventName.match(/^python_api:(.+?):(call|success|exception)$/);
        if (!match) {
            this.outputChannel.appendLine(`Invalid PostHog event name: ${eventName}`);
            return;
        }
        
        const functionName = match[1];
        const eventType = match[2];
        
        switch (eventType) {
            case 'call':
                const metrics = {};
                for (const key of data) {
                    const value = data.get(key);
                    console.log(key, value);
                    metrics[key] = value;
                }
                posthog.pythonApiCall(functionName, metrics);
                break;
            case 'success':
                posthog.pythonApiSuccess(functionName, data.duration ?? 0);
                break;
            case 'exception':
                posthog.pythonApiException(functionName, data.duration ?? 0);
                break;
        }
    }
}
