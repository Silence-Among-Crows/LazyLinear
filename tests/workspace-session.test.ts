import assert from "node:assert/strict";
import test from "node:test";
import type {
    WorkspaceCommit,
    WorkspaceCommitReceipt,
    WorkspaceSnapshot,
} from "../lib/types.js";
import { WorkspaceAdapterError, type WorkspaceAdapter } from "../src/workspace-adapter.js";
import { ObservableWorkspaceSession, type WorkspaceState } from "../src/workspace-session.js";

function workspaceSnapshot(fetchedAt: string): WorkspaceSnapshot {
    return {
        viewer: {
            id: "user-1",
            name: "Avery Example",
            displayName: "Avery",
            organization: {
                id: "organization-1",
                name: "Example",
                urlKey: "example",
            },
        },
        teams: [{
            kind: "team",
            id: "team-1",
            name: "Platform",
            key: "PLAT",
            visibility: "workspace",
        }],
        projects: [],
        issues: [],
        workflowStates: [],
        users: [],
        labels: [],
        projectStatuses: [],
        customViews: [],
        fetchedAt,
    };
}

function committedTeam(id = "team-2"): WorkspaceCommitReceipt {
    return {
        action: "created",
        resource: { kind: "team", id },
    };
}

test("refresh publishes one immutable state per transition with monotonic revisions", async () => {
    const adapterSnapshot = workspaceSnapshot("2026-08-02T00:00:00.000Z");
    const adapter: WorkspaceAdapter = {
        environment: "demo",
        async readWorkspace() {
            return adapterSnapshot;
        },
        async commit() {
            throw new Error("Commit is not part of this scenario.");
        },
    };
    const session = new ObservableWorkspaceSession(adapter);
    const observed: Array<{ phase: WorkspaceState["phase"]; revision: number }> = [];
    const unsubscribe = session.subscribe((state) => {
        observed.push({ phase: state.phase, revision: state.revision });
    });

    assert.deepEqual(session.state, { phase: "initial", revision: 0, environment: "demo" });
    await session.refresh();

    assert.deepEqual(observed, [
        { phase: "loading", revision: 1 },
        { phase: "ready", revision: 2 },
    ]);
    assert.equal(session.state.phase, "ready");
    if (session.state.phase !== "ready") {
        assert.fail("Expected the workspace to be ready.");
    }
    assert.notStrictEqual(session.state.snapshot, adapterSnapshot);
    assert.ok(Object.isFrozen(session.state));
    assert.ok(Object.isFrozen(session.state.snapshot));
    assert.ok(Object.isFrozen(session.state.snapshot.teams));
    assert.ok(Object.isFrozen(session.state.snapshot.teams[0]!));

    unsubscribe();
    unsubscribe();
    await session.refresh();
    assert.equal(observed.length, 2);
    assert.equal(session.state.revision, 4);
});

test("save publishes its operation, commits, reloads authoritatively, and emits one outcome", async () => {
    const calls: string[] = [];
    let readCount = 0;
    const commits: WorkspaceCommit[] = [];
    const adapter: WorkspaceAdapter = {
        environment: "linear",
        async readWorkspace() {
            calls.push("read");
            readCount += 1;
            return workspaceSnapshot(`snapshot-${readCount}`);
        },
        async commit(change) {
            calls.push("commit");
            commits.push(change);
            return committedTeam();
        },
    };
    const session = new ObservableWorkspaceSession(adapter);
    const phases: WorkspaceState["phase"][] = [];
    session.subscribe((state) => {
        phases.push(state.phase);
    });
    await session.refresh();

    await session.saveResource({
        kind: "team",
        action: "create",
        input: { name: "Infrastructure", key: "INFRA", visibility: "private" },
    });

    assert.deepEqual(calls, ["read", "commit", "read"]);
    assert.deepEqual(commits, [{
        kind: "team",
        action: "create",
        input: { name: "Infrastructure", key: "INFRA", visibility: "private" },
    }]);
    assert.deepEqual(phases, ["loading", "ready", "changing", "ready"]);
    assert.equal(session.state.phase, "ready");
    if (session.state.phase !== "ready") {
        assert.fail("Expected the workspace to be ready.");
    }
    assert.equal(session.state.snapshot.fetchedAt, "snapshot-2");
    assert.deepEqual(session.state.outcome, {
        id: 1,
        status: "committed",
        receipt: committedTeam(),
    });
    assert.ok(Object.isFrozen(session.state.outcome));
    assert.ok(Object.isFrozen(session.state.outcome?.receipt.resource));
});

test("an expected commit failure resolves, preserves the snapshot, and permits a corrected retry", async () => {
    let rejectCommit = true;
    const adapter: WorkspaceAdapter = {
        environment: "linear",
        async readWorkspace() {
            return workspaceSnapshot(rejectCommit ? "before" : "after");
        },
        async commit() {
            if (rejectCommit) {
                throw new WorkspaceAdapterError({
                    code: "validation",
                    message: "The team key is already in use.",
                    retryable: false,
                });
            }
            return committedTeam();
        },
    };
    const session = new ObservableWorkspaceSession(adapter);
    await session.refresh();
    const originalSnapshot = session.state.phase === "ready" ? session.state.snapshot : undefined;

    await session.saveResource({
        kind: "team",
        action: "create",
        input: { name: "Platform", key: "PLAT" },
    });

    assert.equal(session.state.phase, "failed");
    if (session.state.phase !== "failed") {
        assert.fail("Expected a typed adapter failure.");
    }
    assert.strictEqual(session.state.snapshot, originalSnapshot);
    assert.deepEqual(session.state.failure, {
        code: "validation",
        message: "The team key is already in use.",
        retryable: false,
    });

    rejectCommit = false;
    await session.saveResource({
        kind: "team",
        action: "create",
        input: { name: "Infrastructure", key: "INFRA" },
    });
    const retriedState = session.state as WorkspaceState;
    assert.equal(retriedState.phase, "ready");
    if (retriedState.phase === "ready") {
        assert.equal(retriedState.outcome?.id, 1);
        assert.equal(retriedState.snapshot.fetchedAt, "after");
    }
});

test("a confirmed commit with a failed reload stays stale and blocks writes until refresh succeeds", async () => {
    let readCount = 0;
    let commitCount = 0;
    const adapter: WorkspaceAdapter = {
        environment: "linear",
        async readWorkspace() {
            readCount += 1;
            if (readCount === 2 || readCount === 3) {
                throw new WorkspaceAdapterError({
                    code: "unavailable",
                    message: "Linear could not be reached.",
                    retryable: true,
                });
            }
            return workspaceSnapshot(readCount === 1 ? "before" : "recovered");
        },
        async commit() {
            commitCount += 1;
            return committedTeam();
        },
    };
    const session = new ObservableWorkspaceSession(adapter);
    await session.refresh();

    await session.saveResource({
        kind: "team",
        action: "create",
        input: { name: "Infrastructure", key: "INFRA" },
    });

    assert.equal(session.state.phase, "stale");
    if (session.state.phase !== "stale") {
        assert.fail("Expected a stale snapshot after the confirmed commit.");
    }
    assert.equal(session.state.snapshot.fetchedAt, "before");
    assert.equal(session.state.outcome.receipt.action, "created");
    await assert.rejects(
        session.removeResource({ kind: "issue", id: "issue-1" }),
        /stale after a confirmed change/u,
    );
    assert.equal(commitCount, 1);

    await session.refresh();
    assert.equal(session.state.phase, "stale");
    await assert.rejects(
        session.saveResource({ kind: "issue", action: "update", id: "issue-1", input: { title: "Retry" } }),
        /stale after a confirmed change/u,
    );

    await session.refresh();
    const recoveredState = session.state as WorkspaceState;
    assert.equal(recoveredState.phase, "ready");
    if (recoveredState.phase === "ready") {
        assert.equal(recoveredState.snapshot.fetchedAt, "recovered");
        assert.equal(recoveredState.outcome, undefined);
    }
});

test("concurrent operations reject without publishing competing transitions", async () => {
    let releaseRead: (() => void) | undefined;
    const readGate = new Promise<void>((resolve) => {
        releaseRead = resolve;
    });
    const adapter: WorkspaceAdapter = {
        environment: "demo",
        async readWorkspace() {
            await readGate;
            return workspaceSnapshot("loaded");
        },
        async commit() {
            return committedTeam();
        },
    };
    const session = new ObservableWorkspaceSession(adapter);
    const revisions: number[] = [];
    session.subscribe((state) => {
        revisions.push(state.revision);
    });

    const initialRefresh = session.refresh();
    assert.equal(session.state.phase, "loading");
    await assert.rejects(session.refresh(), /another workspace operation is active/u);
    await assert.rejects(
        session.saveResource({ kind: "team", action: "create", input: { name: "Blocked", key: "BLOCK" } }),
        /another workspace operation is active/u,
    );
    assert.deepEqual(revisions, [1]);

    assert.ok(releaseRead);
    releaseRead();
    await initialRefresh;
    assert.deepEqual(revisions, [1, 2]);
    assert.equal(session.state.phase, "ready");
});

test("remove translates archive and permanent-delete semantics before committing", async () => {
    const commits: WorkspaceCommit[] = [];
    const adapter: WorkspaceAdapter = {
        environment: "demo",
        async readWorkspace() {
            return workspaceSnapshot(`read-${commits.length}`);
        },
        async commit(change) {
            commits.push(change);
            if (change.action === "create" || change.action === "update") {
                throw new Error("This scenario expects removal commands only.");
            }
            return {
                action: change.action === "delete" ? "deleted" : "archived",
                resource: { kind: change.kind, id: change.id },
            };
        },
    };
    const session = new ObservableWorkspaceSession(adapter);
    await session.refresh();

    await session.removeResource({ kind: "project", id: "project-1" });
    await session.removeResource({ kind: "customView", id: "view-1" });

    assert.deepEqual(commits, [
        { kind: "project", action: "archive", id: "project-1" },
        { kind: "customView", action: "delete", id: "view-1" },
    ]);
    assert.equal(session.state.phase, "ready");
    if (session.state.phase === "ready") {
        assert.deepEqual(session.state.outcome, {
            id: 2,
            status: "committed",
            receipt: {
                action: "deleted",
                resource: { kind: "customView", id: "view-1" },
            },
        });
    }
});