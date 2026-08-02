import type {
    WorkspaceCommit,
    WorkspaceCommitReceipt,
    WorkspaceEnvironment,
    WorkspaceFailure,
    WorkspaceSnapshot,
} from "../lib/types.js";

export interface WorkspaceAdapter {
    readonly environment: WorkspaceEnvironment;

    readWorkspace(): Promise<WorkspaceSnapshot>;

    commit(change: WorkspaceCommit): Promise<WorkspaceCommitReceipt>;
}

export class WorkspaceAdapterError extends Error {
    readonly failure: WorkspaceFailure;

    constructor(failure: WorkspaceFailure, options: { readonly cause?: unknown } = {}) {
        super(failure.message, options);
        this.name = "WorkspaceAdapterError";
        this.failure = failure;
    }
}