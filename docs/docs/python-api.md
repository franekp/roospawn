---
sidebar_position: 3
---

# Python API

## Global functions

#### <code><b>live_preview</b>()</code>

Returns an object that visualized presents current state of the RooSpawn task queue.

#### <code><b>create_tasks</b>(prompts: list[str], mode: str = 'code', hooks: Optional[Hooks] = None) -> list[Task]</code>

Creates tasks from a list of prompts. Task mode and hooks can be specified.
When `hooks` is none, global hooks are used.

#### <code><b>submit_tasks</b>(prompts: list[str], mode: str = 'code', hooks: Optional[Hooks] = None) -> list[Task]</code>

This is a shortcut for `create_tasks(..)` followed by `submit()` for each task.

#### <code><b>pause_task_flow</b>()</code> / <code><b>resume_task_flow</b>()</code>

Pauses and resumes RooSpawn tasks processing accordingly.

#### <code><b>current_hooks</b>() -> Hooks</code>

Returns current global `Hooks` object.

### Hooks configuration

You can configure global hooks by using **`onstart`**/**`oncomplete`**/**`onpause`**/**`onresume`** decorators.

```python
@roospawn.onstart
def onstart(task: Task):
    return f"echo '{task.id} started'"

# You can also simply pass the command to run
roospawn.oncomplete("echo 'Task completed'")

# Or use a lambda
roospawn.onpause(lambda task: f"echo '{task.id} paused'")
```

### Helper functions

#### <code><b>working_directory</b>(path: str)</code>

Sets the working directory for all shell commands run by RooSpawn.
By default the first folder in the current workspace is used.

#### <code><b>execute_shell</b>(command: str) -> Coroutine[None, None, CommandRun]</code>

Executes a shell command and returns a `CommandRun` object that contains the command execution result.

## `Task` class

#### <code><b>id</b> -> str</code>

The task identifier which is a sequence of hexadecimal digits.

#### <code><b>status</b> -> str</code>

The task status, one of: `prepared`, `queued`, `running`, `completed`, `asking`, `aborted`, `error`.

#### <code><b>prompt</b> -> str</code>

The task prompt.

#### <code><b>mode</b> -> str</code>

The task mode (e.g. `code`, `ask`, `architect` or `debug`).

#### <code><b>submit</b>()</code>

Submits the task for execution.

#### <code><b>cancel</b>()</code>

Cancels the task execution (if the task execution has not started yet).

#### <code><b>archive</b>()</code>

Archives the task.

#### <code><b>unarchive</b>()</code>

Unarchives the task.

## `Hooks` class

#### <code><b>override</b>(onstart = None, oncomplete = None, onpause = None, onresume = None) -> Hooks</code>

Returns a new `Hooks` object with provided hooks overridden.
It can be passed to `hooks` parameter of [`create_tasks`](#create_tasksprompts-liststr-mode-str--code-hooks-optionalhooks--none---listtask)/[`submit_tasks`](#submit_tasksprompts-liststr-mode-str--code-hooks-optionalhooks--none---listtask) functions.

## `CommandRun` class

#### <code><b>command</b> -> str</code>

The command that was executed.

#### <code><b>exit_code</b> -> int</code>

The exit code of the command.

#### <code><b>stdout</b> -> str</code>

The standard output of the command.

#### <code><b>stderr</b> -> str</code>

The standard error of the command.

#### <code><b>startedTimestamp</b> -> int</code>

The timestamp when the command started (in milliseconds since epoch).

#### <code><b>finishedTimestamp</b> -> int</code>

The timestamp when the command finished (in milliseconds since epoch).
