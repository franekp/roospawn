import * as vscode from 'vscode';
import { RooSpawn } from "../../roospawn";
import { assert } from 'chai';
import { Message } from '../../cline_controller';

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
    if (message !== null && typeof message === 'object') {
        switch (expected.type) {
            case 'say':
                if (message.type !== 'say') {
                    assert.fail('Expected say message, but got ' + message.type);
                }
                assert.equal(message.say, expected.say);
                if (expected.text !== undefined) {
                    assert.equal(message.text, expected.text);
                }
                if (checkText !== undefined) {
                    assert.isTrue(checkText(message.text));
                }
                if (expected.images !== undefined) {
                    assert.deepEqual(message.images, expected.images);
                }
                break;
            case 'ask':
                if (message.type !== 'ask') {
                    assert.fail('Expected ask message, but got ' + message.type);
                }
                assert.equal(message.ask, expected.ask);
                if (expected.text !== undefined) {
                    assert.equal(message.text, expected.text);
                }
                if (checkText !== undefined) {
                    assert.isTrue(checkText(message.text));
                }
                break;
            case 'status':
                if (message.type !== 'status') {
                    assert.fail('Expected status message, but got ' + message.type);
                }
                assert.equal(message.status, expected.status);
                break;
            case 'exitMessageHandler':
                if (message.type !== 'exitMessageHandler') {
                    assert.fail('Expected exitMessageHandler message, but got ' + message.type);
                }
                break;
        }
    } else {
        assert.fail('Message is undefined');
    }
}

export function tf(func: (fail: (message: string) => void) => Promise<void>): (done: (err: any) => void) => void {
    return (done) => {
        Promise.resolve()
            .then(() => func((message) => done(new Error(message))))
            .then(() => done(undefined))
            .catch((err) => done(err));
    };
}