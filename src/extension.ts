import * as vscode from 'vscode';
import { RooSpawnSerializer } from './notebook_serializer';
import { PyNotebookController } from './py_notebook_controller';
import { IClineController } from './cline_controller';
import { ClineController as ClineController_3_8_4 } from './controller-3.8.4/cline_controller';
import { ClineController as ClineController_3_8_6 } from './controller-3.8.6-dev/cline_controller';
import { ClineController as ClineController_3_11_9 } from './controller-3.11.9/cline_controller';
import * as posthog from './posthog';
import { RooSpawn, Task, Tasks } from './roospawn';
import { compareVersions } from 'compare-versions';

export { RooSpawn, Task };

export async function activate(context: vscode.ExtensionContext): Promise<RooSpawn> {
    await posthog.activate(context);
    
    const outputChannel = vscode.window.createOutputChannel('RooSpawn');
    outputChannel.appendLine('RooSpawn extension is now running!');

    // Get Cline API
    const ai_extension = vscode.extensions.getExtension('rooveterinaryinc.roo-cline');
    if (!ai_extension) {
        throw new Error('Roospawn: RooCode (rooveterinaryinc.roo-code) extension not found');
    }

    const rooCodeVersion = ai_extension.packageJSON.version;

    const tasks = new Tasks();
    let clineController: IClineController;

    if (compareVersions(rooCodeVersion, '3.11.9') >= 0) {
        const ai_api: import('./controller-3.11.9/roo-code').RooCodeAPI = ai_extension.exports;
        clineController = new ClineController_3_11_9(ai_api, true);
    } else if (ai_extension.exports.resumeTask) {
        const ai_api: import('./controller-3.8.6-dev/roo-code').RooCodeAPI = ai_extension.exports;
        clineController = new ClineController_3_8_6(ai_api, true);
    } else {
        const ai_api: import('./controller-3.8.4/cline').ClineAPI = ai_extension.exports;
        clineController = new ClineController_3_8_4(ai_api.sidebarProvider, tasks);
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

    posthog.extensionActivated();
    return rooSpawn;
}

export async function deactivate() {
    posthog.extensionDeactivating();
    await posthog.deactivate();
}
