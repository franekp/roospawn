// <https://github.com/RooVetGit/Roo-Code/blob/main/src/exports/cline.d.ts>
export interface ClineAPI {
	/**
	 * Sets the custom instructions in the global storage.
	 * @param value The custom instructions to be saved.
	 */
	setCustomInstructions(value: string): Promise<void>

	/**
	 * Retrieves the custom instructions from the global storage.
	 * @returns The saved custom instructions, or undefined if not set.
	 */
	getCustomInstructions(): Promise<string | undefined>

	/**
	 * Starts a new task with an optional initial message and images.
	 * @param task Optional initial task message.
	 * @param images Optional array of image data URIs (e.g., "data:image/webp;base64,...").
	 */
	startNewTask(task?: string, images?: string[]): Promise<void>

	/**
	 * Sends a message to the current task.
	 * @param message Optional message to send.
	 * @param images Optional array of image data URIs (e.g., "data:image/webp;base64,...").
	 */
	sendMessage(message?: string, images?: string[]): Promise<void>

	/**
	 * Simulates pressing the primary button in the chat interface.
	 */
	pressPrimaryButton(): Promise<void>

	/**
	 * Simulates pressing the secondary button in the chat interface.
	 */
	pressSecondaryButton(): Promise<void>;

	/**
	 * The sidebar provider instance.
	 */
	sidebarProvider: ClineProvider;
}

// `ClineProvider` at <https://github.com/RooVetGit/Roo-Code/blob/main/src/core/webview/ClineProvider.ts>
export interface ClineProvider {
	/**
	 * The current sidebar state.
	 */
	cline?: Cline,

    initClineWithTask: (task?: string, images?: string[]) => Promise<void>;
}

// `Cline` at <https://github.com/RooVetGit/Roo-Code/blob/main/src/core/Cline.ts>
export interface Cline {
    say: (type: ClineSay, text?: string, images?: string[], partial?: boolean, checkpoint?: Record<string, unknown>) => Promise<undefined>;
    ask: (type: ClineAsk, text?: string, partial?: boolean) => Promise<{ response: ClineAskResponse; text?: string; images?: string[] }>;
	abortTask: (isAbandoned?: boolean) => Promise<void>;
}

// `ClineSay` at <https://github.com/RooVetGit/Roo-Code/blob/main/src/shared/ExtensionMessage.ts>
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

// `ClineAsk` at <https://github.com/RooVetGit/Roo-Code/blob/main/src/shared/ExtensionMessage.ts>
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

// `ClineAskResponse` at <https://github.com/RooVetGit/Roo-Code/blob/main/src/shared/WebviewMessage.ts>
export type ClineAskResponse = "yesButtonClicked" | "noButtonClicked" | "messageResponse"