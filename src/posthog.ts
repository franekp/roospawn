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
