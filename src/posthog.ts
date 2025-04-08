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
 * @param language The language of the code (e.g., "python")
 */
export function notebookCellExecStart(code: string, language: string = "python") {
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
        language
    });
}

/**
 * Tracks the successful completion of a notebook cell execution
 *
 * @param duration The execution duration in milliseconds
 * @param language The language of the code (e.g., "python")
 */
export function notebookCellExecSuccess(duration: number, language: string = "python") {
    capture('notebook:cell_exec_success', 1, {
        duration,
        language
    });
}

/**
 * Tracks a notebook cell execution that resulted in an exception
 *
 * @param duration The execution duration in milliseconds
 * @param language The language of the code (e.g., "python")
 */
export function notebookCellExecException(duration: number, language: string = "python") {
    capture('notebook:cell_exec_exception', 1, {
        duration,
        language
    });
}

/**
 * Tracks an internal error that occurred during notebook cell execution
 * This is for errors in the extension itself, not in the user's code
 *
 * @param duration The execution duration in milliseconds
 * @param language The language of the code (e.g., "python")
 */
export function notebookCellExecInternalError(duration: number, language: string = "python") {
    capture('notebook:cell_exec_internal_error', 1, {
        duration,
        language
    });
}

/**
 * Tracks that a notebook cell has been executing for a period of time
 * This event is emitted every 10 seconds while a cell is running
 *
 * @param elapsedTime The elapsed execution time in milliseconds
 * @param language The language of the code (e.g., "python")
 */
export function notebookCellExec10sElapsed(elapsedTime: number, language: string = "python") {
    capture('notebook:cell_exec_10s_elapsed', 1, {
        elapsed_time: elapsedTime,
        language
    });
}
