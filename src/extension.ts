import { compareVersions } from 'compare-versions';
import * as vscode from 'vscode';

import { IClineController } from './cline_controller';
import { ClineController as ClineController_3_8_4 } from './controller-3.8.4/cline_controller';
import { ClineController as ClineController_3_8_6 } from './controller-3.8.6-dev/cline_controller';
import { ClineController as ClineController_3_11_9 } from './controller-3.11.9/cline_controller';
import { RooSpawnSerializer } from './notebook_serializer';
import * as posthog from './posthog';
import { PyNotebookController } from './py_notebook_controller';
import { RooSpawn } from './roospawn';
import { Task, Tasks } from './tasks';

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

    // Register new notebook command
    const disposable = vscode.commands.registerCommand('roospawn.newNotebook', async () => {
        // Create a new untitled notebook document with the roospawn notebook type
        const notebookData = new vscode.NotebookData([
            new vscode.NotebookCellData(
                vscode.NotebookCellKind.Markup,
                '# RooSpawn Notebook\n\nUse this notebook to interact with RooSpawn.\nPlease, remember to set proper working directory below.',
                'markdown'
            ),
            new vscode.NotebookCellData(
                vscode.NotebookCellKind.Code,
                INITIAL_NOTEBOOK_CODE,
                'python'
            ),
            new vscode.NotebookCellData(
                vscode.NotebookCellKind.Code,
                'tasks = rsp.submit_tasks(["Calculate 3+3", "Writer Fibbonacii function in JavaScript"], mode="code")',
                'python'
            ),
        ]);
        
        const notebook = await vscode.workspace.openNotebookDocument('roospawn', notebookData);
        
        // Show the notebook document in the editor
        await vscode.window.showNotebookDocument(notebook);
    });

    context.subscriptions.push(disposable);

    posthog.extensionActivated();
    return rooSpawn;
}

export async function deactivate() {
    posthog.extensionDeactivating();
    await posthog.deactivate();
}

const INITIAL_NOTEBOOK_CODE = `import roospawn as rsp

rsp.working_directory("-put-cwd-for-hooks-here-")

last_successful_commit = (await rsp.execute_shell("git symbolic-ref --short HEAD || git rev-parse HEAD")).stdout.strip()

@rsp.onstart
async def onstart(task):
    return f"git checkout -b rsp-task-{task.id}"

@rsp.oncomplete
def oncomplete(task):
    global last_successful_commit
    last_successful_commit = f"rsp-task-{task.id}"
    return f"git add -A; git diff-index --quiet HEAD || git commit --no-gpg-sign -m 'Task {task.id} completed'"

@rsp.onpause
def onpause(task):
    return f"git add -A; git diff-index --quiet HEAD || git commit --no-gpg-sign -m 'Task {task.id} paused'; git checkout {last_successful_commit}"

@rsp.onresume
def onresume(task):
    return f"git checkout rsp-task-{task.id}"

rsp.live_preview()
`;