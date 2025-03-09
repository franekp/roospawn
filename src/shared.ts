import { Task } from "./roospawn";

export type TaskStatus =
    | 'prepared' | 'queued' | 'running'
    | 'completed' | 'asking' | 'aborted' | 'error'
    ;

export interface ITask {
    id: string;
    prompt: string;
    summary: string[];
    mode: string;
    status: TaskStatus;
    archived: boolean;
}

export interface RendererInitializationData {
    tasks: ITask[];
    workerActive: boolean;
}

export type MessageFromRenderer = {
    type: 'submitTask' | 'cancelTask' | 'archiveTask' | 'unarchiveTask'
    id: string,
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
    tasks: ITask[],
    workerActive: boolean,
};

export interface Hooks {
    onstart: ((task: Task) => string | undefined) | undefined;
    oncomplete: ((task: Task) => string | undefined) | undefined;
    onpause: ((task: Task) => string | undefined) | undefined;
    onresume: ((task: Task) => string | undefined) | undefined;
}
