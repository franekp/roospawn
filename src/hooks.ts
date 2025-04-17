import { ExecOptions } from "child_process";
import { CommandRun, shell_command } from "./shell_command";
import { Task } from "./tasks";
import * as telemetry from './telemetry';

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

    async command(command: string, options: ExecOptions): Promise<CommandRun> {
        telemetry.hooksCmdStart(this.kind, command);

        const commandRun = await shell_command(command, options);

        this.commands.push(commandRun);
        telemetry.hooksCmdResult(this.kind, commandRun);
        
        return commandRun;
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

function indent(s: string, indentation: string): string {
    if (s.endsWith('\n')) {
        s = s.substring(0, s.length - 1);
    }
    return s.split("\n").map(s => indentation + s).join('\n');
}
