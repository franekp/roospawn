import * as fs from 'fs/promises';
import * as path from 'path';
import process from 'process';
import { loadPyodide, type PyodideInterface } from 'pyodide';
import * as vscode from 'vscode';
import { Channel } from './async_utils';
import { RendererInitializationData } from './renderer_interface';
import { RooSpawn, RooSpawnStatus } from './roospawn';
import * as telemetry from './telemetry';

export class PyNotebookController {
    readonly controllerId = 'roospawn-controller';
    readonly notebookType = 'roospawn';
    readonly label = 'RooSpawn Python';
    readonly supportedLanguages = ['python'];

    private _current_execution: vscode.NotebookCellExecution | undefined;
    private _current_output: vscode.NotebookCellOutput | undefined;

    private readonly _controller: vscode.NotebookController;
    private _executionOrder = 0;
    private _executionRequestChannel: Channel<CellExecutionRequest>;

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

        const { rx, tx } = Channel.create<CellExecutionRequest>();
        this._executionRequestChannel = tx;
        this._worker(rx, () => tx.hasData);
    }

    private _execute(
        cells: vscode.NotebookCell[],
        _notebook: vscode.NotebookDocument,
        _controller: vscode.NotebookController
    ): Promise<void> {
        let resolveCallback: (() => void) | undefined = undefined;
        const allExecutedPromise = new Promise<void>(resolve => { resolveCallback = resolve; });

        // TODO: we might store which cells are already enqueued, and only enqueue a cell if it's not already enqueued
        cells.forEach((cell, index) => {
            const callback = (index === cells.length - 1) ? resolveCallback! : () => {};
            this._executionRequestChannel.send({ cell, callback });
        });
        
        return allExecutedPromise;
    }

    private async _worker(rx: AsyncGenerator<CellExecutionRequest, void, void>, hasData: () => boolean) {
        const notificationOptions: vscode.ProgressOptions = {
            title: 'Initializing RooSpawn kernel...',
            location: vscode.ProgressLocation.Notification,
            cancellable: false,
        };
        const pyodide = await vscode.window.withProgress(notificationOptions, () => this._initializePyodide());

        let executeFurtherCells = true;

        for await (const request of rx) {
            const { cell, callback } = request;

            const execution = this._controller.createNotebookCellExecution(cell);

            if (executeFurtherCells) {
                executeFurtherCells = await this._executeCell(cell, execution, pyodide);
            } else {
                execution.start();
                execution.end(undefined);
            }

            callback();

            if (!hasData()) {
                executeFurtherCells = true;
            }
        }
    }

    private async _initializePyodide() {
        const initStartTime = Date.now();
        try {
            const pyodidePath = path.join(this.extensionContext.extensionPath, 'resources', 'pyodide');

            delete process.env.PYTHONHOME;
            delete process.env.PYTHONPATH;

            const pyodide = await loadPyodide({
                indexURL: pyodidePath,
                stdout: (text) => {
                    this._outputChannel.appendLine(`[Pyodide stdout]: ${text}`);
                    if (this._current_execution) {
                        this._current_execution.appendOutputItems([
                            vscode.NotebookCellOutputItem.stdout(text + '\n')
                        ], this._current_output!);
                    }
                },
                stderr: (text) => {
                    this._outputChannel.appendLine(`[Pyodide stderr]: ${text}`);
                    if (this._current_execution) {
                        this._current_execution.appendOutputItems([
                            vscode.NotebookCellOutputItem.stderr(text + '\n')
                        ], this._current_output!);
                    }
                }
            });

            pyodide.registerJsModule('_roospawn', this._rooSpawn);

            const roospawn_py_path = path.join(this.extensionContext.extensionPath, 'resources', 'roospawn.py');
            const roospawn_py = await fs.readFile(roospawn_py_path, 'utf8');

            // TODO: shouldn't we write simply to 'roospawn.py'?
            pyodide.FS.writeFile('/home/pyodide/roospawn.py', roospawn_py);

            this._outputChannel.appendLine('Pyodide initialized successfully');

            return pyodide;
        } catch (error) {
            this._outputChannel.appendLine(`Failed to initialize Pyodide: ${JSON.stringify(error)}`);
            telemetry.notebookPyodideLoadingFailed(Date.now() - initStartTime);
            vscode.window.showErrorMessage('Failed to initialize RooSpawn Python kernel.');
            
            throw error;
        }
    }

    private async _executeCell(
        cell: vscode.NotebookCell,
        execution: vscode.NotebookCellExecution,
        pyodide: PyodideInterface
    ): Promise<boolean> {
        const output = new vscode.NotebookCellOutput([]);
        execution.replaceOutput([output]);

        this._current_output = output;
        this._current_execution = execution;
        
        execution.executionOrder = ++this._executionOrder;
        const startTime = Date.now();
        execution.start(startTime);
        let intervalId = setInterval(() => telemetry.notebookCellExec10sElapsed(Date.now() - startTime), 10_000);
        
        const code = cell.document.getText();
        telemetry.notebookCellExecStart(code);

        const result = await this._runPythonCode(code, pyodide, execution, output);

        clearInterval(intervalId);
        
        const endTime = Date.now();
        execution.end(result.success, endTime);
        if (result.success === true) {
            telemetry.notebookCellExecSuccess(endTime - startTime);
        } else {
            const error = result.error;
            const isPythonException = error instanceof pyodide.ffi.PythonError;
            if (isPythonException) {
                telemetry.notebookCellExecException(endTime - startTime);
            } else {
                telemetry.notebookCellExecInternalError(endTime - startTime);
            }
        }

        this._current_output = undefined;
        this._current_execution = undefined;

        return result.success;
    }

    private async _runPythonCode(
        code: string,
        pyodide: PyodideInterface,
        execution: vscode.NotebookCellExecution,
        output: vscode.NotebookCellOutput
    ): Promise<{ success: true } | { success: false, error: any }> {
        try {
            await pyodide.loadPackagesFromImports(code);

            const result = await pyodide.runPythonAsync(code);
            this._appendCellResultToOutput(result, pyodide, execution, output);

            return { success: true };
        } catch (error) {
            this._outputChannel.appendLine(`Execution error: ${JSON.stringify(error)}`);

            const errorObject = error instanceof Error ? error : new Error(JSON.stringify(error));
            filterStackFrames(error);

            execution.appendOutputItems([vscode.NotebookCellOutputItem.error(errorObject)], output);

            return { success: false, error: errorObject };
        }
    }

    _appendCellResultToOutput(
        result: any,
        pyodide: PyodideInterface,
        execution: vscode.NotebookCellExecution,
        output: vscode.NotebookCellOutput
    ) {
        if (result instanceof RooSpawnStatus) {
            const data: RendererInitializationData = { tasks: result.tasks, workerActive: result.workerActive };
            execution.appendOutputItems(vscode.NotebookCellOutputItem.json(data, result.mime_type), output);
            return;
        }
        
        if (result instanceof pyodide.ffi.PyProxy) {
            const isDict = pyodide.globals.get('isinstance')(result, pyodide.globals.get('dict'));
            if (isDict) {
                const jsResult = result.toJs();
                if (jsResult instanceof Map && jsResult.has('html')) {
                    // We must use replaceOutput because if there are existing "stdout" outputs, vscode will refuse to
                    // render HTML output.
                    execution.replaceOutput([
                        new vscode.NotebookCellOutput([
                            vscode.NotebookCellOutputItem.text(jsResult.get('html').toString(), 'text/html')
                        ])
                    ]);
                    return;
                }
            }
        }

        if (result !== undefined) {       
            let resultStr: string;
            try {
                resultStr = pyodide.globals.get('str')(result).toString();
            } catch {
                resultStr = String(result);
            }
            execution.appendOutputItems([vscode.NotebookCellOutputItem.stdout(resultStr + '\n')], output);
        }
    }

    dispose() {
        this._controller.dispose();
    }
}

interface CellExecutionRequest {
    cell: vscode.NotebookCell;
    callback: () => void;
}

function filterStackFrames(error: Error) {
    error.stack = error.stack?.split('\n').filter(
        line => !(
            line.includes('at wasm://wasm/')
            || line.includes('resources/pyodide/pyodide.asm.js')
            || line.includes('node:internal/')
        )
    ).join('\n');
}
