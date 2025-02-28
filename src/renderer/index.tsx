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

    let enableButton: React.ReactNode | undefined;
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
        pauseButton = <button onClick={() => {
            postMessage({
                type: 'pause',
                id: task.id
            });
        }}>Pause</button>;
    }

    let resumeButton: React.ReactNode | undefined = undefined;
    if (task.status === 'paused') {
        resumeButton = <button onClick={() => {
            postMessage({
                type: 'resume',
                id: task.id
            });
        }}>Resume</button>;
    }

    let moveUpButton = <button onClick={(evt) => {
        const type = evt.shiftKey ? 'moveToTop' : 'moveUp';
        postMessage({ type, id: task.id });
    }}>Up</button>;

    let moveDownButton = <button onClick={(evt) => {
        const type = evt.shiftKey ? 'moveToBottom' : 'moveDown';
        postMessage({ type, id: task.id });
    }}>Down</button>;

    let deleteButton = <button onClick={() => {
        postMessage({
            type: 'delete',
            id: task.id
        });
    }}>Delete</button>;

    return <div className='task-container'>
        <div className={ "task " + task.status }>
            <span className="task-id">#{task.id}</span>
            <span className="task-prompt">{task.prompt}</span>
            <span className="task-buttons">
                {pauseButton}
                {resumeButton}
                {moveUpButton}
                {moveDownButton}
                {deleteButton}
            </span>
        </div>
    </div>;
}

const styles = `
.task-container { font-family: system-ui; margin: 4px 0; }
.task { padding: 4px 8px; border-radius: 4px; }
.task-id { font-size: 0.8em; opacity: 0.7; margin-right: 4px; }
.task-prompt { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 300px; display: inline-block; }
.task-buttons { display: inline-block; float: right; }
.active { 
    background: linear-gradient(270deg, #ff9933, #ffb366);
    background-size: 200% 100%;
    color: white;
    animation: gradient 2s ease infinite;
}
@keyframes gradient {
    0% { background-position: 0% 50%; }
    50% { background-position: 100% 50%; }
    100% { background-position: 0% 50%; }
}
.queued { background: #ffff00; color: black; }
.completed { background: #008080; color: white; }
.paused { background: #808080; color: white; }
`;
