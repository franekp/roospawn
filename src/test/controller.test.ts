// You can import and use all API from the 'vscode' module
// as well as import your extension to test it
import * as vscode from 'vscode';
import * as RooSpawnExtension from '../extension';
import { FakeAi } from './suite/fake_ai';
import { IClineController, Message } from '../cline_controller';
import { assertMessage, initializeRooSpawn, tf } from './suite/utils';
import { Cursor, EventsCollector } from './suite/events_collector';
import { assert } from 'chai';

describe('Integration with Roo-Code', async () => {
	let rooSpawn: RooSpawnExtension.RooSpawn;
	let rooCode: any;

	before(async () => {
		const result = await initializeRooSpawn();
		rooSpawn = result.rooSpawn;
		rooCode = result.rooCode;
	});

	afterEach(async () => {
		await rooSpawn.clineController.abortTaskStack();
	});

	it('Simple task test', tf(async (fail) => {
		const fakeAi = new FakeAi(() => fail("Unhandled query"));
		rooCode.setConfiguration({
			apiProvider: 'fake-ai',
			fakeAi: fakeAi,
		});
		const controller: IClineController = rooSpawn.clineController;

		const tx = fakeAi.handlersManager.add();
		tx.send({ type: 'text', text: 'Hello, world!' });
		tx.send({ type: 'text', text: ' Bye, world!' });
		tx.send({ type: 'text', text: '<attempt_completion><result>Hello</result></attempt_completion>' });
		tx.ret();

		const messageRx = await controller.startTask(new RooSpawnExtension.Task('test', 'code'));

		assertMessage((await messageRx.next()).value, { type: 'say', say: 'text', text: 'test' });
		assertMessage((await messageRx.next()).value, { type: 'say', say: 'api_req_started' });
		assertMessage((await messageRx.next()).value, { type: 'say', say: 'text', text: 'Hello, world! Bye, world!' });
		assertMessage((await messageRx.next()).value, { type: 'say', say: 'completion_result', text: 'Hello' });
		assertMessage((await messageRx.next()).value, { type: 'status', status: 'completed' });
		assertMessage((await messageRx.next()).value, { type: 'ask', ask: 'completion_result', text: '' });
	}));

	it('Subtasks are handled correctly', tf(async (fail) => {
		const fakeAi = new FakeAi(() => fail("Unhandled query"));
		rooCode.setConfiguration({
			apiProvider: 'fake-ai',
			fakeAi: fakeAi,
			autoApprovalEnabled: true,
			alwaysAllowSubtasks: true,
		});
		const controller: IClineController = rooSpawn.clineController;

		const tx = fakeAi.handlersManager.add();
		const tx2 = fakeAi.handlersManager.add();
		const tx3 = fakeAi.handlersManager.add();

		const messageRx = await controller.startTask(new RooSpawnExtension.Task('test', 'code'));

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

	it('Starting task sets `clineId` and `tx` fields of the task', tf(async (fail) => {
		const fakeAi = new FakeAi(() => fail("Unhandled query"));
		rooCode.setConfiguration({
			apiProvider: 'fake-ai',
			fakeAi: fakeAi,
		});
		const controller: IClineController = rooSpawn.clineController;

		const task1 = new RooSpawnExtension.Task('test', 'code');
		await controller.startTask(task1);

		assert.isDefined(task1.clineId);
		assert.isDefined(task1.tx);
	}));

	it('Aborts root task correctly', tf(async (fail) => {
		const fakeAi = new FakeAi(() => fail("Unhandled query"));
		rooCode.setConfiguration({
			apiProvider: 'fake-ai',
			fakeAi: fakeAi,
			autoApprovalEnabled: true,
			alwaysAllowSubtasks: true,
		});
		const controller: IClineController = rooSpawn.clineController;

		const eventsCollector = new EventsCollector(controller);
		const cursor = new Cursor(eventsCollector);
		
		const tx = fakeAi.handlersManager.add();

		const task1 = new RooSpawnExtension.Task('test', 'code');
		const messageRx = await controller.startTask(task1);
		eventsCollector.addMessagesRx(messageRx, 'messages', () => task1.tx.send({ type: 'exitMessageHandler' }));

		tx.send({ type: 'text', text: 'Hello, world!' });
		tx.ret();

		await cursor.waitFor((event) =>
			event.type === 'message'
				&& event.message.type === 'say'
				&& event.message.say === 'text'
				&& event.message.text === 'Hello, world!'
		);
		
		await controller.abortTaskStack();

		await cursor.clone().waitFor((event) => 
			event.type === 'message'
				&& event.sender === 'messages'
				&& event.message.type === 'status'
				&& event.message.status === 'aborted'
		);
		await cursor.clone().waitFor((event) => 
			event.type === 'rootTaskEnded' && event.taskId === task1.clineId
		);
		
		eventsCollector.dispose();		
	}));

	it('Aborts task stack correctly', tf(async (fail) => {
		const fakeAi = new FakeAi(() => fail("Unhandled query"));
		rooCode.setConfiguration({
			apiProvider: 'fake-ai',
			fakeAi: fakeAi,
			autoApprovalEnabled: true,
			alwaysAllowSubtasks: true,
		});
		const controller: IClineController = rooSpawn.clineController;

		const eventsCollector = new EventsCollector(controller);
		const cursor = new Cursor(eventsCollector);
		
		const tx = fakeAi.handlersManager.add();
		const tx2 = fakeAi.handlersManager.add();

		const task1 = new RooSpawnExtension.Task('test', 'code');
		const messageRx = await controller.startTask(task1);
		eventsCollector.addMessagesRx(messageRx, 'messages', () => task1.tx.send({ type: 'exitMessageHandler' }));

		tx.send({ type: 'text', text: '<new_task><mode>code</mode><message>Implement a new feature for the application.</message></new_task>' });
		tx.ret();

		tx2.send({ type: 'text', text: 'Hello, world!' });
		tx2.ret();

		await cursor.waitFor((event) =>
			event.type === 'message'
				&& event.message.type === 'say'
				&& event.message.say === 'text'
				&& event.message.text === 'Hello, world!'
		);
		
		await controller.abortTaskStack();

		await cursor.clone().waitFor((event) => 
			event.type === 'message'
				&& event.sender === 'messages'
				&& event.message.type === 'status'
				&& event.message.status === 'aborted'
		);
		await cursor.clone().waitFor((event) => 
			event.type === 'rootTaskEnded' && event.taskId === task1.clineId
		);

		eventsCollector.dispose();
	}));
});
