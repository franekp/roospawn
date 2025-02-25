import * as vscode from 'vscode';
import { TaskDozerSerializer } from './notebook_serializer';
import { TaskDozerController } from './notebook_controller';

export async function activate(context: vscode.ExtensionContext) {
    const outputChannel = vscode.window.createOutputChannel('Task Dozer');
    outputChannel.appendLine('TaskDozer extension is now active!');

    // Register notebook serializer
    context.subscriptions.push(
        vscode.workspace.registerNotebookSerializer('taskdozer', new TaskDozerSerializer()),
        outputChannel
    );

    // Create and register the notebook controller
    const controller = new TaskDozerController(context, outputChannel);
    context.subscriptions.push(controller);

    // Register hello world command
    const disposable = vscode.commands.registerCommand('taskdozer.helloWorld', async () => {
        outputChannel.appendLine('Hello World from TaskDozer!');
        vscode.window.showInformationMessage('Hello World from TaskDozer!');

        let ai_extension = vscode.extensions.getExtension('rooveterinaryinc.roo-cline');
        if (!ai_extension) {
            throw new Error('taskdozer: roo-cline extension not found');
        }
        let ai_api = ai_extension.exports;
        await ai_api.startNewTask("Calculate 2+2");
        
        outputChannel.appendLine('Run the query!');
    });

    context.subscriptions.push(disposable);
}

export function deactivate() {}
