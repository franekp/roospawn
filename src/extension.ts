import * as vscode from 'vscode';
import { TextDecoder, TextEncoder } from 'util';

interface TaskDozerCell {
    kind: 'markdown' | 'code';
    value: string;
    language: string;
}

interface TaskDozerNotebook {
    cells: TaskDozerCell[];
}

class TaskDozerSerializer implements vscode.NotebookSerializer {
    async deserializeNotebook(content: Uint8Array, _token: vscode.CancellationToken): Promise<vscode.NotebookData> {
        const contents = new TextDecoder().decode(content);

        let raw: TaskDozerNotebook;
        try {
            raw = JSON.parse(contents);
        } catch {
            raw = { cells: [] };
        }

        const cells = raw.cells.map(item => new vscode.NotebookCellData(
            item.kind === 'code' ? vscode.NotebookCellKind.Code : vscode.NotebookCellKind.Markup,
            item.value,
            item.language
        ));

        return new vscode.NotebookData(cells);
    }

    async serializeNotebook(data: vscode.NotebookData, _token: vscode.CancellationToken): Promise<Uint8Array> {
        const cells: TaskDozerCell[] = data.cells.map(cell => ({
            kind: cell.kind === vscode.NotebookCellKind.Code ? 'code' : 'markdown',
            value: cell.value,
            language: cell.languageId
        }));

        const notebook: TaskDozerNotebook = { cells };
        return new TextEncoder().encode(JSON.stringify(notebook, null, 2));
    }
}

export function activate(context: vscode.ExtensionContext) {
    console.log('TaskDozer extension is now active!');

    // Register notebook serializer
    context.subscriptions.push(
        vscode.workspace.registerNotebookSerializer('taskdozer', new TaskDozerSerializer())
    );

    // Register hello world command
    const disposable = vscode.commands.registerCommand('taskdozer.helloWorld', async () => {
        console.log('Hello World from TaskDozer!');

        let ai_extension = vscode.extensions.getExtension('rooveterinaryinc.roo-cline');
        if (!ai_extension) {
            throw new Error('taskdozer: roo-cline extension not found');
        }
        let ai_api = ai_extension.exports;
        await ai_api.startNewTask("Write a function that calculates factorial in TypeScript");
        
        console.log('Run the query!');
    });

    context.subscriptions.push(disposable);
}

export function deactivate() {}
