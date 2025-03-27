// You can import and use all API from the 'vscode' module
// as well as import your extension to test it
import * as vscode from 'vscode';
import * as RooSpawnExtension from '../extension';
import { FakeAi } from './suite/fake_ai';
import { IClineController, Message } from '../cline_controller';
import { assert } from 'chai';
import { initializeRooSpawn } from './suite/utils';

describe('Integration with Roo-Code', async () => {
	let rooSpawn: RooSpawnExtension.RooSpawn;
	let rooCode: any;

	before(async () => {
		const result = await initializeRooSpawn();
		rooSpawn = result.rooSpawn;
		rooCode = result.rooCode;
	});

	it('Simple task', tf(async (fail) => {
		const fakeAi = new FakeAi(() => fail("Unhandled query"));
		rooCode.setConfiguration({
			apiProvider: 'fake-ai',
			fakeAi: fakeAi,
		});
		const controller: IClineController = rooSpawn.clineController;

		// Test
		const tx = fakeAi.handlersManager.add();
		tx.send({ type: 'text', text: 'Hello, world!' });
		tx.send({ type: 'text', text: ' Bye, world!' });
		tx.send({ type: 'text', text: '<attempt_completion><result>Hello</result></attempt_completion>' });
		tx.ret();

		await controller.waitUntilNotBusy();
		const messageRx = await controller.startTask(new RooSpawnExtension.Task('test', 'code'), { timeoutMs: 'no_timeout' });

		assertMessage((await messageRx.next()).value, { type: 'say', say: 'text', text: 'test' });
		assertMessage((await messageRx.next()).value, { type: 'say', say: 'api_req_started' });
		assertMessage((await messageRx.next()).value, { type: 'say', say: 'text', text: 'Hello, world! Bye, world!' });
		assertMessage((await messageRx.next()).value, { type: 'say', say: 'completion_result', text: 'Hello' });
		assertMessage((await messageRx.next()).value, { type: 'status', status: 'completed' });
		assertMessage((await messageRx.next()).value, { type: 'ask', ask: 'completion_result', text: '' });
	}));

	it('Create subtask', tf(async (fail) => {
		const fakeAi = new FakeAi(() => fail("Unhandled query"));
		rooCode.setConfiguration({
			apiProvider: 'fake-ai',
			fakeAi: fakeAi,
			autoApprovalEnabled: true,
			alwaysAllowSubtasks: true,
		});
		const controller: IClineController = rooSpawn.clineController;

		// Test
		const tx = fakeAi.handlersManager.add();
		const tx2 = fakeAi.handlersManager.add();
		const tx3 = fakeAi.handlersManager.add();

		await controller.waitUntilNotBusy();
		const messageRx = await controller.startTask(new RooSpawnExtension.Task('test', 'code'), { timeoutMs: 'no_timeout' });

		assertMessage((await messageRx.next()).value, { type: 'say', say: 'text', text: 'test' });
		assertMessage((await messageRx.next()).value, { type: 'say', say: 'api_req_started' });

		tx.send({ type: 'text', text: '<new_task><mode>code</mode><message>Implement a new feature for the application.</message></new_task>' });
		tx.ret();

		assertMessage((await messageRx.next()).value, { type: 'say', say: 'text', text: '' });
		assertMessage((await messageRx.next()).value, { type: 'ask', ask: 'tool', text: '{"tool":"newTask","mode":"Code","content":"Implement a new feature for the application."}' });

		tx2.send({ type: 'text', text: 'Hello, world!' });
		tx2.send({ type: 'text', text: '<attempt_completion><result>Hello</result></attempt_completion>' });
		tx2.ret();
		
		assertMessage((await messageRx.next()).value, { type: 'say', say: 'text', text: 'Implement a new feature for the application.' });
		assertMessage((await messageRx.next()).value, { type: 'say', say: 'api_req_started' });
		assertMessage((await messageRx.next()).value, { type: 'say', say: 'text', text: 'Hello, world!' });
		assertMessage((await messageRx.next()).value, { type: 'say', say: 'completion_result', text: 'Hello' });
		assertMessage((await messageRx.next()).value, { type: 'ask', ask: 'tool', text: '{"tool":"finishTask","content":"Subtask completed! You can review the results and suggest any corrections or next steps. If everything looks good, confirm to return the result to the parent task."}' });

		assertMessage((await messageRx.next()).value, { type: 'say', say: 'text', text: 'Task complete: Hello, world!' });
		assertMessage((await messageRx.next()).value, { type: 'say', say: 'api_req_started' });
		
		tx3.send({ type: 'text', text: '<attempt_completion><result>Hello</result></attempt_completion>'});
		tx3.ret();

		assertMessage((await messageRx.next()).value, { type: 'say', say: 'text', text: '' });
		assertMessage((await messageRx.next()).value, { type: 'say', say: 'completion_result', text: 'Hello' });
		assertMessage((await messageRx.next()).value, { type: 'status', status: 'completed' });
		assertMessage((await messageRx.next()).value, { type: 'ask', ask: 'completion_result', text: '' });
	}));
});

function assertMessage(message: Message | void, expected: Message) {
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

function tf(func: (fail: (message: string) => void) => Promise<void>): (done: (err: any) => void) => void {
	return (done) => {
		Promise.resolve()
			.then(() => func((message) => done(new Error(message))))
			.then(() => done(undefined))
			.catch((err) => done(err));
	};
}