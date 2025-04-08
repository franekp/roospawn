import * as vscode from 'vscode';
import process from 'process';
import * as fs from 'fs/promises';
import { loadPyodide, type PyodideInterface } from 'pyodide';
import * as pyodide from 'pyodide';
import * as path from 'path';
import { RooSpawn, RooSpawnStatus } from './roospawn';
import { RendererInitializationData } from './shared';
import * as posthog from './posthog';

export class PyNotebookController {
    readonly controllerId = 'roospawn-controller';
    readonly notebookType = 'roospawn';
    readonly label = 'RooSpawn Python';
    readonly supportedLanguages = ['python'];

    private _stdout_stderr: vscode.NotebookCellOutputItem[] = [];
    private _current_execution: vscode.NotebookCellExecution | undefined;
    private _current_output: vscode.NotebookCellOutput | undefined;
    private _executionIntervalId: NodeJS.Timeout | undefined;

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

        const initStartTime = Date.now();
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
            
            // Track internal error with PostHog
            const initDuration = Date.now() - initStartTime;
            posthog.notebookCellExecInternalError(initDuration, "python");
            
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
        const startTime = Date.now();
        execution.start(startTime);

        this._current_output = new vscode.NotebookCellOutput([]);
        this._current_execution = execution;
        execution.replaceOutput([this._current_output]);
        
        // Set up interval to track long-running cell executions
        // Clear any existing interval first
        if (this._executionIntervalId) {
            clearInterval(this._executionIntervalId);
        }
        
        // Set up a new interval that fires every 10 seconds
        this._executionIntervalId = setInterval(() => {
            const elapsedTime = Date.now() - startTime;
            // Only emit the event if we're still executing (10 second intervals)
            if (elapsedTime >= 10000) {
                posthog.notebookCellExec10sElapsed(elapsedTime, "python");
            }
        }, 10000);

        try {
            await this._initializePyodide();

            if (!this._pyodide) {
                // Track internal error with PostHog
                const duration = Date.now() - startTime;
                posthog.notebookCellExecInternalError(duration, "python");
                
                throw new Error('Failed to initialize Pyodide');
            }

            const code = cell.document.getText();
            
            // Track cell execution start with PostHog
            posthog.notebookCellExecStart(code, "python");

            this._pyodide.loadPackagesFromImports(code);

            const result = await this._pyodide.runPythonAsync(code);

            if (result instanceof RooSpawnStatus) {
                const data: RendererInitializationData = { tasks: result.tasks, workerActive: result.workerActive };
                this._current_execution.appendOutputItems(
                    vscode.NotebookCellOutputItem.json(data, result.mime_type),
                    this._current_output!
                );
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
                        const endTime = Date.now();
                        const duration = endTime - startTime;
                        
                        // Track successful cell execution with PostHog
                        posthog.notebookCellExecSuccess(duration, "python");
                        
                        // Clear the execution interval
                        if (this._executionIntervalId) {
                            clearInterval(this._executionIntervalId);
                            this._executionIntervalId = undefined;
                        }
                        
                        execution.end(true, endTime);
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

            const endTime = Date.now();
            const duration = endTime - startTime;
            
            // Track successful cell execution with PostHog
            posthog.notebookCellExecSuccess(duration, "python");
            
            // Clear the execution interval
            if (this._executionIntervalId) {
                clearInterval(this._executionIntervalId);
                this._executionIntervalId = undefined;
            }
            
            execution.end(true, endTime);
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

            // Calculate execution duration
            const endTime = Date.now();
            const duration = endTime - startTime;
            
            // Determine if this is an internal error or a Python exception
            // We check the error message for common Python exception patterns
            const isPythonException = errorObject.message && (
                errorObject.message.includes('Python exception') ||
                errorObject.message.includes('SyntaxError') ||
                errorObject.message.includes('NameError') ||
                errorObject.message.includes('TypeError') ||
                errorObject.message.includes('ValueError') ||
                errorObject.message.includes('IndexError') ||
                errorObject.message.includes('KeyError') ||
                errorObject.message.includes('AttributeError') ||
                errorObject.message.includes('ImportError') ||
                errorObject.message.includes('ModuleNotFoundError')
            );
            
            if (isPythonException) {
                // Track Python exception with PostHog
                posthog.notebookCellExecException(duration, "python");
            } else {
                // Track internal error with PostHog
                posthog.notebookCellExecInternalError(duration, "python");
            }

            // Handle execution error
            execution.appendOutputItems([
                vscode.NotebookCellOutputItem.error(errorObject)
            ], this._current_output!);
            
            // Clear the execution interval
            if (this._executionIntervalId) {
                clearInterval(this._executionIntervalId);
                this._executionIntervalId = undefined;
            }
            
            execution.end(false, endTime);
            this._current_output = undefined;
            this._current_execution = undefined;
        }
    }

    dispose() {
        this._controller.dispose();
    }
}
