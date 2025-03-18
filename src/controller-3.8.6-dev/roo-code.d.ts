import { EventEmitter } from "events"

export interface RooCodeEvents {
	message: [{ taskId: string; action: "created" | "updated"; message: ClineMessage }]
	// Event triggered just after a task started (because of starting a new task, resuming the task or starting a subtask)
	taskStarted: [taskId: string]
	// Event triggered when a task pauses to allow a subtask to run
	taskPaused: [taskId: string]
	// Event triggered when a task unpauses after a subtask has finished
	taskUnpaused: [taskId: string]
	// Event triggered when a task "ask" is responded to by the user
	taskAskResponded: [taskId: string]
	// Event triggered when a task is aborted
	taskAborted: [taskId: string]
	// Event triggered when a task spawns a subtask
	taskSpawned: [taskId: string, childTaskId: string]
}

export interface RooCodeAPI extends EventEmitter<RooCodeEvents> {
	/**
	 * Starts a new task with an optional initial message and images.
	 * @param task Optional initial task message.
	 * @param images Optional array of image data URIs (e.g., "data:image/webp;base64,...").
	 * @returns The ID of the new task.
	 */
	startNewTask(task?: string, images?: string[]): Promise<string>

	/**
	 * Resumes a task with the given ID.
	 * @param taskId The ID of the task to resume.
	 * @throws Error if the task is not found in the task history.
	 */
	resumeTask(taskId: string): Promise<void>

	/**
	 * Checks if a task with the given ID is in the task history.
	 * @param taskId The ID of the task to check.
	 * @returns True if the task is in the task history, false otherwise.
	 */
	isTaskInHistory(taskId: string): Promise<boolean>

	/**
	 * Clears the current task.
	 */
	clearCurrentTask(lastMessage?: string): Promise<void>

	/**
	 * Cancels the current task.
	 */
	cancelCurrentTask(): Promise<void>

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
	pressSecondaryButton(): Promise<void>

	/**
	 * Sets the configuration for the current task.
	 * @param values An object containing key-value pairs to set.
	 */
	setConfiguration(values: Partial<ConfigurationValues>): Promise<void>

	/**
	 * Returns true if the API is ready to use.
	 */
	isReady(): boolean

	/**
	 * Returns the messages for a given task.
	 * @param taskId The ID of the task.
	 * @returns An array of ClineMessage objects.
	 */
	getMessages(taskId: string): ClineMessage[]

	/**
	 * Returns the current task stack.
	 * @returns An array of task IDs.
	 */
	getCurrentTaskStack(): string[]
}

export type ClineAsk =
	| "followup"                   // LLM asks a question that user should respond to
	| "command"                    // LLM asks for permisson to run terminal command
	| "command_output"             // LLM asks for permission to read the terminal command output
	| "completion_result"          // After LLM say "completion_result", we need to show "Start New Task" button and wait for the user to click it — the "completion_result" ask will wait for that click
	| "tool"                       // LLM asks for permission to use a tool (e.g. read file or apply a diff)
	| "api_req_failed"             // Roo-Code failed to make an API request and asks whether to retry or give up (start a new task)
	| "resume_task"                // The user triggered task resume, it became visible in the sidebar, and now the user is asked to confirm the resume
	| "resume_completed_task"      // Similar to "resume_task", but for tasks that are already in completed state (there is only "start new task" button and no "resume task" button)
	| "mistake_limit_reached"      // It is a mistake when LLM in its answer did not used a tool or attempted completion. It is also a mistake when a tool is invoked without required arguments. Three mistakes will trigger this ask. User can give now more information to help LLM.
	| "browser_action_launch"      // LLM asks whether it can open an URL in the browser
	| "use_mcp_server"             // LLM asks whether it can use MCP server to make an MCP API request
	| "finishTask"                 // This is probably a bug. "finishTask" is a tool that signals that the subtask is completed. User is asked to confirm the completion, and then the "control flow" returns to the parent task.

export type ClineSay =
	| "task"                       // Probably a bug. Cannot find any place where "task" is used in "say".
	| "error"                      // Roo-Code informs LLM about some mistake (e.g. missing tool arguments)
	| "api_req_started"            // Roo-Code starts making an API request and provides basic information about the environment
	| "api_req_finished"           // Roo-Code finished performing an API request. Data from this "say" are moved to "api_req_started" "say" and the "api_req_started" "say" is deleted. However cannot find any place where it is said.
	| "api_req_retried"            // Roo-Code failed to make an API request, asked the user whether to retry, and now signals the retry
	| "api_req_retry_delayed"      // Like "api_req_retried", but we hit the rate limit and have to wait for some time before retrying
	| "api_req_deleted"            // Roo-Code says: "aggregated api_req metrics from deleted messages"
	| "text"                       // Generic text message said by the user, Roo-Code or LLM
	| "reasoning"                  // As I understand, some LLMs can talk to themselves and verbose their thougths as "reasoning".
	| "completion_result"          // Marks that the task is completed (green checkmark and some text)
	| "user_feedback"              // The user response for e.g. "followup" ask
	| "user_feedback_diff"         // LLM generated some file, but the user added some changes to it. This "say" informs about the changes done.
	| "command_output"             // An output from a terminal command, so LLM knows the command output
	| "tool"                       // This is probably a bug. Cannot find any place where "tool" is used in "say".
	| "shell_integration_warning"  // Informs the user that the shell integration is unavailable
	| "browser_action"             // LLM says what actions should be taken in the browser (scroll down, click, etc.)
	| "browser_action_result"      // Roo-Code started launching the browser, this say triggers the loading spinner
	| "command"                    // Probably a bug. Cannot find any place where "command" is used in "say".
	| "mcp_server_request_started" // Roo-Code started making an MCP server request, this say triggers the loading spinner
	| "mcp_server_response"        // The response from the MCP server
	| "new_task_started"           // Probably a bug. Cannot find any usage of "new_task_started" in the code.
	| "new_task"                   // Probably a bug. This is a tool, not a "say".
	| "checkpoint_saved"           // Roo-Code saved a checkpoint
	| "rooignore_error"            // Informs the LLM that it does not have access to a file, because it is listed in ".rooignore"

export interface ClineMessage {
	ts: number
	type: "ask" | "say"
	ask?: ClineAsk
	say?: ClineSay
	text?: string
	images?: string[]
	partial?: boolean
	reasoning?: string
	conversationHistoryIndex?: number
	checkpoint?: Record<string, unknown>
	progressStatus?: ToolProgressStatus
}

export type SecretKey =
	| "apiKey"
	| "glamaApiKey"
	| "openRouterApiKey"
	| "awsAccessKey"
	| "awsSecretKey"
	| "awsSessionToken"
	| "openAiApiKey"
	| "geminiApiKey"
	| "openAiNativeApiKey"
	| "deepSeekApiKey"
	| "mistralApiKey"
	| "unboundApiKey"
	| "requestyApiKey"

export type GlobalStateKey =
	| "apiProvider"
	| "apiModelId"
	| "glamaModelId"
	| "glamaModelInfo"
	| "awsRegion"
	| "awsUseCrossRegionInference"
	| "awsProfile"
	| "awsUseProfile"
	| "awsCustomArn"
	| "vertexKeyFile"
	| "vertexJsonCredentials"
	| "vertexProjectId"
	| "vertexRegion"
	| "lastShownAnnouncementId"
	| "customInstructions"
	| "alwaysAllowReadOnly"
	| "alwaysAllowWrite"
	| "alwaysAllowExecute"
	| "alwaysAllowBrowser"
	| "alwaysAllowMcp"
	| "alwaysAllowModeSwitch"
	| "alwaysAllowSubtasks"
	| "taskHistory"
	| "openAiBaseUrl"
	| "openAiModelId"
	| "openAiCustomModelInfo"
	| "openAiUseAzure"
	| "ollamaModelId"
	| "ollamaBaseUrl"
	| "lmStudioModelId"
	| "lmStudioBaseUrl"
	| "anthropicBaseUrl"
	| "modelMaxThinkingTokens"
	| "azureApiVersion"
	| "openAiStreamingEnabled"
	| "openRouterModelId"
	| "openRouterModelInfo"
	| "openRouterBaseUrl"
	| "openRouterUseMiddleOutTransform"
	| "googleGeminiBaseUrl"
	| "allowedCommands"
	| "soundEnabled"
	| "soundVolume"
	| "diffEnabled"
	| "enableCheckpoints"
	| "checkpointStorage"
	| "browserViewportSize"
	| "screenshotQuality"
	| "remoteBrowserHost"
	| "fuzzyMatchThreshold"
	| "writeDelayMs"
	| "terminalOutputLineLimit"
	| "mcpEnabled"
	| "enableMcpServerCreation"
	| "alwaysApproveResubmit"
	| "requestDelaySeconds"
	| "rateLimitSeconds"
	| "currentApiConfigName"
	| "listApiConfigMeta"
	| "vsCodeLmModelSelector"
	| "mode"
	| "modeApiConfigs"
	| "customModePrompts"
	| "customSupportPrompts"
	| "enhancementApiConfigId"
	| "experiments" // Map of experiment IDs to their enabled state
	| "autoApprovalEnabled"
	| "enableCustomModeCreation" // Enable the ability for Roo to create custom modes
	| "customModes" // Array of custom modes
	| "unboundModelId"
	| "requestyModelId"
	| "requestyModelInfo"
	| "unboundModelInfo"
	| "modelTemperature"
	| "modelMaxTokens"
	| "mistralCodestralUrl"
	| "maxOpenTabsContext"
	| "maxWorkspaceFiles"
	| "browserToolEnabled"
	| "lmStudioSpeculativeDecodingEnabled"
	| "lmStudioDraftModelId"
	| "telemetrySetting"
	| "showRooIgnoredFiles"
	| "remoteBrowserEnabled"

export type ConfigurationKey = GlobalStateKey | SecretKey

export type ConfigurationValues = Record<ConfigurationKey, any>

// Local fixes

export type ToolProgressStatus = any;