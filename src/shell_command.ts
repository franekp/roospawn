import * as vscode from 'vscode';
import { exec, ExecException, ExecOptions } from "child_process";

export function shell_command(command: string, options: ExecOptions): Promise<CommandRun> {
    options.cwd ??= vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    return new Promise(resolve => {
        console.log(`Executing command: ${command}`);
        const started = Date.now();
        const callback = (error: ExecException | null, stdout: string, stderr: string) => {
            const finished = Date.now();
            const commandRun = new CommandRun(command, error?.code ?? 0, stdout, stderr, started, finished);
            resolve(commandRun);
        };
        exec(command, options, callback);
    });
}

export class CommandRun {
    constructor(
        readonly command: string,
        readonly exitCode: number,
        readonly stdout: string,
        readonly stderr: string,
        readonly startedTimestamp: number,
        readonly finishedTimestamp: number,
    ) {}

    toString(): string {
        let stdout = '';
        let stderr = '';

        if (this.stdout.trim() !== '') {
            stdout = '\nstdout:\n' + indent(this.stdout, '  ');
        }
        if (this.stderr.trim() !== '') {
            stderr = '\nstderr:\n' + indent(this.stderr, '  ');
        }

        return `command: ${this.command}
runned ${new Date(this.startedTimestamp).toString()} for ${(this.finishedTimestamp - this.startedTimestamp) / 1000} seconds
exit code: ${this.exitCode}${stdout}${stderr}`;
    }
}

function indent(s: string, indentation: string): string {
    if (s.endsWith('\n')) {
        s = s.substring(0, s.length - 1);
    }
    return s.split("\n").map(s => indentation + s).join('\n');
}
