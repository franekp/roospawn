import _roospawn  # JS API exposed from VS Code Extension


class Task:
    pass


def submit_tasks(tasks: list[str]) -> list[Task]:
    return _roospawn.add_tasks(tasks)


def hello():
    return "Hello, world!"
