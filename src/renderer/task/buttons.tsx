import React from 'react'
import { ITask, MessageFromRenderer } from '../../shared'
import ArchiveIcon from '../icons/archive-icon.svg'


type TaskButtonsProps = {
    task: ITask,
    postMessage: (message: MessageFromRenderer) => void,
}

export default function TaskButtons({task, postMessage}: TaskButtonsProps): React.ReactNode {
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
    </a>
    
    return <div className="task-buttons">
        {pauseButton}
        {resumeButton}
        {moveUpButton}
        {moveDownButton}
        {deleteButton}
    </div>
}
