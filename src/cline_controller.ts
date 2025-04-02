// This file contains version-independent type of message from Cline to user.
// Controllers of different versions must convert they message types to the types defined here.

import { EventEmitter } from 'events';
import { Channel } from './async_utils';
import { Task } from './roospawn';

/**
 * Assumptions about the controller implementation not represented in the interface:
 * - `startTask` must start a new task and set `clineId` and `tx` fields of the task.
 * - `startTask` and `resumeTask` must set the proper mode in the Roo-Code configuration.
 * - `abortTaskStack` must abort all tasks including subtasks, send status `aborted` message and emit `rootTaskEnded` event.
 *   The order of delivery of the message and the event is not specified.
 * - starting and completing a user task should emit `rootTaskStarted` and `rootTaskEnded` events,
 *   however, entering or exiting subtasks should not emit them.
 * - user interaction with the task after `rootTaskEnded` event should emit `rootTaskStarted` event.
 */
export interface IClineController extends EventEmitter<ControllerEvents> {
    canResumeTask(task: Task): Promise<boolean>;
    resumeTask(task: Task): Promise<void>;
    startTask(task: Task): Promise<MessagesRx>;
    abortTaskStack(): Promise<void>;
    // This needs to be only a good approximation, it is only used to detect the initial state when we attach to the controller.
    isBusy(): boolean;
    isAsking(): boolean;
    waitForAddingTaskToStack(): Promise<void>;
}

export type ControllerEvents = {
    rootTaskStarted: [clineTaskId: string];
    rootTaskEnded: [clineTaskId: string];
    keepalive: [];
}

export type Message =
    | { type: 'say', say: ClineSay, text?: string, images?: string[] }
    | { type: 'ask', ask: ClineAsk, text?: string }
    | { type: 'status', status: Status }  // this is added by RooSpawn
    | { type: 'exitMessageHandler' }  // this is added by RooSpawn
    ;

export type MessagesTx = Channel<Message>;
export type MessagesRx = AsyncGenerator<Message, void, void>;

export type Status = 'completed' | 'aborted' | 'error';

export type ClineAsk =
    | "followup"
    | "command"
    | "command_output"
    | "completion_result"
    | "tool"
    | "api_req_failed"
    | "resume_task"
    | "resume_completed_task"
    | "mistake_limit_reached"
    | "browser_action_launch"
    | "use_mcp_server"
    | "finishTask"

export type ClineSay =
    | "task"
    | "error"
    | "api_req_started"
    | "api_req_finished"
    | "api_req_retried"
    | "api_req_retry_delayed"
    | "api_req_deleted"
    | "text"
    | "reasoning"
    | "completion_result"
    | "user_feedback"
    | "user_feedback_diff"
    | "command_output"
    | "tool"
    | "shell_integration_warning"
    | "browser_action"
    | "browser_action_result"
    | "command"
    | "mcp_server_request_started"
    | "mcp_server_response"
    | "new_task_started"
    | "new_task"
    | "checkpoint_saved"
    | "rooignore_error"