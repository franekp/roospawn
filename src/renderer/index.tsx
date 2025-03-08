import type { ActivationFunction, OutputItem, RendererContext } from 'vscode-notebook-renderer';
import React, { useEffect, useState } from 'react';
import ReactDOM from 'react-dom/client';
import type { ITask, MessageFromRenderer, MessageToRenderer, RendererInitializationData } from '../shared';
import ArchiveIcon from './archive-icon.svg';
import { useSelectionState, SelectionState } from './selection_state';
import { useSelectable, handleClick } from './task/selectable';
import { useDraggable } from './task/draggable';
import { useDropTarget } from './task/drop_target';

export const activate: ActivationFunction = (context: RendererContext<void>) => ({
    renderOutputItem(data: OutputItem, element: HTMLElement) {
        const initializationData = data.json() as RendererInitializationData;

        // remove annoying orange outline that sometimes appears
        // apparently, it's from user agent stylesheet of chrome and VS Code is setting
        // tabindex on it, so chrome thinks it must highlight it when clicked inside
        // user agent stylesheet contains this:
        // :focus-visible {
        //     outline: -webkit-focus-ring-color auto 1px;
        // }
        element.style.outline = 'none';

        let shadow = element.shadowRoot;
        if (!shadow) {
            shadow = element.attachShadow({ mode: 'open' });
            const root = document.createElement('div');
            root.id = 'root';
            shadow.append(root);
        }

        const root = shadow.querySelector<HTMLElement>('#root');
        if (!root) {
            throw new Error('Could not find root element');
        }

        ReactDOM.createRoot(root).render(<TaskList tasks={initializationData.tasks} enabled={initializationData.enabled} context={context} />);
    },

    disposeOutputItem(id: string) {
        // Cleanup is handled automatically by VS Code clearing the element
    }
});

function TaskList({tasks: initialTasks, enabled: initialEnabled, context}: {tasks: ITask[], enabled: boolean, context: RendererContext<void>}) {
    let [tasks, setTasks] = useState<ITask[]>(initialTasks);
    let [enabled, setEnabled] = useState<boolean>(initialEnabled);

    let selectionState = useSelectionState();

    useEffect(() => {
        const disposable = context.onDidReceiveMessage?.((event: MessageToRenderer) => {
            if (event.type === 'statusUpdated') {
                setTasks(event.tasks);
                setEnabled(event.enabled);
            }
        });
        return () => disposable?.dispose();
    }, [context]);

    let enableButton: React.ReactNode;
    if (enabled) {
        enableButton = <button onClick={() => {
            context.postMessage?.({
                type: 'disable'
            });
        }}>Disable</button>;
    } else {
        enableButton = <button onClick={() => {
            context.postMessage?.({
                type: 'enable'
            });
        }}>Enable</button>;
    }

    const handleOutsideClick = (evt: React.MouseEvent<HTMLElement>) => {
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

    return <div>
        <style>{style}</style>
        <div>{enableButton}</div>
        <div className="tasks-container" onMouseUp={handleOutsideClick}>
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
    </div>;
}

function Task({task, postMessage, selectionState, tasks}: {task: ITask, postMessage: (message: MessageFromRenderer) => void, selectionState: SelectionState, tasks: ITask[]}): React.ReactNode {
    let pauseButton: React.ReactNode | undefined = undefined;

    if (task.status === 'queued') {
        // icons are from https://tablericons.com/
        pauseButton = <a onClick={() => {
            postMessage({
                type: 'pause',
                id: task.id
            });
        }}>
            <svg xmlns="http://www.w3.org/2000/svg" width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor"
                 strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"
            >
                <path d="M14 3v4a1 1 0 0 0 1 1h4" />
                <path d="M17 21h-10a2 2 0 0 1 -2 -2v-14a2 2 0 0 1 2 -2h7l5 5v11a2 2 0 0 1 -2 2z" />
                <path d="M10 12l4 4m0 -4l-4 4" />
            </svg>
        </a>;
    }

    let resumeButton: React.ReactNode | undefined = undefined;
    if (task.status === 'prepared') {
        resumeButton = <a onClick={() => {
            postMessage({
                type: 'resume',
                id: task.id
            });
        }}>
            <svg xmlns="http://www.w3.org/2000/svg" width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor"
                 strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"
            >
                <path d="M14 3v4a1 1 0 0 0 1 1h4" />
                <path d="M17 21h-10a2 2 0 0 1 -2 -2v-14a2 2 0 0 1 2 -2h7l5 5v11a2 2 0 0 1 -2 2z" />
                <path d="M9 15l2 2l4 -4" />
            </svg> 
        </a>;
    }

    let moveUpButton = <a onClick={(evt) => {
        const type = evt.shiftKey ? 'moveToTop' : 'moveUp';
        postMessage({ type, id: task.id });
    }}>
        <svg xmlns="http://www.w3.org/2000/svg" width={14} height={14} viewBox="0 0 24 24" fill="currentColor" stroke="currentColor"
             strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" style={{paddingBottom: 1}}
        >
            <path d="M9 20v-8h-3.586a1 1 0 0 1 -.707 -1.707l6.586 -6.586a1 1 0 0 1 1.414 0l6.586 6.586a1 1 0 0 1 -.707 1.707h-3.586v8a1 1 0 0 1 -1 1h-4a1 1 0 0 1 -1 -1z" />
        </svg> 
    </a>;

    let moveDownButton = <a onClick={(evt) => {
        const type = evt.shiftKey ? 'moveToBottom' : 'moveDown';
        postMessage({ type, id: task.id });
    }}>
        <svg xmlns="http://www.w3.org/2000/svg" width={14} height={14} viewBox="0 0 24 24" fill="currentColor" stroke="currentColor"
             strokeWidth={1} strokeLinecap="round" strokeLinejoin="round" style={{paddingBottom: 1}}
        >
            <path d="M15 4v8h3.586a1 1 0 0 1 .707 1.707l-6.586 6.586a1 1 0 0 1 -1.414 0l-6.586 -6.586a1 1 0 0 1 .707 -1.707h3.586v-8a1 1 0 0 1 1 -1h4a1 1 0 0 1 1 1z" />
        </svg> 
    </a>;

    let deleteButton = <a onClick={() => {
        postMessage({
            type: 'delete',
            id: task.id
        });
    }}>
        <ArchiveIcon width={16} height={16} />
    </a>;

    let taskClasses = ['task', task.status.replace('waiting-for-input', 'asking').replace('thrown-exception', 'error')]

    const selectable = useSelectable(selectionState, task, tasks)
    if (selectable.selected) {
        taskClasses.push('selected')
    }

    const draggable = useDraggable(selectionState, task)
    if (draggable.ready) {
        taskClasses.push('draggable')
    }

    const dropTarget = useDropTarget(selectionState, task, tasks, postMessage);

    let taskWrapperClasses = ['task-wrapper']
    if (dropTarget.status == 'hoveredFromLeft') {
        taskWrapperClasses.push('drop-target-right-edge')
    } else if (dropTarget.status == 'hoveredFromRight') {
        taskWrapperClasses.push('drop-target-left-edge')
    }

    return <div className={taskWrapperClasses.join(' ')} {...dropTarget.events}>
        <div className={taskClasses.join(' ')} {...selectable.events} {...draggable.events} draggable={draggable.ready}>
            <div className="task-status-badge">
                {task.status.replace('waiting-for-input', 'asking').replace('thrown-exception', 'error')}
            </div>

            <div className="task-prompt">{task.summary.join(' ... ')}</div>

            <div className="task-buttons">
                {pauseButton}
                {resumeButton}
                {moveUpButton}
                {moveDownButton}
                {deleteButton}
            </div>
            <div className="task-id-wrapper">
                <div className="task-id">#{task.id}</div>
            </div>
        </div>
    </div>;
}

import style from './task/style.css';

