import * as vscode from 'vscode';
import process from 'process';
import * as fs from 'fs/promises';
import { loadPyodide, type PyodideInterface } from 'pyodide';
import * as pyodide from 'pyodide';
import * as path from 'path';
import { RooSpawn, RooSpawnStatus } from './roospawn';

export class PyNotebookController {
    readonly controllerId = 'roospawn-controller';
    readonly notebookType = 'roospawn';
    readonly label = 'RooSpawn Python';
    readonly supportedLanguages = ['python'];

    private _stdout_stderr: vscode.NotebookCellOutputItem[] = [];
    private _current_execution: vscode.NotebookCellExecution | undefined;
    private _current_output: vscode.NotebookCellOutput | undefined;

    private readonly _controller: vscode.NotebookController;
    private _pyodide: PyodideInterface | undefined;
    private _executionOrder = 0;

    constructor(
        private readonly extensionContext: vscode.ExtensionContext,
        private readonly _outputChannel: vscode.OutputChannel,
        private readonly _rooSpawn: RooSpawn
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

            delete process.env.PYTHONHOME;
            delete process.env.PYTHONPATH;

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

            this._pyodide.registerJsModule('_roospawn', this._rooSpawn);

            const roospawn_py_path = path.join(this.extensionContext.extensionPath, 'resources', 'roospawn.py');
            const roospawn_py = await fs.readFile(roospawn_py_path, 'utf8');

            // TODO: shouldn't we write simply to 'roospawn.py'?
            this._pyodide.FS.writeFile('/home/pyodide/roospawn.py', roospawn_py);

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

            if (result instanceof RooSpawnStatus) {
                this._current_execution.appendOutputItems([
                    vscode.NotebookCellOutputItem.json({ tasks: result.tasks, enabled: result.enabled }, result.mime_type)
                ], this._current_output!);
            } else if (result instanceof this._pyodide.ffi.PyProxy) {
                const isDict = this._pyodide.globals.get('isinstance')(result, this._pyodide.globals.get('dict'));
                if (isDict) {
                    const jsResult = result.toJs();
                    if (jsResult instanceof Map && jsResult.has('html')) {
                        // We must use replaceOutput because if there are existing "stdout" outputs, vscode will refuse to
                        // render HTML output.
                        this._current_execution.replaceOutput([
                            new vscode.NotebookCellOutput([
                                vscode.NotebookCellOutputItem.text(jsResult.get('html').toString(), 'text/html')
                            ])
                        ]);
                        execution.end(true, Date.now());
                        this._current_output = undefined;
                        this._current_execution = undefined;
                        return;
                    }
                }
                let output: string;
                try {
                    output = this._pyodide.globals.get('str')(result).toString();
                } catch {
                    output = String(result);
                }
                this._current_execution.appendOutputItems([
                    vscode.NotebookCellOutputItem.stdout(output + '\n')
                ], this._current_output!);
            } else {
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
            }

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
    }
}
