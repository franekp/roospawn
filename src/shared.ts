import { Task } from "./roospawn";

export type TaskStatus =
    | 'prepared' | 'queued' | 'running' | 'paused' | 'completed' | 'waiting-for-input' | 'aborted'
    | 'archived-prepared' | 'archived-completed' | 'archived-waiting-for-input' | 'archived-aborted'
    | 'thrown-exception'
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
