// This file contains version-independent type of message from Cline to user.
// Controllers of different versions must convert they message types to the types defined here.

import { Channel } from './async_utils';
import { Task } from './roospawn';

export interface IClineController {
    waitUntilNotBusy(): Promise<void>;
    canResumeTask(task: Task): Promise<boolean>;
    resumeTask(task: Task, options: {timeoutMs: 'no_timeout' | number}): Promise<void>;
    startTask(task: Task, options: {timeoutMs: 'no_timeout' | number}): Promise<MessagesRx>;
    onUserSwitchedTask(handler: (taskSwitch: UserTaskSwitch) => {
        timeoutMs: 'no_timeout' | number,
        waitBeforeStart?: Promise<void>
    }): void;
}

export type UserTaskSwitch =
    | { type: 'start_untracked_task' }
    | { type: 'resume_untracked_task' }
    | { type: 'resume_tracked_task', task: Task }
    ;

export type Message =
    | { type: 'say', say: ClineSay, text?: string, images?: string[] }
    | { type: 'ask', ask: ClineAsk, text?: string }
    | { type: 'status', status: Status }  // this is added by RooSpawn
    | { type: 'exitMessageHandler' }  // this is added by RooSpawn
    ;

export type MessagesTx = Channel<Message>;
export type MessagesRx = AsyncGenerator<Message, void, void>;

export type Status = 'completed' | 'aborted' | 'asking' | 'error';

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