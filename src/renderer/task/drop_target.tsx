import { useState } from "react";

import { type SelectionState } from "../selection_state";
import { type ITask , type MessageFromRenderer} from "../../shared";
import { handleClick } from "./selectable";

export interface DropTarget {
    events: {
        onDragEnter: (evt: React.DragEvent<HTMLDivElement>) => void,
        onDragOver: (evt: React.DragEvent<HTMLDivElement>) => void,
        onDragLeave: (evt: React.DragEvent<HTMLDivElement>) => void,
        onDrop: (evt: React.DragEvent<HTMLDivElement>) => void,
    },
    status: 'clear' | 'hoveredFromLeft' | 'hoveredFromRight' | 'hoveredByItself',
}

export function useDropTarget(selectionState: SelectionState, task: ITask, tasks: ITask[], postMessage: (message: MessageFromRenderer) => void): DropTarget {
    const [status, setStatus] = useState<'clear' | 'hoveredFromLeft' | 'hoveredFromRight' | 'hoveredByItself'>('clear');

    const onDragEnter = (evt: React.DragEvent<HTMLDivElement>) => {
        // console.log(`onDragEnter: '${selectionState.draggedOverTask}' enters '${task.id}'`)

        // We call preventDefault() on most events, as is advised here: https://medium.com/@reiberdatschi/common-pitfalls-with-html5-drag-n-drop-api-9f011a09ee6c
        evt.preventDefault()

        // shows empty data despite the dataTransfer.setData above
        // console.log('drag enter: ' + JSON.stringify(evt.dataTransfer.getData('text/plain')))

        // this works
        let draggedTask = selectionState.draggedOverTask
        let draggedTaskIndex = tasks.findIndex(task => task.id === draggedTask)
        let myIndex = tasks.findIndex(t => t.id === task.id)
        if (draggedTaskIndex === -1 || myIndex === -1) {
            return;
        }
        if (draggedTaskIndex < myIndex) {
            setStatus('hoveredFromLeft')
        } else if (draggedTaskIndex > myIndex) {
            setStatus('hoveredFromRight')
        } else {
            setStatus('hoveredByItself')
        }
    }

    const onDragOver = (evt: React.DragEvent<HTMLDivElement>) => {
        onDragEnter(evt)
    }

    const onDragLeave = (evt: React.DragEvent<HTMLDivElement>) => {
        evt.preventDefault()
        setStatus('clear')
    }

    const onDrop = (evt: React.DragEvent<HTMLDivElement>) => {
        evt.preventDefault()
        // console.log(`onDrop: '${selectionState.draggedOverTask}' drops on '${task.id}' (${dropTargetStatus})`)

        if (status == 'hoveredByItself') {
            // console.log('onDrop: hoveredByItself')
            setStatus('clear')
            handleClick(evt, task.id, selectionState, true)
            return
        }

        let position;
        if (status == 'hoveredFromLeft') {
            position = 'after'
        } else if (status == 'hoveredFromRight') {
            position = 'before'
        }
        setStatus('clear')
        selectionState.setDraggedOverTask(undefined)
        selectionState.setDragState('idle')
        postMessage({
            type: 'moveSelectedTasks',
            selectedTasks: [...selectionState.selectedTasks.values()],
            targetTask: task.id, position,
        });
    }

    return {
        events: {
            onDragEnter,
            onDragOver,
            onDragLeave,
            onDrop,
        },
        status,
    }
}
