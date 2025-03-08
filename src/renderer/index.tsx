import type { ActivationFunction, OutputItem, RendererContext } from 'vscode-notebook-renderer';
import React, { useEffect, useState } from 'react';
import ReactDOM from 'react-dom/client';
import type { ITask, MessageFromRenderer, MessageToRenderer, RendererInitializationData } from '../shared';
import ArchiveIcon from './archive-icon.svg';
import { useSelectionState, SelectionState } from './selection_state';

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

        ReactDOM.createRoot(root).render(<TasksComponent tasks={initializationData.tasks} enabled={initializationData.enabled} context={context} />);
    },

    disposeOutputItem(id: string) {
        // Cleanup is handled automatically by VS Code clearing the element
    }
});

function TasksComponent({tasks: initialTasks, enabled: initialEnabled, context}: {tasks: ITask[], enabled: boolean, context: RendererContext<void>}) {
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
        <style>{styles}</style>
        <div>{enableButton}</div>
        <div className="tasks-container" onMouseUp={handleOutsideClick}>
            {tasks.map(task =>
                <TaskComponent
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

function handleClick(evt: React.MouseEvent<HTMLDivElement>, taskId: string, selectionState: SelectionState, isDrop: boolean = false) {
    // console.log(`handleClick: '${taskId}' (${isDrop ? 'drop' : 'click'})`);

    if (evt.shiftKey) {
        if (selectionState.selectedTasks.has(taskId)) {
            let newSelectedTasks = new Set(selectionState.selectedTasks);
            newSelectedTasks.delete(taskId);
            selectionState.setSelectedTasks(newSelectedTasks);
        }
        return;
    }
    if (!evt.ctrlKey) {
        if (selectionState.selectedTasks.has(taskId)) {
            selectionState.setSelectedTasks(new Set([]));
        } else {
            selectionState.setSelectedTasks(new Set([taskId]));
        }
        return;
    }
    let newSelectedTasks = new Set(selectionState.selectedTasks);
    if (selectionState.selectedTasks.has(taskId)) {
        // console.log(`handleClick: '${taskId}' (${isDrop ? 'drop' : 'click'}) deleting`);
        newSelectedTasks.delete(taskId);
    } else {
        // console.log(`handleClick: '${taskId}' (${isDrop ? 'drop' : 'click'}) adding`);
        newSelectedTasks.add(taskId);
    }
    selectionState.setSelectedTasks(newSelectedTasks);
}

function updateSelectedTasksFromDragRange(selectionState: SelectionState, start: string, end: string, tasks: ITask[], evt: React.MouseEvent<HTMLDivElement>) {
    if (start === end) {
        handleClick(evt, start, selectionState);
        return;
    }
    let startIndex = tasks.findIndex(task => task.id === start);
    let endIndex = tasks.findIndex(task => task.id === end);
    if (startIndex === -1 || endIndex === -1) {
        return;
    }
    if (startIndex > endIndex) {
        [startIndex, endIndex] = [endIndex, startIndex];
    }
    let newSelectedTasks = new Set(selectionState.selectedTasks);
    if (evt.shiftKey) {
        for (let i = startIndex; i <= endIndex; i++) {
            newSelectedTasks.delete(tasks[i].id);
        }
    } else if (evt.ctrlKey) {
        for (let i = startIndex; i <= endIndex; i++) {
            newSelectedTasks.add(tasks[i].id);
        }
    } else {
        newSelectedTasks = new Set([]);
        for (let i = startIndex; i <= endIndex; i++) {
            newSelectedTasks.add(tasks[i].id);
        }
    }
    selectionState.setSelectedTasks(newSelectedTasks);
    // console.log(`updateSelectedTasksFromDragRange: setSelectedTasks(${selectionState.selectedTasks})`);
}

function TaskComponent({task, postMessage, selectionState, tasks}: {task: ITask, postMessage: (message: MessageFromRenderer) => void, selectionState: SelectionState, tasks: ITask[]}): React.ReactNode {
    let pauseButton: React.ReactNode | undefined = undefined;
    let [dropTargetStatus, setDropTargetStatus] = useState<'clear' | 'hoveredFromLeft' | 'hoveredFromRight' | 'hoveredByItself'>('clear');

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

    let taskClasses = ['task', task.status.replace('waiting-for-input', 'asking').replace('thrown-exception', 'error')];
    if (selectionState.selectedTasks.has(task.id)) {
        taskClasses.push('selected');
    }
    let draggable = selectionState.dragState !== 'selecting' && selectionState.selectedTasks.has(task.id);
    if (draggable) {
        taskClasses.push('draggable');
    }

    let taskWrapperClasses = ['task-wrapper'];
    if (dropTargetStatus == 'hoveredFromLeft') {
        taskWrapperClasses.push('drop-target-right-edge');
    } else if (dropTargetStatus == 'hoveredFromRight') {
        taskWrapperClasses.push('drop-target-left-edge');
    } 

    let onMouseDown = (evt: React.MouseEvent<HTMLDivElement>) => {
        // console.log(`onMouseDown: ${task.id} (${selectionState.selectedTasks.has(task.id)} ${evt.ctrlKey} ${evt.shiftKey})`);
        if (!selectionState.selectedTasks.has(task.id) || evt.ctrlKey || evt.shiftKey) {
            // console.log(`onMouseDown: setselectionStart(${task.id})`);
            selectionState.setSelectionStart(task.id);
            selectionState.setDragState('selecting');
        }
    };

    let onDragStart = (evt: React.DragEvent<HTMLDivElement>) => {
        // console.log(`onDragStart: ${task.id}`);
        // Here https://medium.com/@reiberdatschi/common-pitfalls-with-html5-drag-n-drop-api-9f011a09ee6c
        // it is advised to call preventDefault() on most events. However, in case of onDragStart,
        // preventDefault() prevents the drag-n-drop from working, so we call stopPropagation() instead.

        evt.stopPropagation();
        selectionState.setDragState('dragging');
        evt.dataTransfer.dropEffect = "move";
        evt.dataTransfer.effectAllowed = "move";

        // this doesn't work, data is not available in dragEnter / dragOver / drop
        evt.dataTransfer.setData("text/plain", task.id + ':' + [...selectionState.selectedTasks.values()].join(','));

        // but this works
        selectionState.setDraggedOverTask(task.id);
    };

    let onDragEnd = (evt: React.DragEvent<HTMLDivElement>) => {
        evt.preventDefault();
        selectionState.setDraggedOverTask(undefined);
    };

    let onDragEnter = (evt: React.DragEvent<HTMLDivElement>) => {
        // console.log(`onDragEnter: '${selectionState.draggedOverTask}' enters '${task.id}'`);

        // We call preventDefault() on most events, as is advised here: https://medium.com/@reiberdatschi/common-pitfalls-with-html5-drag-n-drop-api-9f011a09ee6c
        evt.preventDefault();

        // shows empty data despite the dataTransfer.setData above
        // console.log('drag enter: ' + JSON.stringify(evt.dataTransfer.getData('text/plain')));

        // this works
        let draggedTask = selectionState.draggedOverTask;
        let draggedTaskIndex = tasks.findIndex(task => task.id === draggedTask);
        let myIndex = tasks.findIndex(t => t.id === task.id);
        if (draggedTaskIndex === -1 || myIndex === -1) {
            return;
        }
        if (draggedTaskIndex < myIndex) {
            setDropTargetStatus('hoveredFromLeft');
        } else if (draggedTaskIndex > myIndex) {
            setDropTargetStatus('hoveredFromRight');
        } else {
            setDropTargetStatus('hoveredByItself');
        }
    };

    let onDragOver = (evt: React.DragEvent<HTMLDivElement>) => {
        onDragEnter(evt);
    };

    let onDragLeave = (evt: React.DragEvent<HTMLDivElement>) => {
        evt.preventDefault();
        setDropTargetStatus('clear');
    };

    let onDrop = (evt: React.DragEvent<HTMLDivElement>) => {
        evt.preventDefault();
        // console.log(`onDrop: '${selectionState.draggedOverTask}' drops on '${task.id}' (${dropTargetStatus})`);

        if (dropTargetStatus == 'hoveredByItself') {
            // console.log('onDrop: hoveredByItself');
            setDropTargetStatus('clear');
            handleClick(evt, task.id, selectionState, true);
            return;
        }

        let position;
        if (dropTargetStatus == 'hoveredFromLeft') {
            position = 'after';
        } else if (dropTargetStatus == 'hoveredFromRight') {
            position = 'before';
        }
        setDropTargetStatus('clear');
        selectionState.setDraggedOverTask(undefined);
        selectionState.setDragState('idle');
        postMessage({
            type: 'moveSelectedTasks',
            selectedTasks: [...selectionState.selectedTasks.values()],
            targetTask: task.id, position,
        });
    };

    let onMouseMove = (evt: React.MouseEvent<HTMLDivElement>) => {
        if (selectionState.dragState === 'selecting' && selectionState.selectionStart) {
            updateSelectedTasksFromDragRange(selectionState, selectionState.selectionStart, task.id, tasks, evt);
        }
    };

    let onMouseUp = (evt: React.MouseEvent<HTMLDivElement>) => {
        if (selectionState.dragState === 'selecting' && selectionState.selectionStart) {
            // console.log(`onMouseUp: ${selectionState.selectionStart} -> ${task.id} (selecting)`);
            updateSelectedTasksFromDragRange(selectionState, selectionState.selectionStart, task.id, tasks, evt);
            selectionState.setDragState('idle');
            selectionState.setSelectionStart(undefined);
        } else if (selectionState.dragState === 'idle') {
            // console.log(`onMouseUp: ${task.id} (idle)`);
            handleClick(evt, task.id, selectionState);
        }
    };

    return <div className={taskWrapperClasses.join(' ')} onDragEnter={onDragEnter} onDragOver={onDragOver} onDragLeave={onDragLeave} onDrop={onDrop}>
        <div className={taskClasses.join(' ')} onMouseDown={onMouseDown} onMouseMove={onMouseMove} onMouseUp={onMouseUp}
             onDragStart={onDragStart} onDragEnd={onDragEnd} draggable={draggable}
        >
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

const styles = `
.task-wrapper {
    padding-left: 4px;
    padding-right: 4px;
    border-left: 4px solid transparent;
    border-right: 4px solid transparent;
    margin-left: -2px;
    margin-right: -2px;
    padding-top: 6px;
    padding-bottom: 6px;
    display: inline-block;
}

.task {
    padding: 4px 8px;
    border-radius: 6px;
    font-family: system-ui;
    width: 150px;
    height: 74px;
    position: relative;
    color: var(--color);
    user-select: none;
}
.task-id-wrapper {
    position: absolute;
    bottom: 0px; right: 0px;
    padding-left: 20px;
    padding-top: 14px;
    padding-bottom: 9px;
    padding-right: 12px;
    cursor: default;
    opacity: 0.8;
}
.task-id {
    font-size: 11px;
    border-bottom: 1px dotted var(--color);
    font-family: monospace;
}
.task-id-wrapper:hover {
    opacity: 1;
}
.task-id-wrapper:hover .task-id {
    border-bottom: 1px solid var(--color);
}
.task-prompt {
    position: absolute;
    top: 30px; left: 8px;
    height: 42px;
    width: 150px;
    overflow: hidden;
    display: inline-block;

    word-break: break-all;
    white-space: normal;

    font-size: 13px;
}
.task-buttons {
    position: absolute;
    top: 2px; right: 6px;
}
.task-buttons a {
    opacity: 0.6;
}
.task-buttons a:hover {
    opacity: 1;
}

.task {
    --brown: #876d57;
    --darkbrown: #61544a;
    --lightbrown: #c4b8ae;
    --lightbrown: #cac4bf;
    --transparent-brown: rgba(135, 109, 87, 0.3);
    --green: #4eb369;
    --slightlydarkergreen: #42995b;
    --transparent-green: rgba(78, 179, 105, 0.5);
    --lightgreen: #89d185;
    --whitegreen: #a3d1a0;
    --whitegreen: #b4d2b2;
    
    --blue: #008080;
    --transparent-blue: rgba(0, 128, 128, 0.5);
    --lightblue: #80d1d1;
    --whiteblue: #a0d1d1;
    --whiteblue: #9ac9c9;
    --whiteblue: #90bcbc;

    --red: #ff0000;
    --transparent-red: rgba(200, 30, 50, 0.5);
    --lightred: #d18080;
    --whitered: #ff8080;

    --prepared-badge: #867465;
    --queued-badge: rgba(0, 0, 0, 0.25);
    --running-badge: rgba(0, 0, 0, 0.15);
    --completed-badge: var(--slightlydarkergreen);
    --asking-badge: #a43faf;
    --aborted-badge: #bb0000;
    --error-badge: #bb0000;
}
.running {
    background: linear-gradient(
        270deg, var(--brown) 0%, var(--brown) 20%,
        var(--green) 40%, var(--green) 60%,
        var(--brown) 80%, var(--brown) 100%);
    background-size: 500% 100%;
    box-shadow: 0 0 2px 0px var(--lightbrown) inset;
    --color: white;
    animation: task-running 2s linear infinite;
}
@keyframes task-running {
    0% { background-position: 100% 50%; }
    50% { background-position: 50% 50%; }
    100% { background-position: 0% 50%; }
}

.prepared {
    background: var(--darkbrown);
    box-shadow: 0 0 2px 0px var(--lightbrown) inset;
    --color: white;
}
.queued {
    background: var(--brown);
    box-shadow: 0 0 2px 0px var(--lightbrown) inset;
    --color: white;
}
.completed {
    box-shadow: 0 0 2px 0px var(--lightgreen) inset;
    --color: var(--whitegreen);
    background: linear-gradient(to bottom, var(--transparent-green) 0%, var(--transparent-green) 80%, var(--transparent-green) 100%);
}
.asking {
    box-shadow: 0 0 2px 0px var(--lightblue) inset;
    background: linear-gradient(to bottom, var(--transparent-blue) 0%, var(--transparent-blue) 80%, var(--transparent-blue) 100%);
    --color: var(--whiteblue); 
}
.task.aborted, .task.error { 
    box-shadow: 0 0 2px 0px var(--lightred) inset;
    background: linear-gradient(to bottom, var(--transparent-red) 0%, var(--transparent-red) 80%, var(--transparent-red) 100%);
    --color: var(--whitered);
}

.task-status-badge {
    position: absolute;
    top: 6px; left: 7px;
    padding: 3px 5px;
    border-radius: 6px;
    font-size: 12px;
    font-weight: bold;
}

.prepared .task-status-badge {
    background: var(--prepared-badge);
    color: white;
}
.queued .task-status-badge {
    background: var(--queued-badge);
    color: white;
}
.running .task-status-badge {
    background: var(--running-badge);
    color: white;
}
.completed .task-status-badge {
    background: var(--completed-badge);
    color: white;
}
.asking .task-status-badge {
    background: var(--asking-badge);
    color: rgba(255, 255, 255, 0.85);
}
.aborted .task-status-badge {
    background: var(--aborted-badge);
    color: rgba(255, 255, 255, 0.85);
}
.error .task-status-badge {
    background: var(--error-badge);
    color: rgba(255, 255, 255, 0.85);
}

.task.selected {
    box-shadow: 0 0 2px 2px rgba(0, 150, 255) inset;
    --color: rgba(100, 200, 255);
}
.task.selected .task-status-badge {
    color: rgba(100, 200, 255) !important;
}
.task.draggable {
    cursor: move;
}

.task-wrapper.drop-target-right-edge {
    border-right: 4px solid rgba(0, 150, 255);
}
.task-wrapper.drop-target-left-edge {
    border-left: 4px solid rgba(0, 150, 255);
}
`;
