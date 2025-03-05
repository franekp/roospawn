export type TaskStatus = 'queued' | 'running' | 'completed' | 'hanging' | 'aborted' | 'prepared' | 'deleted' | 'thrown-exception';

export interface ITask {
    id: string;
    prompt: string;
    summary: string[];
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
