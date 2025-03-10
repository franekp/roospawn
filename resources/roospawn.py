import _roospawn as api  # type: ignore
from typing import Callable, Optional
import pyodide


class Task:
    def __init__(self, task):
        self._task = task

    @property
    def id(self):
        return self._task.id

    @property
    def status(self):
        return self._task.status

    @property
    def prompt(self):
        return self._task.prompt
    
    @property
    def mode(self):
        return self._task.mode

    def __repr__(self):
        return f"Task(id={repr(self.id)}, prompt={repr(self.prompt)}, status={repr(self.status)})"

    def submit(self):
        self._task.submit()

    def cancel(self):
        self._task.cancel()

    def archive(self):
        self._task.archive()

    def unarchive(self):
        self._task.unarchive()


def _create_hook_proxy(hook: Optional[str] | Callable[[Task], Optional[str]]):
    return pyodide.ffi.create_proxy((lambda task: hook) if hook is None or isinstance(hook, str) else (lambda task: hook(Task(task))))

def _clone_hook_proxy(hook: Optional[pyodide.ffi.JsDoubleProxy]) -> Optional[pyodide.ffi.JsDoubleProxy]:
    return None if hook is None else pyodide.ffi.create_proxy(hook.unwrap())


class Hooks:
    def __init__(self, hooks):
        self._hooks = hooks

    def override(self, onstart = None, oncomplete = None, onpause = None, onresume = None):
        def make_hook(hook, default):
            if hook is None:
                return _clone_hook_proxy(default)
            else:
                return _create_hook_proxy(hook)

        onstart = make_hook(onstart, self._hooks.onstart)
        oncomplete = make_hook(oncomplete, self._hooks.oncomplete)
        onpause = make_hook(onpause, self._hooks.onpause)
        onresume = make_hook(onresume, self._hooks.onresume)

        return Hooks(api.createHooks(onstart, oncomplete, onpause, onresume))


def onstart(hook: Optional[str] | Callable[[Task], Optional[str]]):
    if api.globalHooks.onstart is not None:
        api.globalHooks.onstart.destroy()
    api.globalHooks.onstart = _create_hook_proxy(hook)

def oncomplete(hook: Optional[str] | Callable[[Task], Optional[str]]):
    if api.globalHooks.oncomplete is not None:
        api.globalHooks.oncomplete.destroy()
    api.globalHooks.oncomplete = _create_hook_proxy(hook)

def onpause(hook: Optional[str] | Callable[[Task], Optional[str]]):
    if api.globalHooks.onpause is not None:
        api.globalHooks.onpause.destroy()
    api.globalHooks.onpause = _create_hook_proxy(hook)

def onresume(hook: Optional[str] | Callable[[Task], Optional[str]]):
    if api.globalHooks.onresume is not None:
        api.globalHooks.onresume.destroy()
    api.globalHooks.onresume = _create_hook_proxy(hook)

def current_hooks() -> Hooks:
    return Hooks(api.globalHooks)

def live_preview():
    return api.livePreview()

def create_tasks(prompts: list[str], mode: str = 'code', hooks: Optional[Hooks] = None) -> list[Task]:
    hooks = None if hooks is None else hooks._hooks
    tasks = api.createTasks(prompts, mode, hooks)
    return [Task(task) for task in tasks]

def submit_tasks(prompts: list[str], mode: str = 'code', hooks: Optional[Hooks] = None) -> list[Task]:
    tasks = create_tasks(prompts, mode, hooks)
    for task in tasks:
        task.submit()
    return tasks

def pause_task_flow():
    api.pauseWorker()

def resume_task_flow():
    api.resumeWorker()

def execute_shell(command: str):
    return api.executeShell(command)

def develop():
    api.develop()
    return api.livePreview()
