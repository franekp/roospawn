import { PostHog } from "posthog-node";
import { uuidv7 } from "uuidv7";
import * as vscode from 'vscode';
import { HookKind } from './hooks';
import { MessageFromRenderer } from './renderer_interface';
import { Tasks, TaskStatus, ALL_TASK_STATUSES } from './tasks';
import { CommandRun } from "./shell_command";

export class TelemetryCollector {
    private static instance?: TelemetryCollector;

    private posthog?: PostHog;
    private distinctId: string;
    private rooSpawnVersion: string;
    private rooCodeVersion: string;

    private constructor(context: vscode.ExtensionContext, distinctIdUpdatedCallback: () => void) {
        this.distinctId = context.globalState.get('rooSpawn.analytics.userId');
        if (!this.distinctId) {
            this.distinctId = uuidv7();
            context.globalState.update('rooSpawn.analytics.userId', this.distinctId).then(distinctIdUpdatedCallback);
        } else {
            distinctIdUpdatedCallback();
        }

        this.rooSpawnVersion = context.extension.packageJSON.version;
        const rooCodeExtension = vscode.extensions.getExtension('rooveterinaryinc.roo-cline');
        this.rooCodeVersion = rooCodeExtension.packageJSON.version;

        TelemetryCollector.instance = this;

        context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(event => {
            if (event.affectsConfiguration("roospawn.telemetry.enabled")) {
                this.handleTelemetryEnabledChange();
            }
        }));
        this.handleTelemetryEnabledChange();
    }

    static async init(context: vscode.ExtensionContext) {
        if (TelemetryCollector.instance) {
            return;
        }

        await new Promise<void>(resolve => new TelemetryCollector(context, resolve));
    }

    static async dispose() {
        await TelemetryCollector.instance?.disposePosthog();
    }


    static capture(event: string, version: number, data: Record<string, any>) {
        const instance = TelemetryCollector.instance;
        const posthog = instance?.posthog;
        if (!posthog) {
            return;
        }
    
        let properties: Record<string, any> = {
            $process_person_profile: false,
            event_v: version,
            ...data,
        };
    
        if (instance.rooSpawnVersion !== undefined) {
            properties['roospawn_v'] = instance.rooSpawnVersion;
        }
    
        if (instance.rooCodeVersion !== undefined) {
            properties['roocode_v'] = instance.rooCodeVersion;
        }
    
        posthog.capture({ distinctId: instance.distinctId, event, properties });
    }

    private handleTelemetryEnabledChange() {
        const enabled = vscode.workspace.getConfiguration('roospawn.telemetry').get('enabled');
        if (this.posthog === undefined && enabled) {
            this.initPosthog();
        } else if (this.posthog !== undefined && !enabled) {
            this.disposePosthog();
        }
    }

    private initPosthog() {
        this.posthog = new PostHog('phc_JDmKFHRApOzVBnp2j5Jor7KWFyMRzHdg2QmlGd1fUP8', { host: 'https://eu.i.posthog.com' });
    }

    private async disposePosthog() {
        const posthog = this.posthog;
        this.posthog = undefined;
        await posthog?.shutdown(2000);
    }
}

// Events

export function extensionActivated() {
    TelemetryCollector.capture('extension:activated', 1, {});
}

export function extensionDeactivating() {
    TelemetryCollector.capture('extension:deactivating', 1, {});
}

/**
 * Tracks the start of a notebook cell execution with code metrics
 *
 * @param code The code being executed
 */
export function notebookCellExecStart(code: string) {
    // Count various code metrics
    const num_lines = code.split('\n').length;
    const num_chars = code.length;
    
    // Count language constructs
    const def_cnt = (code.match(/\bdef\s+\w+/g) || []).length;
    const class_cnt = (code.match(/\bclass\s+\w+/g) || []).length;
    const if_cnt = (code.match(/\bif\s+/g) || []).length;
    const for_cnt = (code.match(/\bfor\s+/g) || []).length;
    const await_cnt = (code.match(/\bawait\s+/g) || []).length;
    const async_cnt = (code.match(/\basync\s+/g) || []).length;
    const decor_cnt = (code.match(/@\w+/g) || []).length;
    
    TelemetryCollector.capture('notebook:cell_exec_start', 1, {
        num_lines,
        num_chars,
        def_cnt,
        class_cnt,
        if_cnt,
        for_cnt,
        await_cnt,
        async_cnt,
        decor_cnt,
        language: "python"
    });
}

/**
 * Tracks the successful completion of a notebook cell execution
 *
 * @param duration The execution duration in milliseconds
 */
export function notebookCellExecSuccess(duration: number) {
    TelemetryCollector.capture('notebook:cell_exec_success', 1, {
        duration,
        language: "python"
    });
}

/**
 * Tracks a notebook cell execution that resulted in an exception
 *
 * @param duration The execution duration in milliseconds
 */
export function notebookCellExecException(duration: number) {
    TelemetryCollector.capture('notebook:cell_exec_exception', 1, {
        duration,
        language: "python"
    });
}

/**
 * Tracks an internal error that occurred during notebook cell execution
 * This is for errors in the extension itself, not in the user's code
 *
 * @param duration The execution duration in milliseconds
 */
export function notebookCellExecInternalError(duration: number) {
    TelemetryCollector.capture('notebook:cell_exec_internal_error', 1, {
        duration,
        language: "python"
    });
}

/**
 * Tracks that a notebook cell has been executing for a period of time
 * This event is emitted every 10 seconds while a cell is running
 *
 * @param elapsedTime The elapsed execution time in milliseconds
 */
export function notebookCellExec10sElapsed(elapsedTime: number) {
    TelemetryCollector.capture('notebook:cell_exec_10s_elapsed', 1, {
        elapsed_time: elapsedTime,
        language: "python"
    });
}

/**
 * Tracks when Pyodide loading fails
 *
 * @param duration The duration of the loading attempt in milliseconds before it failed
 */
export function notebookPyodideLoadingFailed(duration: number) {
    TelemetryCollector.capture('notebook:pyodide_loading_failed', 1, {
        duration
    });
}

/**
 * Tracks when a Python hook starts execution
 *
 * @param hook The hook type that is being executed (onstart, onpause, onresume, oncomplete)
 */
export function hooksPyStart(hook: HookKind) {
    TelemetryCollector.capture(`hooks:${hook}_py_start`, 1, {});
}

/**
 * Tracks when a Python hook execution results in an exception
 *
 * @param hook The hook type that threw the exception (onstart, onpause, onresume, oncomplete)
 * @param duration The duration in milliseconds from hook start until the exception occurred
 */
export function hooksPyException(hook: HookKind, duration: number) {
    TelemetryCollector.capture(`hooks:${hook}_py_exception`, 1, {
        duration
    });
}

/**
 * Tracks when a Python hook execution completes successfully
 *
 * @param hook The hook type that completed successfully (onstart, onpause, onresume, oncomplete)
 * @param duration The duration in milliseconds from hook start until completion
 */
export function hooksPySuccess(hook: HookKind, duration: number) {
    TelemetryCollector.capture(`hooks:${hook}_py_success`, 1, {
        duration
    });
}

/**
 * Tracks when a command starts execution within a hook
 *
 * @param hook The hook type where the command is executed (onstart, onpause, onresume, oncomplete)
 * @param command The command being executed
 */
export function hooksCmdStart(hook: HookKind, command: string) {
    // Count the number of commands (split by newline, semicolon)
    const num_commands = command.split(/(?:(?<!\\)\n)|;|&&|\|\|/).filter(cmd => cmd.trim().length > 0).length;
    
    // Count the number of characters
    const num_chars = command.length;
    
    // Count git commands
    const num_git_commands = (command.match(/\bgit\s+/g) || []).length;
    
    TelemetryCollector.capture(`hooks:${hook}_cmd_start`, 1, {
        num_commands,
        num_chars,
        num_git_commands
    });
}

/**
 * Tracks when a command execution completes within a hook
 *
 * @param hook The hook type where the command was executed (onstart, onpause, onresume, oncomplete)
 * @param success Whether the command execution was successful
 * @param duration The duration in milliseconds from command start until completion
 * @param stdout The command's stdout output
 * @param stderr The command's stderr output
 */
export function hooksCmdResult(hook: HookKind, commandRun: CommandRun) {
    const eventType = commandRun.exitCode === 0 ? 'success' : 'failure';
    
    TelemetryCollector.capture(`hooks:${hook}_cmd_${eventType}`, 1, {
        duration: commandRun.finishedTimestamp - commandRun.startedTimestamp,
        num_stdout_lines: commandRun.stdout.split('\n').length,
        num_stderr_lines: commandRun.stderr.split('\n').length,
        num_stdout_chars: commandRun.stdout.length,
        num_stderr_chars: commandRun.stderr.length
    });
}

/**
 * Tracks when a Python API function is called
 *
 * @param functionName The name of the function being called
 * @param args The arguments passed to the function
 */
export function pythonApiCall(functionName: string, metrics: Record<string, any>) {
    TelemetryCollector.capture(`python_api:${functionName}:call`, 1, metrics);
}

/**
 * Tracks when a Python API function completes successfully
 *
 * @param functionName The name of the function that completed successfully
 * @param duration The duration in milliseconds from function start until completion
 * @param result The result of the function call (will be analyzed for metrics)
 */
export function pythonApiSuccess(functionName: string, duration: number) {
    TelemetryCollector.capture(`python_api:${functionName}:success`, 1, { duration });
}

/**
 * Tracks when a Python API function throws an exception
 *
 * @param functionName The name of the function that threw the exception
 * @param duration The duration in milliseconds from function start until the exception occurred
 * @param error The error that occurred
 */
export function pythonApiException(functionName: string, duration: number) {
    TelemetryCollector.capture(`python_api:${functionName}:exception`, 1, { duration });
}

/**
 * Tracks when a task's status changes
 *
 * @param from The previous status of the task
 * @param to The new status of the task
 */
export function tasksStatusChange(from: TaskStatus, to: TaskStatus) {
    TelemetryCollector.capture('tasks:status_change', 1, {
        from,
        to
    });
}

/**
 * Tracks when a task is archived
 *
 * @param status The status of the task when it was archived
 */
export function tasksArchive(status: TaskStatus) {
    TelemetryCollector.capture('tasks:archive', 1, {
        status
    });
}

/**
 * Tracks when a task is unarchived
 *
 * @param status The status of the task when it was unarchived
 */
export function tasksUnarchive(status: TaskStatus) {
    TelemetryCollector.capture('tasks:unarchive', 1, {
        status
    });
}

/**
 * Tracks the distribution of task statuses after a change
 * This event provides counts of tasks in each status, including archived tasks
 *
 * @param tasks The Tasks instance containing all tasks
 */
export function tasksTaskStatusesAfterLastChange(tasks: Tasks) {
    // Count tasks in each status
    const counts: Record<string, number> = {};
    
    // Initialize all counters to 0
    for (const status of ALL_TASK_STATUSES) {
        counts[`${status}_cnt`] = 0;
        counts[`arch_${status}_cnt`] = 0;
    }
    
    // Count tasks by status and archived state
    for (const task of tasks) {
        const status: TaskStatus = task.status;
        if (task.archived) {
            counts[`arch_${status}_cnt`]++;
        } else {
            counts[`${status}_cnt`]++;
        }
    }
    
    TelemetryCollector.capture('tasks:task_statuses_after_last_change', 1, counts);
}

/**
 * Tracks when a message is added to a task's conversation
 *
 * @param message The message that was added
 */
export function tasksMessageAdd(message: string) {
    const num_lines = message.split('\n').length;
    const num_chars = message.length;
    
    TelemetryCollector.capture('tasks:message_add', 1, {
        num_lines,
        num_chars
    });
}

/**
 * Tracks when a message contains a tool call
 *
 * @param toolName The name of the tool being called
 * @param message The message containing the tool call
 */
export function tasksMessageContainsToolCall(toolName: string, message: string) {
    const num_lines = message.split('\n').length;
    const num_chars = message.length;
    
    TelemetryCollector.capture('tasks:message_contains_tool_call', 1, {
        tool_name: toolName,
        num_lines,
        num_chars
    });
}

/**
 * Tracks messages received from the renderer
 *
 * @param message The message received from the renderer
 */
export function rendererMessageReceived(message: MessageFromRenderer) {
    // Extract message type
    const messageType = message.type;
    
    // Create properties object with message type
    const properties: Record<string, any> = {
        message_type: messageType
    };
    
    // Add metadata about parameters based on message type
    switch (messageType) {
        case 'submitTasks':
        case 'cancelTasks':
        case 'archiveTasks':
        case 'unarchiveTasks':
            properties['task_ids_count'] = message.taskIds?.length || 0;
            break;
        case 'moveSelectedTasks':
            properties['selected_tasks_count'] = message.selectedTasks?.length || 0;
            properties['position'] = message.position;
            break;
        case 'pauseWorker':
        case 'resumeWorker':
            // No additional parameters for these message types
            break;
        default:
            // For unknown message types, capture all parameters with metadata
            for (const [key, value] of Object.entries(message)) {
                if (value === null || value === undefined) {
                    properties[`${key}_type`] = 'null';
                } else if (typeof value === 'boolean') {
                    properties[`${key}_type`] = 'boolean';
                    properties[`${key}_value`] = value;
                } else if (typeof value === 'number') {
                    properties[`${key}_type`] = 'number';
                    properties[`${key}_value`] = value;
                } else if (typeof value === 'string') {
                    properties[`${key}_type`] = 'string';
                    properties[`${key}_length`] = value.length;
                } else if (Array.isArray(value)) {
                    properties[`${key}_type`] = 'array';
                    properties[`${key}_length`] = value.length;
                } else if (typeof value === 'object') {
                    properties[`${key}_type`] = 'object';
                    properties[`${key}_keys`] = Object.keys(value).length;
                } else {
                    properties[`${key}_type`] = typeof value;
                }
            }
            break;
    }
    
    TelemetryCollector.capture('renderer:message_received', 1, properties);
}
