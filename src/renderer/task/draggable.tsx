import { type SelectionState } from "../selection_state";
import { type RendererTask } from "../../renderer_interface";

export interface Draggable {
    events: {
        onDragStart: (evt: React.DragEvent<HTMLDivElement>) => void,
        onDragEnd: (evt: React.DragEvent<HTMLDivElement>) => void,
    },
    ready: boolean,
}

export function useDraggable(selectionState: SelectionState, task: RendererTask): Draggable {

    const onDragStart = (evt: React.DragEvent<HTMLDivElement>) => {
        // console.log(`onDragStart: ${task.id}`)
        // Here https://medium.com/@reiberdatschi/common-pitfalls-with-html5-drag-n-drop-api-9f011a09ee6c
        // it is advised to call preventDefault() on most events. However, in case of onDragStart,
        // preventDefault() prevents the drag-n-drop from working, so we call stopPropagation() instead.

        evt.stopPropagation()
        selectionState.setDragState('dragging')
        evt.dataTransfer.dropEffect = "move"
        evt.dataTransfer.effectAllowed = "move"

        // this doesn't work, data is not available in dragEnter / dragOver / drop
        evt.dataTransfer.setData("text/plain", task.id + ':' + [...selectionState.selectedTasks.values()].join(','))

        // but this works
        selectionState.setDraggedOverTask(task.id)
    }

    const onDragEnd = (evt: React.DragEvent<HTMLDivElement>) => {
        evt.preventDefault()
        selectionState.setDraggedOverTask(undefined)
    }

    let ready = selectionState.dragState !== 'selecting' && selectionState.selectedTasks.has(task.id)

    return {
        events: {
            onDragStart,
            onDragEnd,
        },
        ready,
    }
}
