import '../svg.d.ts'  // ts langserver needs this, not needed to compile without errors
import React from 'react'
import { RendererTask, MessageFromRenderer } from '../../renderer_interface'
import ArchiveIcon from '../icons/archive-arrow-down.svg'
import UnarchiveIcon from '../icons/archive-arrow-up.svg'
import SubmitIcon from '../icons/submit.svg'
import CancelIcon from '../icons/cancel.svg'


type TaskButtonsProps = {
    task: RendererTask,
    postMessage: (message: MessageFromRenderer) => void,
}

export default function TaskButtons({task, postMessage}: TaskButtonsProps): React.ReactNode {
    let submitButton: React.ReactNode | undefined = undefined;
    if (task.status !== 'queued' && task.status !== 'running' && !task.archived) {
        submitButton = <a onClick={() => {
            postMessage({
                type: 'submitTasks',
                taskIds: [task.id]
            });
        }}>
            <SubmitIcon width={18} height={18} />
        </a>;
    }
    let cancelButton: React.ReactNode | undefined = undefined;
    if (task.status === 'queued') {
        // icons are from https://tablericons.com/
        cancelButton = <a onClick={() => {
            postMessage({
                type: 'cancelTasks',
                taskIds: [task.id]
            });
        }}>
            <CancelIcon width={18} height={18} />
        </a>;
    }
    let archiveButton: React.ReactNode | undefined = undefined;
    if (!['queued', 'running'].includes(task.status) && !task.archived) {
        archiveButton = <a onClick={() => {
            postMessage({
                type: 'archiveTasks',
                taskIds: [task.id]
            });
        }}>
            <ArchiveIcon width={18} height={18} />
        </a>
    }
    let unarchiveButton: React.ReactNode | undefined = undefined;
    if (task.archived) {
        unarchiveButton = <a onClick={() => {
            postMessage({
                type: 'unarchiveTasks',
                taskIds: [task.id]
            });
        }}>
            <UnarchiveIcon width={18} height={18} />
        </a>
    }
    return <div className="task-buttons">
        {cancelButton}
        {submitButton}
        {archiveButton}
        {unarchiveButton}
    </div>
}
