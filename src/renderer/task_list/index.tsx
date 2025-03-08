import React, { useState, useEffect } from 'react'
import { ITask, MessageFromRenderer, MessageToRenderer } from '../../shared'
import { useSelectionState, SelectionState } from '../selection_state'
import { RendererContext } from 'vscode-notebook-renderer'
import style from '../task/style.css'
import Task from '../task'


export default function TaskList({tasks: initialTasks, enabled: initialEnabled, context}: {tasks: ITask[], enabled: boolean, context: RendererContext<void>}) {
    let [tasks, setTasks] = useState<ITask[]>(initialTasks)
    let [enabled, setEnabled] = useState<boolean>(initialEnabled)

    let selectionState = useSelectionState()

    useEffect(() => {
        const disposable = context.onDidReceiveMessage?.((event: MessageToRenderer) => {
            if (event.type === 'statusUpdated') {
                setTasks(event.tasks)
                setEnabled(event.enabled)
            }
        });
        return () => disposable?.dispose()
    }, [context])

    let enableButton: React.ReactNode;
    if (enabled) {
        enableButton = <button onClick={() => {
            context.postMessage?.({
                type: 'disable'
            });
        }}>Disable</button>
    } else {
        enableButton = <button onClick={() => {
            context.postMessage?.({
                type: 'enable'
            });
        }}>Enable</button>
    }

    return <div>
        <style>{style}</style>
        <div>{enableButton}</div>
        <div className="tasks-container" onMouseUp={evt => handleOutsideClick(evt, selectionState)}>
            {tasks.map(task =>
                <Task
                    key={task.id}
                    task={task}
                    postMessage={(message: MessageFromRenderer) => context.postMessage?.(message)}
                    selectionState={selectionState}
                    tasks={tasks}
                />
            )}
        </div>
    </div>
}

function handleOutsideClick(evt: React.MouseEvent<HTMLElement>, selectionState: SelectionState) {
    // handles clicks on the task-wrapper (which is invisible and occupies area between tasks)
    // and in the empty space after the last task

    // WARNING: this event must be registered as onMouseUp, not onClick.
    // Otherwise, when doing drag-select or drag n drop, this event is triggered with **target = task-container** !!! (instead of some element in the subtree)
    // The result is that after each drag-select the selection is immediately cleared, making it impossible to select anything.
    // This is because a click is mouseDown + mouseUp. If they have different targets, the least common ancestor of the targets is selected as the
    // target of the click event, which in our case is task-container.
    // https://stackoverflow.com/questions/51847595/why-does-clicking-and-dragging-cause-the-parent-element-to-be-the-event-target#comment90649011_51847665

    const target = evt.target as HTMLElement;
    if (target.classList.contains('task-wrapper') || target.classList.contains('tasks-container')) {
        selectionState.setSelectedTasks(new Set([]));
    }
};