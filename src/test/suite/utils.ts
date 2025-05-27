import * as vscode from 'vscode';
import { RooSpawn } from "../../roospawn";
import { assert } from 'chai';
import { Message } from '../../cline_controller';
import { isDeepStrictEqual } from 'util';

export async function initializeRooSpawn(): Promise<RooSpawnInitializationResult> {
    const rooSpawnExtension = vscode.extensions.getExtension('roospawn.roospawn');
    const rooSpawn: RooSpawn = await rooSpawnExtension.activate();
    const rooCodeExtension = vscode.extensions.getExtension('rooveterinaryinc.roo-cline');
    const rooCode = await rooCodeExtension.activate();

    await rooSpawn.showRooCodeSidebar();
    while (!rooCode.isReady()) {
        await new Promise(resolve => setTimeout(resolve, 10));
    }

    const startTask = async (prompt: string, mode: string) => {
        await rooCode.startNewTask({
            configuration: { mode },
            text: prompt,
        });
    };

    return { rooSpawn, rooCode, startTask };
}

export interface RooSpawnInitializationResult {
    rooSpawn: RooSpawn;
    rooCode: any;
    startTask: (prompt: string, mode: string) => Promise<void>;
}

export function assertMessage(message: Message | void, expected: Message, checkText?: (text: string) => boolean) {
    if (!messageMatches(message, expected, checkText)) {
        assert.fail(`Message mismatch (actual, expected)\n${JSON.stringify(message, null, 2)}\n${JSON.stringify(expected, null, 2)}`);
    }
}

function messageMatches(message: Message | void, expected: Message, checkText?: (text: string) => boolean): boolean {
    if (message !== null && typeof message === 'object') {
        switch (expected.type) {
            case 'say':
                if (message.type !== 'say') {
                    return false;
                }
                if (message.say !== expected.say) {
                    return false;
                }
                if (expected.text !== undefined) {
                    if (message.text !== expected.text) {
                        return false;
                    }
                }
                if (checkText !== undefined) {
                    if (!checkText(message.text)) {
                        return false;
                    }
                }
                if (expected.images !== undefined) {
                    if (!isDeepStrictEqual(message.images, expected.images)) {
                        return false;
                    }
                }
                break;
            case 'ask':
                if (message.type !== 'ask') {
                    return false;
                }
                if (message.ask !== expected.ask) {
                    return false;
                }
                if (expected.text !== undefined) {
                    if (message.text !== expected.text) {
                        return false;
                    }
                }
                if (checkText !== undefined) {
                    if (!checkText(message.text)) {
                        return false;
                    }
                }
                break;
            case 'status':
                if (message.type !== 'status') {
                    return false;
                }
                if (message.status !== expected.status) {
                    return false;
                }
                break;
            case 'exitMessageHandler':
                if (message.type !== 'exitMessageHandler') {
                    return false;
                }
                break;
        }
    } else {
        return false;
    }
    return true;
}

/**
 * A wrapper for test functions that allows to have both: callback- and
 * returned-promise-based error reporting.
 * 
 * Usage:
 * 
 * ```ts
 * it('test', tf(async (fail) => {
 *     // Call fail(...) or throw an error to fail the test.
 *     ...
 * }))
 * ```
 */
export function tf(func: (fail: (message: string) => void) => Promise<void>): (done: (err: any) => void) => void {
    return (done) => {
        Promise.resolve()
            .then(() => func((message) => done(new Error(message))))
            .then(() => done(undefined))
            .catch((err) => done(err));
    };
}