import { type SelectionState } from "../selection_state";
import { type ITask } from "../../shared";

export interface Selectable {
    events: {
        onMouseDown: (evt: React.MouseEvent<HTMLDivElement>) => void,
        onMouseUp: (evt: React.MouseEvent<HTMLDivElement>) => void,
        onMouseMove: (evt: React.MouseEvent<HTMLDivElement>) => void,
    }
    selected: boolean,
}

export function useSelectable(selectionState: SelectionState, task: ITask, tasks: ITask[]): Selectable {

    const onMouseDown = (evt: React.MouseEvent<HTMLDivElement>) => {
        // console.log(`onMouseDown: ${task.id} (${selectionState.selectedTasks.has(task.id)} ${evt.ctrlKey} ${evt.shiftKey})`)
        if (!selectionState.selectedTasks.has(task.id) || evt.ctrlKey || evt.shiftKey) {
            // console.log(`onMouseDown: setselectionStart(${task.id})`)
            selectionState.setSelectionStart(task.id)
            selectionState.setDragState('selecting')
        }
    }

    const onMouseMove = (evt: React.MouseEvent<HTMLDivElement>) => {
        if (selectionState.dragState === 'selecting' && selectionState.selectionStart) {
            updateSelectedTasksFromDragRange(selectionState, selectionState.selectionStart, task.id, tasks, evt)
        }
    }

    const onMouseUp = (evt: React.MouseEvent<HTMLDivElement>) => {
        if (selectionState.dragState === 'selecting' && selectionState.selectionStart) {
            // console.log(`onMouseUp: ${selectionState.selectionStart} -> ${task.id} (selecting)`)
            updateSelectedTasksFromDragRange(selectionState, selectionState.selectionStart, task.id, tasks, evt)
            selectionState.setDragState('idle')
            selectionState.setSelectionStart(undefined)
        } else if (selectionState.dragState === 'idle') {
            // console.log(`onMouseUp: ${task.id} (idle)`)
            handleClick(evt, task.id, selectionState)
        }
    }

    const selected = selectionState.selectedTasks.has(task.id)

    return {
        events: {
            onMouseDown,
            onMouseUp,
            onMouseMove
        },
        selected: selected,
    }
}

function updateSelectedTasksFromDragRange(selectionState: SelectionState, start: string, end: string, tasks: ITask[], evt: React.MouseEvent<HTMLDivElement>) {
    if (start === end) {
        handleClick(evt, start, selectionState)
        return
    }
    let startIndex = tasks.findIndex(task => task.id === start)
    let endIndex = tasks.findIndex(task => task.id === end)
    if (startIndex === -1 || endIndex === -1) {
        return
    }
    if (startIndex > endIndex) {
        [startIndex, endIndex] = [endIndex, startIndex]
    }
    let newSelectedTasks = new Set(selectionState.selectedTasks);
    if (evt.shiftKey) {
        for (let i = startIndex; i <= endIndex; i++) {
            newSelectedTasks.delete(tasks[i].id)
        }
    } else if (evt.ctrlKey) {
        for (let i = startIndex; i <= endIndex; i++) {
            newSelectedTasks.add(tasks[i].id)
        }
    } else {
        newSelectedTasks = new Set([])
        for (let i = startIndex; i <= endIndex; i++) {
            newSelectedTasks.add(tasks[i].id)
        }
    }
    selectionState.setSelectedTasks(newSelectedTasks)
    // console.log(`updateSelectedTasksFromDragRange: setSelectedTasks(${selectionState.selectedTasks})`)
}

export function handleClick(evt: React.MouseEvent<HTMLDivElement>, taskId: string, selectionState: SelectionState, isDrop: boolean = false) {
    // console.log(`handleClick: '${taskId}' (${isDrop ? 'drop' : 'click'})`)

    if (evt.shiftKey) {
        if (selectionState.selectedTasks.has(taskId)) {
            let newSelectedTasks = new Set(selectionState.selectedTasks)
            newSelectedTasks.delete(taskId)
            selectionState.setSelectedTasks(newSelectedTasks)
        }
        return
    }
    if (!evt.ctrlKey) {
        if (selectionState.selectedTasks.has(taskId)) {
            selectionState.setSelectedTasks(new Set([]))
        } else {
            selectionState.setSelectedTasks(new Set([taskId]))
        }
        return
    }
    let newSelectedTasks = new Set(selectionState.selectedTasks)
    if (selectionState.selectedTasks.has(taskId)) {
        // console.log(`handleClick: '${taskId}' (${isDrop ? 'drop' : 'click'}) deleting`)
        newSelectedTasks.delete(taskId)
    } else {
        // console.log(`handleClick: '${taskId}' (${isDrop ? 'drop' : 'click'}) adding`)
        newSelectedTasks.add(taskId)
    }
    selectionState.setSelectedTasks(newSelectedTasks)
}
