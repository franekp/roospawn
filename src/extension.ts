import * as vscode from 'vscode';
import process from 'process';
import { loadPyodide, type PyodideInterface } from 'pyodide';
import * as path from 'path';
import { TaskDozerSerializer } from './notebook_serializer';

class TaskDozerController {
    readonly controllerId = 'taskdozer-controller';
    readonly notebookType = 'taskdozer';
    readonly label = 'TaskDozer Python';
    readonly supportedLanguages = ['python'];

    private _stdout_stderr: vscode.NotebookCellOutputItem[] = [];
    private _current_execution: vscode.NotebookCellExecution | undefined;
    private _current_output: vscode.NotebookCellOutput | undefined;

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

    send_task(task: string) {
        this._outputChannel.appendLine(`Sending task: ${task}`);
    }

    send_tasks(tasks: string[]) {
        this._outputChannel.appendLine(`Sending tasks: ${tasks.join(', ')}`);
    }

    list_tasks() {
        return ['a', 'b', 'c'];
    }

    private async _initializePyodide() {
        if (this._pyodide) {
            return;
        }

        try {
            const pyodidePath = path.join(this.extensionContext.extensionPath, 'resources', 'pyodide');

            delete process.env.PYTHONHOME;
            delete process.env.PYTHONPATH;

            // Initialize Pyodide with the local indexURL
            this._pyodide = await loadPyodide({
                indexURL: pyodidePath,
                stdout: (text) => {
                    this._outputChannel.appendLine(`[Pyodide stdout]: ${text}`);
                    this._stdout_stderr.push(vscode.NotebookCellOutputItem.stdout(text));
                    if (this._current_execution) {
                        this._current_execution.appendOutputItems([
                            vscode.NotebookCellOutputItem.stdout(text + '\n')
                        ], this._current_output!);
                    }
                },
                stderr: (text) => {
                    this._outputChannel.appendLine(`[Pyodide stderr]: ${text}`);
                    this._stdout_stderr.push(vscode.NotebookCellOutputItem.stderr(text));
                    if (this._current_execution) {
                        this._current_execution.appendOutputItems([
                            vscode.NotebookCellOutputItem.stderr(text + '\n')
                        ], this._current_output!);
                    }
                }
            });

            this._pyodide.registerJsModule('taskdozer', {
                send_task: this.send_task.bind(this),
                send_tasks: this.send_tasks.bind(this),
                list_tasks: this.list_tasks.bind(this),
            });

            this._outputChannel.appendLine('Pyodide initialized successfully');
        } catch (error) {
            this._outputChannel.appendLine(`Failed to initialize Pyodide: ${JSON.stringify(error)}`);
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

        this._current_output = new vscode.NotebookCellOutput([]);
        this._current_execution = execution;
        execution.replaceOutput([this._current_output]);

        try {
            await this._initializePyodide();
            
            if (!this._pyodide) {
                throw new Error('Failed to initialize Pyodide');
            }

            const code = cell.document.getText();

            this._pyodide.loadPackagesFromImports(code);

            const result = await this._pyodide.runPythonAsync(code);

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
            this._current_execution.appendOutputItems([ 
                vscode.NotebookCellOutputItem.stdout(output + '\n')
            ], this._current_output!);
            
            execution.end(true, Date.now());
            this._current_output = undefined;
            this._current_execution = undefined;
        } catch (error) {
            this._outputChannel.appendLine(`Execution error: ${JSON.stringify(error)}`);
            
            // Convert non-Error objects to Error objects
            const errorObject = error instanceof Error ? error : new Error(JSON.stringify(error));
            
            errorObject.stack = errorObject.stack?.split('\n').filter(
                line => !(line.includes('at wasm://wasm/') || line.includes('resources/pyodide/pyodide.asm.js')
                    || line.includes('node:internal/'))
            ).join('\n');

            // Handle execution error
            execution.appendOutputItems([
                vscode.NotebookCellOutputItem.error(errorObject)
            ], this._current_output!);
            execution.end(false, Date.now());
            this._current_output = undefined;
            this._current_execution = undefined;
        }
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
