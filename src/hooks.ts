import { exec, ExecException, ExecOptions } from "child_process";
import * as posthog from './posthog';
import { Task } from "./tasks";

export type HookKind = 'onstart' | 'oncomplete' | 'onpause' | 'onresume';

export interface Hooks {
    onstart?: HookFunction;
    oncomplete?: HookFunction;
    onpause?: HookFunction;
    onresume?: HookFunction;
}

export type HookFunction = (task: Task) => string | undefined | Promise<string | undefined>;


export class HookRun {
    kind: HookKind;
    commands: CommandRun[] = [];
    failed: boolean = false;

    /// Timestamp when the hook was triggered
    timestamp: number;

    constructor(kind: HookKind) {
        this.kind = kind;
        this.timestamp = Date.now();
    }

    command(command: string, options: ExecOptions): Promise<CommandRun> {
        posthog.hooksCmdStart(this.kind, command);
        
        return new Promise(resolve => {
            const started = Date.now();
            const callback = (error: ExecException | null, stdout: string, stderr: string) => {
                const finished = Date.now();
                const commandRun = new CommandRun(command, error?.code ?? 0, stdout, stderr, started, finished);
                this.commands.push(commandRun);

                posthog.hooksCmdResult(this.kind, error === null, finished - started, stdout, stderr);
                
                resolve(commandRun);
            };
            exec(command, options, callback);
        });
    }

    toString(): string {
        return `=== Hook run
failed: ${this.failed}
started: ${new Date(this.timestamp).toString()}

commands:
${indent(this.commands.map(cr => cr.toString()).join('\n--------\n'), '  ')}
`;
    }
}

export class CommandRun {
    command: string;

    exitCode: number;
    stdout: string;
    stderr: string;

    /// Timestamp when running of the hook was started (in miliseconds)
    started: number;
    /// Timestamp when running of the hook was finished (in miliseconds)
    finished: number;

    constructor(command: string, exitCode: number, stdout: string, stderr: string, started: number, finished: number) {
        this.command = command;
        this.exitCode = exitCode;
        this.stdout = stdout;
        this.stderr = stderr;
        this.started = started;
        this.finished = finished;
    }

    toString(): string {
        let stdout = '';
        let stderr = '';

        if (this.stdout !== '') {
            stdout = '\nstdout:\n' + indent(this.stdout, '  ');
        }
        if (this.stderr !== '') {
            stderr = '\nstderr:\n' + indent(this.stderr, '  ');
        }

        return `command: ${this.command}
runned ${new Date(this.started).toString()} for ${(this.finished - this.started) / 1000} seconds
exit code: ${this.exitCode}${stdout}${stderr}`;
    }
}

function indent(s: string, indentation: string): string {
    if (s.endsWith('\n')) {
        s = s.substring(0, s.length - 1);
    }
    return s.split("\n").map(s => indentation + s).join('\n');
}
