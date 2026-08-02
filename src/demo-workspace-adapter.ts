import { createDemoWorkspace } from "../lib/demo-data.js";
import type { WorkspaceCommit, WorkspaceCommitReceipt, WorkspaceSnapshot } from "../lib/types.js";
import {
    commitDemoWorkspace,
    createDemoStoreState,
    type DemoStoreState,
} from "./demo-store.js";
import type { WorkspaceAdapter } from "./workspace-adapter.js";

export class DemoWorkspaceAdapter implements WorkspaceAdapter {
    readonly environment = "demo" as const;

    #state: DemoStoreState;

    constructor(initialWorkspace: WorkspaceSnapshot = createDemoWorkspace()) {
        this.#state = createDemoStoreState(initialWorkspace);
    }

    async readWorkspace(): Promise<WorkspaceSnapshot> {
        const snapshot = structuredClone(this.#state.snapshot);
        return { ...snapshot, fetchedAt: new Date().toISOString() };
    }

    async commit(change: WorkspaceCommit): Promise<WorkspaceCommitReceipt> {
        const result = commitDemoWorkspace(this.#state, change);
        this.#state = result.state;
        return result.receipt;
    }
}