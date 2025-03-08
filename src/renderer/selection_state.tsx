import { useState } from "react";

export interface SelectionState {
    dragState: 'idle' | 'selecting' | 'dragging';
    selectionStart: string | undefined;  // task id
    selectedTasks: Set<string>;  // task ids
    draggedOverTask: string | undefined;  // task id
    setDragState: (dragState: 'idle' | 'selecting' | 'dragging') => void;
    setSelectionStart: (selectionStart: string | undefined) => void;
    setSelectedTasks: (selectedTasks: Set<string>) => void;
    setDraggedOverTask: (draggedOverTask: string | undefined) => void;
}

export function useSelectionState(): SelectionState {
    let [dragState, setDragState] = useState<'idle' | 'selecting' | 'dragging'>('idle');
    let [selectionStart, setSelectionStart] = useState<string | undefined>(undefined);  // task id
    let [selectedTasks, setSelectedTasks] = useState<Set<string>>(new Set([]));  // task ids
    let [draggedOverTask, setDraggedOverTask] = useState<string | undefined>(undefined);  // task id

    return {
        dragState,
        selectionStart,
        selectedTasks,
        draggedOverTask,
        setDragState,
        setSelectionStart,
        setSelectedTasks,
        setDraggedOverTask,
    };
}
