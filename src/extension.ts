import * as vscode from 'vscode';
import { RooSpawnSerializer } from './notebook_serializer';
import { PyNotebookController } from './py_notebook_controller';
import { ClineController } from './cline_controller';
import { RooSpawn } from './roo_spawn';

export async function activate(context: vscode.ExtensionContext) {
    const outputChannel = vscode.window.createOutputChannel('Task Dozer');
    outputChannel.appendLine('RooSpawn extension is now active!');

    // Get Cline API
    const ai_extension = vscode.extensions.getExtension('rooveterinaryinc.roo-cline');
    if (!ai_extension) {
        throw new Error('roospawn: roo-cline extension not found');
    }
    const ai_api = ai_extension.exports;
    const clineProvider = ai_api.sidebarProvider;

    // Create main objects with proper dependency injection
    const clineController = new ClineController(clineProvider);
    const rooSpawn = new RooSpawn(context, outputChannel, clineController);
    const notebookController = new PyNotebookController(context, outputChannel, rooSpawn);

    // Register notebook serializer
    context.subscriptions.push(
        vscode.workspace.registerNotebookSerializer('roospawn', new RooSpawnSerializer()),
        outputChannel,
        notebookController
    );

    // Register hello world command
    const disposable = vscode.commands.registerCommand('roospawn.helloWorld', async () => {
        outputChannel.appendLine('Hello World from RooSpawn!');
        vscode.window.showInformationMessage('Hello World from RooSpawn!');
    });

    context.subscriptions.push(disposable);
}

export function deactivate() {}
