export type TaskStatus = 'queued' | 'active' | 'completed' | 'paused' | 'deleted';

export interface ITask {
    id: string;
    prompt: string;
    cmd_before: string | undefined;
    cmd_after: string | undefined;
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
