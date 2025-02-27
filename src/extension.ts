import * as vscode from 'vscode';
import { TaskDozerSerializer } from './notebook_serializer';
import { PyNotebookController } from './py_notebook_controller';
import { ClineController } from './cline_controller';
import { TaskDozer } from './task_dozer';

export async function activate(context: vscode.ExtensionContext) {
    const outputChannel = vscode.window.createOutputChannel('Task Dozer');
    outputChannel.appendLine('TaskDozer extension is now active!');

    // Get Cline API
    const ai_extension = vscode.extensions.getExtension('rooveterinaryinc.roo-cline');
    if (!ai_extension) {
        throw new Error('taskdozer: roo-cline extension not found');
    }
    const ai_api = ai_extension.exports;
    const clineProvider = ai_api.sidebarProvider;

    // Create main objects with proper dependency injection
    const clineController = new ClineController(clineProvider);
    const taskDozer = new TaskDozer(context, outputChannel, clineController);
    const notebookController = new PyNotebookController(context, outputChannel, taskDozer);

    // Register notebook serializer
    context.subscriptions.push(
        vscode.workspace.registerNotebookSerializer('taskdozer', new TaskDozerSerializer()),
        outputChannel,
        notebookController
    );

    // Register hello world command
    const disposable = vscode.commands.registerCommand('taskdozer.helloWorld', async () => {
        outputChannel.appendLine('Hello World from TaskDozer!');
        vscode.window.showInformationMessage('Hello World from TaskDozer!');
    });

    context.subscriptions.push(disposable);
}

export function deactivate() {}
