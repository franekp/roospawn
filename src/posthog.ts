import { PostHog } from "posthog-node";
import { uuidv7 } from "uuidv7";
import * as vscode from 'vscode';

let posthog: PostHog | undefined;
let distinctId: string | undefined;
let rooSpawnVersion: string | undefined;
let rooCodeVersion: string | undefined;

export async function activate(context: vscode.ExtensionContext) {
    if (context.extensionMode === vscode.ExtensionMode.Test) {
        return;
    }

    posthog = new PostHog('phc_JDmKFHRApOzVBnp2j5Jor7KWFyMRzHdg2QmlGd1fUP8', { host: 'https://eu.i.posthog.com' });

    distinctId = context.globalState.get('rooSpawn.analytics.userId');
    if (!distinctId) {
        distinctId = uuidv7();
        await context.globalState.update('rooSpawn.analytics.userId', distinctId);
    }

    rooSpawnVersion = context.extension.packageJSON.version;
    const rooCodeExtension = vscode.extensions.getExtension('rooveterinaryinc.roo-cline');
    rooCodeVersion = rooCodeExtension.packageJSON.version;
}

export async function deactivate() {
    await posthog?.shutdown(2000);
}

function capture(event: string, version: number, data: Record<string, any>) {
    if (!posthog || !distinctId) {
        return;
    }

    let properties: Record<string, any> = {
        $process_person_profile: false,
        event_v: version,
        ...data,
    };

    if (rooSpawnVersion !== undefined) {
        properties['roospawn_v'] = rooSpawnVersion;
    }

    if (rooCodeVersion !== undefined) {
        properties['roocode_v'] = rooCodeVersion;
    }

    posthog.capture({ distinctId, event, properties });
}

// Events

export function extensionActivated() {
    capture('extension:activated', 1, {});
}

export function extensionDeactivating() {
    capture('extension:deactivating', 1, {});
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
    
    capture('notebook:cell_exec_start', 1, {
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
    capture('notebook:cell_exec_success', 1, {
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
    capture('notebook:cell_exec_exception', 1, {
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
    capture('notebook:cell_exec_internal_error', 1, {
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
    capture('notebook:cell_exec_10s_elapsed', 1, {
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
    capture('notebook:pyodide_loading_failed', 1, {
        duration
    });
}

/**
 * Tracks when a Python hook starts execution
 *
 * @param hook The hook type that is being executed (onstart, onpause, onresume, oncomplete)
 */
export function hooksPyStart(hook: string) {
    capture(`hooks:${hook}_py_start`, 1, {});
}

/**
 * Tracks when a Python hook execution results in an exception
 *
 * @param hook The hook type that threw the exception (onstart, onpause, onresume, oncomplete)
 * @param duration The duration in milliseconds from hook start until the exception occurred
 */
export function hooksPyException(hook: string, duration: number) {
    capture(`hooks:${hook}_py_exception`, 1, {
        duration
    });
}

/**
 * Tracks when a Python hook execution completes successfully
 *
 * @param hook The hook type that completed successfully (onstart, onpause, onresume, oncomplete)
 * @param duration The duration in milliseconds from hook start until completion
 */
export function hooksPySuccess(hook: string, duration: number) {
    capture(`hooks:${hook}_py_success`, 1, {
        duration
    });
}
