import { exec } from "child_process";

export type HookKind = 'onstart' | 'oncomplete' | 'onpause' | 'onresume';

export class HookRun {
    kind: HookKind;
    commands: CommandRun[] = [];

    /// Timestamp when the hook was triggered
    timestamp: number;

    constructor(kind: HookKind) {
        this.kind = kind;
        this.timestamp = Date.now();
    }

    command(command: string): Promise<CommandRun> {
        return new Promise(resolve => {
            const started = Date.now();
            exec(
                command,
                { timeout: 300*1000 },
                (error, stdout, stderr) => {
                    const commandRun = {
                        command, exitCode: error?.code ?? 0, stdout, stderr, started, finished: Date.now(),
                    };
                    this.commands.push(commandRun);
                    resolve(commandRun);
                },
            );
        });
    }
}

export interface CommandRun {
    command: string;

    exitCode: number;
    stdout: string;
    stderr: string;

    /// Timestamp when running of the hook was started (in miliseconds)
    started: number;
    /// Timestamp when running of the hook was finished (in miliseconds)
    finished: number;
}
