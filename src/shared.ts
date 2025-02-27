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
}

export type MessageFromRenderer = {
    type: 'moveUp' | 'moveDown' | 'delete' | 'pause' | 'resume',
    id: string,
};

export type MessageToRenderer = {
    type: 'statusUpdated',
    tasks: ITask[],
};
