import * as vscode from 'vscode';
import { IClineController, Message, MessagesRx } from './cline_controller';
import { HookKind } from './hooks';
import { Task } from './roospawn';


export class Worker {
    public active: boolean = true;
    public wakeup?: () => void;

    constructor(
        private readonly nextTask: () => Task | undefined,
        private readonly scheduleUiRepaint: () => void,
        private readonly clineController: IClineController,
        private readonly outputChannel: vscode.OutputChannel,
    ) {}

    async run() {
        while (true) {
            while (!this.active || this.nextTask() === undefined) {
                await new Promise<void>(resolve => { this.wakeup = resolve; });
                this.wakeup = undefined;
            }

            let task: Task | undefined = undefined;
            try {
                const result = await this.clineController.run(
                    () => {
                        if (!this.active) {
                            return;
                        }
                        const task = this.nextTask();
                        if (task === undefined) {
                            return;
                        }

                        task.status = 'running';
                        this.scheduleUiRepaint();

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

            this.scheduleUiRepaint();
        }
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
                    this.scheduleUiRepaint();
                } else {
                    t.conversation.push(value);
                }
            } else {
                return;
            }
        }
    }
}
