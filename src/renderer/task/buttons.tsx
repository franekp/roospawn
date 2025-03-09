import React from 'react'
import { ITask, MessageFromRenderer } from '../../shared'
import ArchiveArrowDownIcon from '../icons/archive-arrow-down.svg'
import AddToQueueIcon from '../icons/add-to-queue.svg'
import RemoveFromQueueIcon from '../icons/remove-from-queue.svg'
import ResumeTaskIcon from '../icons/resume-task.svg'


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
            <RemoveFromQueueIcon width={18} height={18} />
        </a>;
    }

    let unpauseButton: React.ReactNode | undefined = undefined;
    if (task.status === 'prepared') {
        unpauseButton = <a onClick={() => {
            postMessage({
                type: 'resume',
                id: task.id
            });
        }}>
            <AddToQueueIcon width={18} height={18} />
        </a>;
    }

    let resumeButton: React.ReactNode | undefined = undefined;
    if (['completed', 'asking', 'aborted', 'error'].includes(task.status)) {
        resumeButton = <a onClick={() => {
            // postMessage({
            //     type: 'resume',
            //     id: task.id
            // });
        }}>
            <ResumeTaskIcon width={20} height={20} />
        </a>
    }

    let deleteButton: React.ReactNode | undefined = undefined;
    if (!['queued', 'running'].includes(task.status)) {
        deleteButton = <a onClick={() => {
            postMessage({
                type: 'delete',
                id: task.id
            });
        }}>
            <ArchiveArrowDownIcon width={18} height={18} />
        </a>
    }

    return <div className="task-buttons">
        {pauseButton}
        {unpauseButton}
        {resumeButton}
        {deleteButton}
    </div>
}
