import _roospawn as api  # type: ignore

import functools
import inspect
import pyodide
import time
from typing import Any, Callable, Coroutine, Dict, Optional, TypeVar, cast


T = TypeVar('T')
def track_api_call(func: Callable[..., T]) -> Callable[..., T]:
    """
    Decorator that tracks API calls to PostHog.
    It emits three types of events:
    - python_api:{func_name}:call - When the function is called
    - python_api:{func_name}:success - When the function completes successfully
    - python_api:{func_name}:exception - When the function raises an exception
    """
    func_name = func.__qualname__

    @functools.wraps(func)
    def wrapper(*args: Any, **kwargs: Any) -> T:
        def metrics_for_arg(name: str, value: Any, metrics: Dict[str, Any]):
            metrics[f"arg:{name}:type"] = type(value).__name__
            if isinstance(value, (str, list, tuple, dict)):
                metrics[f"arg:{name}:length"] = len(value)
            if isinstance(value, (bool, int, float)):
                metrics[f"arg:{name}:value"] = value

        # Prepare arguments for analytics
        # Get the parameter names from the function signature
        sig = inspect.signature(func)
        metrics = {}
        try:
            bound_args = sig.bind(*args, **kwargs)
            for key, value in bound_args.arguments.items():
                metrics_for_arg(key, value, metrics)
        except:
            pass

        # Emit call event
        api.emitPosthogEvent(f"python_api:{func_name}:call", metrics)
        
        start_time = time.time()
        try:
            # Call the original function
            result = func(*args, **kwargs)
            
            # Emit success event
            duration_ms = int((time.time() - start_time) * 1000)
            api.emitPosthogEvent(f"python_api:{func_name}:success", {
                "duration": duration_ms,
            })
            
            return result
        except:
            # Emit exception event
            duration_ms = int((time.time() - start_time) * 1000)
            api.emitPosthogEvent(f"python_api:{func_name}:exception", {
                "duration": duration_ms,
            })
            
            # Re-raise the exception
            raise
    
    return cast(Callable[..., T], wrapper)

class Task:
    def __init__(self, task):
        self._task = task

    @property
    @track_api_call
    def id(self):
        return self._task.id

    @property
    @track_api_call
    def status(self):
        return self._task.status

    @property
    @track_api_call
    def prompt(self):
        return self._task.prompt
    
    @property
    @track_api_call
    def mode(self):
        return self._task.mode

    @track_api_call
    def __repr__(self):
        return f"Task(id={repr(self.id)}, prompt={repr(self.prompt)}, status={repr(self.status)})"

    @track_api_call
    def submit(self):
        self._task.submit()

    @track_api_call
    def cancel(self):
        self._task.cancel()

    @track_api_call
    def archive(self):
        self._task.archive()

    @track_api_call
    def unarchive(self):
        self._task.unarchive()


def _create_hook_proxy(hook: Optional[str] | Callable[[Task], Optional[str]]):
    return pyodide.ffi.create_proxy((lambda task: hook) if hook is None or isinstance(hook, str) else (lambda task: hook(Task(task))))

def _clone_hook_proxy(hook: Optional[pyodide.ffi.JsDoubleProxy]) -> Optional[pyodide.ffi.JsDoubleProxy]:
    return None if hook is None else pyodide.ffi.create_proxy(hook.unwrap())


class Hooks:
    @track_api_call
    def __init__(self, hooks):
        self._hooks = hooks

    @track_api_call
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

@track_api_call
def working_directory(path: str):
    api.workingDirectory = path

@track_api_call
def onstart(hook: Optional[str] | Callable[[Task], Optional[str]]):
    if api.globalHooks.onstart is not None:
        api.globalHooks.onstart.destroy()
    api.globalHooks.onstart = _create_hook_proxy(hook)

@track_api_call
def oncomplete(hook: Optional[str] | Callable[[Task], Optional[str]]):
    if api.globalHooks.oncomplete is not None:
        api.globalHooks.oncomplete.destroy()
    api.globalHooks.oncomplete = _create_hook_proxy(hook)

@track_api_call
def onpause(hook: Optional[str] | Callable[[Task], Optional[str]]):
    if api.globalHooks.onpause is not None:
        api.globalHooks.onpause.destroy()
    api.globalHooks.onpause = _create_hook_proxy(hook)

@track_api_call
def onresume(hook: Optional[str] | Callable[[Task], Optional[str]]):
    if api.globalHooks.onresume is not None:
        api.globalHooks.onresume.destroy()
    api.globalHooks.onresume = _create_hook_proxy(hook)

@track_api_call
def current_hooks() -> Hooks:
    return Hooks(api.globalHooks)

@track_api_call
def live_preview():
    return api.livePreview()

@track_api_call
def create_tasks(prompts: list[str], mode: str = 'code', hooks: Optional[Hooks] = None) -> list[Task]:
    hooks = None if hooks is None else hooks._hooks
    tasks = api.createTasks(prompts, mode, hooks)
    return [Task(task) for task in tasks]

@track_api_call
def submit_tasks(prompts: list[str], mode: str = 'code', hooks: Optional[Hooks] = None) -> list[Task]:
    tasks = create_tasks(prompts, mode, hooks)
    for task in tasks:
        task.submit()
    return tasks

@track_api_call
def pause_task_flow():
    api.pauseWorker()

@track_api_call
def resume_task_flow():
    api.resumeWorker()

@track_api_call
def execute_shell(command: str) -> Coroutine[None, None, Any]:
    return api.executeShell(command)

@track_api_call
def develop():
    api.develop()
    return api.livePreview()
