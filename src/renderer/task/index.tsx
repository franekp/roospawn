import React from 'react'
import { ITask, MessageFromRenderer } from '../../shared'
import { useSelectable } from './selectable'
import { useDraggable } from './draggable'
import { useDropTarget } from './drop_target'
import { SelectionState } from '../selection_state'
import TaskButtons from './buttons'


type TaskProps = {
    task: ITask,
    postMessage: (message: MessageFromRenderer) => void,
    selectionState: SelectionState,
    tasks: ITask[]
}

export default function Task({task, postMessage, selectionState, tasks}: TaskProps): React.ReactNode {
    const taskStatus = task.status
    let taskClasses = ['task', taskStatus]

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
                {taskStatus}
            </div>
            <div className="task-prompt">{task.summary.join(' ... ')}</div>
            <TaskButtons task={task} postMessage={postMessage} />
            <div className="task-id-wrapper">
                <div className="task-id">#{task.id}</div>
            </div>
        </div>
    </div>
}
