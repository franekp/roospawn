import * as vscode from 'vscode';
import { RooSpawnSerializer } from './notebook_serializer';
import { PyNotebookController } from './py_notebook_controller';
import { IClineController } from './cline_controller';
import { ClineController as ClineController384 } from './controller-3.8.4/cline_controller';
import { ClineController as ClineController386 } from './controller-3.8.6-dev/cline_controller';
import { RooSpawn, Task, Tasks } from './roospawn';

export { RooSpawn, Task };

export async function activate(context: vscode.ExtensionContext): Promise<RooSpawn> {
    const outputChannel = vscode.window.createOutputChannel('RooSpawn');
    outputChannel.appendLine('RooSpawn extension is now running!');

    // Get Cline API
    const ai_extension = vscode.extensions.getExtension('rooveterinaryinc.roo-cline');
    if (!ai_extension) {
        throw new Error('Roospawn: RooCode (rooveterinaryinc.roo-code) extension not found');
    }

    const tasks = new Tasks();
    let clineController: IClineController;

    if (ai_extension.exports.resumeTask) {
        const ai_api: import('./controller-3.8.6-dev/roo-code').RooCodeAPI = ai_extension.exports;
        const ClineController = ClineController386;
        clineController = new ClineController(ai_api, true);
        vscode.window.showInformationMessage('RooSpawn: Using new Cline API');
    } else {
        const ai_api: import('./controller-3.8.4/cline').ClineAPI = ai_extension.exports;
        const ClineController = ClineController384;
        clineController = new ClineController(ai_api.sidebarProvider, tasks);
        vscode.window.showInformationMessage('RooSpawn: Using old Cline API');
    }

    const rooSpawn = new RooSpawn(context, outputChannel, clineController, tasks);
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

    return rooSpawn;
}

export function deactivate() {}
