import '../css.d.ts'  // ts langserver needs this, not needed to compile without errors
import React, { useState, useEffect } from 'react'
import { ITask, MessageFromRenderer, MessageToRenderer } from '../../shared'
import { useSelectionState, SelectionState } from '../selection_state'
import { RendererContext } from 'vscode-notebook-renderer'
import style from '../task/style.css'
import Task from '../task'


export default function TaskList({tasks: initialTasks, workerActive: initialWorkerActive, context}: {tasks: ITask[], workerActive: boolean, context: RendererContext<void>}) {
    let [tasks, setTasks] = useState<ITask[]>(initialTasks)
    let [workerActive, setWorkerActive] = useState<boolean>(initialWorkerActive)

    let selectionState = useSelectionState()

    useEffect(() => {
        const disposable = context.onDidReceiveMessage?.((event: MessageToRenderer) => {
            if (event.type === 'statusUpdated') {
                setTasks(event.tasks)
                setWorkerActive(event.workerActive)
            }
        });
        return () => disposable?.dispose()
    }, [context])

    let pauseResumeButton: React.ReactNode;
    if (workerActive) {
        pauseResumeButton = <button onClick={() => {
            context.postMessage?.({
                type: 'pauseWorker'
            });
        }}>Pause</button>
    } else {
        pauseResumeButton = <button onClick={() => {
            context.postMessage?.({
                type: 'resumeWorker'
            });
        }}>Resume</button>
    }

    return <div>
        <style>{style}</style>
        <div>{pauseResumeButton}</div>
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