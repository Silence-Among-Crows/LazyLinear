import type {
    WorkspaceCommit,
    WorkspaceCommitReceipt,
    WorkspaceEnvironment,
    WorkspaceFailure,
    WorkspaceResourceReference,
    WorkspaceSave,
    WorkspaceSnapshot,
} from "../lib/types.js";
import { WorkspaceAdapterError, type WorkspaceAdapter } from "./workspace-adapter.js";

export interface WorkspaceCommittedOutcome {
    readonly id: number;
    readonly status: "committed";
    readonly receipt: WorkspaceCommitReceipt;
}

interface WorkspaceStateBase {
    readonly revision: number;
    readonly environment: WorkspaceEnvironment;
}

export type WorkspaceState =
    | (WorkspaceStateBase & {
        readonly phase: "initial";
    })
    | (WorkspaceStateBase & {
        readonly phase: "loading";
        readonly snapshot?: WorkspaceSnapshot;
    })
    | (WorkspaceStateBase & {
        readonly phase: "ready";
        readonly snapshot: WorkspaceSnapshot;
        readonly outcome?: WorkspaceCommittedOutcome;
    })
    | (WorkspaceStateBase & {
        readonly phase: "changing";
        readonly snapshot: WorkspaceSnapshot;
        readonly operation:
            | { readonly kind: "save"; readonly change: WorkspaceSave }
            | { readonly kind: "remove"; readonly target: WorkspaceResourceReference };
    })
    | (WorkspaceStateBase & {
        readonly phase: "failed";
        readonly snapshot?: WorkspaceSnapshot;
        readonly failure: WorkspaceFailure;
    })
    | (WorkspaceStateBase & {
        readonly phase: "stale";
        readonly snapshot: WorkspaceSnapshot;
        readonly failure: WorkspaceFailure;
        readonly outcome: WorkspaceCommittedOutcome;
    });

export interface WorkspaceSession {
    readonly state: WorkspaceState;

    subscribe(listener: (state: WorkspaceState) => void): () => void;

    refresh(): Promise<void>;

    saveResource(change: WorkspaceSave): Promise<void>;

    removeResource(target: WorkspaceResourceReference): Promise<void>;
}

function snapshotFromState(state: WorkspaceState): WorkspaceSnapshot | undefined {
    switch (state.phase) {
        case "loading":
        case "ready":
        case "changing":
        case "failed":
        case "stale":
            return state.snapshot;
        case "initial":
            return undefined;
    }
}

function freezeValue<T>(value: T): T {
    if (value === null || typeof value !== "object" || Object.isFrozen(value)) {
        return value;
    }

    for (const child of Object.values(value)) {
        freezeValue(child);
    }
    return Object.freeze(value);
}

function immutableSnapshot(snapshot: WorkspaceSnapshot): WorkspaceSnapshot {
    return freezeValue(structuredClone(snapshot));
}

function immutableFailure(failure: WorkspaceFailure): WorkspaceFailure {
    return freezeValue(structuredClone(failure));
}

function unexpectedFailure(operation: string, error: unknown): WorkspaceFailure {
    const detail = error instanceof Error && error.message.trim().length > 0
        ? ` ${error.message}`
        : "";
    return Object.freeze({
        code: "externalContract",
        message: `The workspace adapter failed unexpectedly while ${operation}.${detail}`,
        retryable: false,
    });
}

export class ObservableWorkspaceSession implements WorkspaceSession {
    readonly #adapter: WorkspaceAdapter;
    readonly #listeners = new Set<(state: WorkspaceState) => void>();
    #state: WorkspaceState;
    #activeOperation = false;
    #outcomeSequence = 0;

    constructor(adapter: WorkspaceAdapter) {
        this.#adapter = adapter;
        this.#state = Object.freeze({
            phase: "initial",
            revision: 0,
            environment: adapter.environment,
        });
    }

    get state(): WorkspaceState {
        return this.#state;
    }

    subscribe(listener: (state: WorkspaceState) => void): () => void {
        this.#listeners.add(listener);
        return () => {
            this.#listeners.delete(listener);
        };
    }

    async refresh(): Promise<void> {
        this.#assertNoActiveOperation("refresh the workspace");
        const previousState = this.#state;
        const snapshot = snapshotFromState(previousState);
        this.#activeOperation = true;
        try {
            this.#publish(Object.freeze({
                phase: "loading",
                revision: this.#state.revision + 1,
                environment: this.#adapter.environment,
                ...(snapshot === undefined ? {} : { snapshot }),
            }));
            const refreshed = immutableSnapshot(await this.#adapter.readWorkspace());
            this.#publish(Object.freeze({
                phase: "ready",
                revision: this.#state.revision + 1,
                environment: this.#adapter.environment,
                snapshot: refreshed,
            }));
        } catch (error) {
            const failure = error instanceof WorkspaceAdapterError
                ? immutableFailure(error.failure)
                : unexpectedFailure("refreshing", error);
            if (previousState.phase === "stale") {
                this.#publish(Object.freeze({
                    phase: "stale",
                    revision: this.#state.revision + 1,
                    environment: this.#adapter.environment,
                    snapshot: previousState.snapshot,
                    failure,
                    outcome: previousState.outcome,
                }));
            } else {
                this.#publish(Object.freeze({
                    phase: "failed",
                    revision: this.#state.revision + 1,
                    environment: this.#adapter.environment,
                    ...(snapshot === undefined ? {} : { snapshot }),
                    failure,
                }));
            }
            if (!(error instanceof WorkspaceAdapterError)) {
                throw error;
            }
        } finally {
            this.#activeOperation = false;
        }
    }

    async saveResource(change: WorkspaceSave): Promise<void> {
        const immutableChange = freezeValue(structuredClone(change));
        await this.#commit(immutableChange, { kind: "save", change: immutableChange });
    }

    async removeResource(target: WorkspaceResourceReference): Promise<void> {
        const immutableTarget = freezeValue(structuredClone(target));
        const change: WorkspaceCommit = immutableTarget.kind === "customView"
            ? { kind: "customView", action: "delete", id: immutableTarget.id }
            : { kind: immutableTarget.kind, action: "archive", id: immutableTarget.id };
        await this.#commit(change, { kind: "remove", target: immutableTarget });
    }

    async #commit(
        change: WorkspaceCommit,
        operation:
            | { readonly kind: "save"; readonly change: WorkspaceSave }
            | { readonly kind: "remove"; readonly target: WorkspaceResourceReference },
    ): Promise<void> {
        this.#assertNoActiveOperation("change the workspace");
        if (this.#state.phase === "stale") {
            throw new Error("The workspace is stale after a confirmed change. Refresh it before making another change.");
        }

        const snapshot = snapshotFromState(this.#state);
        if (snapshot === undefined) {
            throw new Error("The workspace must load successfully before it can be changed.");
        }

        this.#activeOperation = true;
        try {
            this.#publish(Object.freeze({
                phase: "changing",
                revision: this.#state.revision + 1,
                environment: this.#adapter.environment,
                snapshot,
                operation: freezeValue(structuredClone(operation)),
            }));

            let receipt: WorkspaceCommitReceipt;
            try {
                receipt = freezeValue(structuredClone(await this.#adapter.commit(change)));
            } catch (error) {
                const failure = error instanceof WorkspaceAdapterError
                    ? immutableFailure(error.failure)
                    : unexpectedFailure("committing a change", error);
                this.#publish(Object.freeze({
                    phase: "failed",
                    revision: this.#state.revision + 1,
                    environment: this.#adapter.environment,
                    snapshot,
                    failure,
                }));
                if (error instanceof WorkspaceAdapterError) {
                    return;
                }
                throw error;
            }

            const outcome = Object.freeze({
                id: ++this.#outcomeSequence,
                status: "committed" as const,
                receipt,
            });
            try {
                const refreshed = immutableSnapshot(await this.#adapter.readWorkspace());
                this.#publish(Object.freeze({
                    phase: "ready",
                    revision: this.#state.revision + 1,
                    environment: this.#adapter.environment,
                    snapshot: refreshed,
                    outcome,
                }));
            } catch (error) {
                const failure = error instanceof WorkspaceAdapterError
                    ? immutableFailure(error.failure)
                    : unexpectedFailure("reloading a confirmed change", error);
                this.#publish(Object.freeze({
                    phase: "stale",
                    revision: this.#state.revision + 1,
                    environment: this.#adapter.environment,
                    snapshot,
                    failure,
                    outcome,
                }));
                if (!(error instanceof WorkspaceAdapterError)) {
                    throw error;
                }
            }
        } finally {
            this.#activeOperation = false;
        }
    }

    #assertNoActiveOperation(operation: string): void {
        if (this.#activeOperation) {
            throw new Error(`Cannot ${operation} while another workspace operation is active.`);
        }
    }

    #publish(state: WorkspaceState): void {
        this.#state = state;
        for (const listener of [...this.#listeners]) {
            listener(state);
        }
    }
}