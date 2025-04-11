import { TaskStatus } from "./roospawn";

export interface RendererTask {
    id: string;
    prompt: string;
    summary: string[];
    mode: string;
    status: TaskStatus;
    archived: boolean;
}

export interface RendererInitializationData {
    tasks: RendererTask[];
    workerActive: boolean;
}

export type MessageFromRenderer = {
    type: 'submitTasks' | 'cancelTasks' | 'archiveTasks' | 'unarchiveTasks'
    taskIds: string[],
} | {
    type: 'pauseWorker' | 'resumeWorker'
} | {
    type: 'moveSelectedTasks',
    selectedTasks: string[],
    targetTask: string,
    position: 'before' | 'after',
};

export type MessageToRenderer = {
    type: 'statusUpdated',
    tasks: RendererTask[],
    workerActive: boolean,
};
