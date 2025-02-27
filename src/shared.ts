export type TaskStatus = 'queued' | 'active' | 'completed' | 'paused' | 'deleted';

export interface ITask {
    id: string;
    prompt: string;
    cmd_before: string | undefined;
    cmd_after: string | undefined;
    status: TaskStatus;
}
