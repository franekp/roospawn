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

export class TaskDozerSerializer implements vscode.NotebookSerializer {
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
