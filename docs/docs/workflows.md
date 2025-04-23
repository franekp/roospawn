---
sidebar_position: 4
---

# Example workflows

So the user can get reasonable defaults without too much thinking.

## Each task is a separate Git commit

```python
import roospawn as rsp

last_successful_commit = (await rsp.execute_shell("git symbolic-ref --short HEAD || git rev-parse HEAD")).stdout.strip()
if (await rsp.execute_shell("git diff-index --quiet HEAD")).exit_code != 0:
    raise Exception("Working directory is not clean")

@rsp.onstart
async def onstart(task):
    return f"git checkout -b rsp-task-{task.id}"

@rsp.oncomplete
def oncomplete(task):
    global last_successful_commit
    last_successful_commit = f"rsp-task-{task.id}"
    return f"git add -A; git diff-index --quiet HEAD || git commit --no-gpg-sign -m 'Task {task.id} completed'"

@rsp.onpause
def onpause(task):
    return f"git add -A; git diff-index --quiet HEAD || git commit --no-gpg-sign -m 'Task {task.id} paused'; git checkout {last_successful_commit}"

@rsp.onresume
def onresume(task):
    return f"git checkout rsp-task-{task.id}"
```

