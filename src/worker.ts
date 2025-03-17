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
                await this.clineController.waitUntilNotBusy();

                // While waiting for Roo Code to be ready, RooSpawn worker may have been paused or
                // the next task may have been changed or all tasks may have been cancelled.
                task = this.nextTask();
                if (!this.active || task === undefined) {
                    continue;  // wait until there's something to do
                }

                task.status = 'running';
                this.scheduleUiRepaint();

                const isResuming = await this.clineController.canResumeTask(task);

                const hookResult = await task.runHook(isResuming ? 'onresume' : 'onstart');
                if (hookResult.failed) {
                    task.status = 'error';
                    this.scheduleUiRepaint();
                    continue;  // move on to the next task
                }
                
                if (isResuming) {
                    await this.clineController.resumeTask(task);
                    // when resuming, we don't need to handle messages, because the "thread"
                    // that handles messages has been started when the task was started and
                    // it will continue to handle messages.
                } else {
                    const channel = await this.clineController.startTask(task);
                    // we don't await handleTaskMessages(), message handling is
                    // a separate "thread", independent from the worker
                    this.handleTaskMessages(new WeakRef(task), channel);
                }
                
            } catch (e) {
                if (task !== undefined) {
                    task.status = 'error';
                    this.scheduleUiRepaint();
                    console.error(`Error in RooSpawn task #${task.id}`, e);
                } else {
                    console.error('Error in RooSpawn', e);
                }
            }
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
