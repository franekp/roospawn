import * as vscode from 'vscode';
import { TextDecoder, TextEncoder } from 'util';
import { loadPyodide, type PyodideInterface } from 'pyodide';
import * as path from 'path';

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

class TaskDozerController {
    readonly controllerId = 'taskdozer-controller';
    readonly notebookType = 'taskdozer';
    readonly label = 'TaskDozer Python';
    readonly supportedLanguages = ['python'];

    private readonly _controller: vscode.NotebookController;
    private _pyodide: PyodideInterface | undefined;
    private _executionOrder = 0;

    constructor(
        private readonly extensionContext: vscode.ExtensionContext,
        private readonly _outputChannel: vscode.OutputChannel
    ) {
        this._controller = vscode.notebooks.createNotebookController(
            this.controllerId,
            this.notebookType,
            this.label
        );

        this._controller.supportedLanguages = this.supportedLanguages;
        this._controller.supportsExecutionOrder = true;
        this._controller.executeHandler = this._execute.bind(this);
    }

    private async _initializePyodide() {
        if (this._pyodide) {
            return;
        }

        try {
            const pyodidePath = path.join(this.extensionContext.extensionPath, 'resources', 'pyodide');
            
            // Initialize Pyodide with the local indexURL
            this._pyodide = await loadPyodide({
                indexURL: pyodidePath,
                stdout: (text) => {
                    this._outputChannel.appendLine(`[Pyodide stdout]: ${text}`);
                },
                stderr: (text) => {
                    this._outputChannel.appendLine(`[Pyodide stderr]: ${text}`);
                }
            });

            // Load micropip for package management
            await this._pyodide.loadPackage('micropip');
            
            // Initialize Python environment with common packages
            await this._pyodide.runPythonAsync(`
                import micropip
                await micropip.install(['numpy', 'pandas'])
            `);

            this._outputChannel.appendLine('Pyodide initialized successfully with required packages');
        } catch (error) {
            this._outputChannel.appendLine(`Failed to initialize Pyodide: ${error}`);
            throw error;
        }
    }

    private async _execute(
        cells: vscode.NotebookCell[],
        _notebook: vscode.NotebookDocument,
        _controller: vscode.NotebookController
    ): Promise<void> {
        for (const cell of cells) {
            await this._doExecution(cell);
        }
    }

    private async _doExecution(cell: vscode.NotebookCell): Promise<void> {
        const execution = this._controller.createNotebookCellExecution(cell);
        execution.executionOrder = ++this._executionOrder;
        execution.start(Date.now());

        //try {
            await this._initializePyodide();
            
            if (!this._pyodide) {
                throw new Error('Failed to initialize Pyodide');
            }

            // Execute the Python code
            const result = await this._pyodide.runPythonAsync(cell.document.getText());
            
            // Convert the result to a string representation
            let output: string;
            if (result !== undefined) {
                try {
                    output = this._pyodide.globals.get('str')(result).toString();
                } catch {
                    output = String(result);
                }
            } else {
                output = '';
            }
            
            // Create output
            execution.replaceOutput([
                new vscode.NotebookCellOutput([
                    vscode.NotebookCellOutputItem.text(output)
                ])
            ]);
            
            execution.end(true, Date.now());
        //} catch (error) {
        //    console.error('Execution error:', error);
        //    
        //    // Handle execution error
        //    execution.replaceOutput([
        //        new vscode.NotebookCellOutput([
        //            vscode.NotebookCellOutputItem.error(error as Error)
        //        ])
        //    ]);
        //    execution.end(false, Date.now());
        //}
    }

    dispose() {
        this._controller.dispose();
        this._outputChannel.dispose();
    }
}

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
        await ai_api.startNewTask("Write a function that calculates factorial in TypeScript");
        
        outputChannel.appendLine('Run the query!');
    });

    context.subscriptions.push(disposable);
}

export function deactivate() {}
