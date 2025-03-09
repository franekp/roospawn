import { Task } from "./roospawn";

export type TaskStatus =
    | 'prepared' | 'queued' | 'running' | 'paused' | 'completed' | 'asking' | 'aborted'
    | 'archived-prepared' | 'archived-completed' | 'archived-asking' | 'archived-aborted'
    | 'error'
    ;

export interface ITask {
    id: string;
    prompt: string;
    summary: string[];
    mode: string;
    status: TaskStatus;
}

export interface RendererInitializationData {
    tasks: ITask[];
    enabled: boolean;
}

export type MessageFromRenderer = {
    type: 'pause' | 'resume' | 'delete' | 'moveUp' | 'moveDown' | 'moveToTop' | 'moveToBottom',
    id: string,
} | {
    type: 'enable' | 'disable'
} | {
    type: 'moveSelectedTasks',
    selectedTasks: string[],
    targetTask: string,
    position: 'before' | 'after',
};

export type MessageToRenderer = {
    type: 'statusUpdated',
    tasks: ITask[],
    enabled: boolean,
};

export interface Hooks {
    onstart: ((task: Task) => string | undefined) | undefined;
    oncomplete: ((task: Task) => string | undefined) | undefined;
    onpause: ((task: Task) => string | undefined) | undefined;
    onresume: ((task: Task) => string | undefined) | undefined;
}
