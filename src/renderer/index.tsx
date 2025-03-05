import type { ActivationFunction, OutputItem, RendererContext } from 'vscode-notebook-renderer';
import React, { useEffect, useState } from 'react';
import ReactDOM from 'react-dom/client';
import type { ITask, MessageFromRenderer, MessageToRenderer, RendererInitializationData } from '../shared';


export const activate: ActivationFunction = (context: RendererContext<void>) => ({
    renderOutputItem(data: OutputItem, element: HTMLElement) {
        const initializationData = data.json() as RendererInitializationData;

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

    return <div>
        <style>{styles}</style>
        <div>{enableButton}</div>
        <div>
            {tasks.map(task =>
                <TaskComponent
                    key={task.id}
                    task={task}
                    postMessage={(message: MessageFromRenderer) => context.postMessage?.(message)}
                />
            )}
        </div>
    </div>;
}

function TaskComponent({task, postMessage}: {task: ITask, postMessage: (message: MessageFromRenderer) => void}): React.ReactNode {
    let pauseButton: React.ReactNode | undefined = undefined;
    if (task.status === 'queued') {
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
        <svg xmlns="http://www.w3.org/2000/svg" width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor"
             strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" > <path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2 -2v-2"
        />
            <path d="M7 11l5 5l5 -5" /> <path d="M12 4l0 12" />
        </svg>
    </a>;

    return <div className={'task ' + task.status.replace('waiting-for-input', 'asking').replace('thrown-exception', 'error')}>
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
</div>;
}

const styles = `
.task {
    padding: 4px 8px;
    border-radius: 6px;
    margin: 4px 4px;
    font-family: system-ui;
    width: 150px;
    height: 74px;
    display: inline-block;
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
.aborted, .error { 
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
}
.queued .task-status-badge {
    background: var(--queued-badge);
}
.running .task-status-badge {
    background: var(--running-badge);
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
`;
