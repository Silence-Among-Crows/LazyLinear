import assert from "node:assert/strict";
import test from "node:test";
import type { WorkspaceCommit, WorkspaceFailureCode, WorkspaceSnapshot } from "../lib/types.js";
import { DemoWorkspaceAdapter } from "../src/demo-workspace-adapter.js";
import { createWorkspaceProjection, filterResources } from "../src/domain.js";
import { WorkspaceAdapterError } from "../src/workspace-adapter.js";

function assertWorkspaceContentUnchanged(actual: WorkspaceSnapshot, expected: WorkspaceSnapshot): void {
    assert.deepEqual({ ...actual, fetchedAt: expected.fetchedAt }, expected);
}

async function expectCommitFailure(
    adapter: DemoWorkspaceAdapter,
    change: WorkspaceCommit,
    code: WorkspaceFailureCode,
): Promise<WorkspaceAdapterError> {
    try {
        await adapter.commit(change);
    } catch (error) {
        assert.ok(error instanceof WorkspaceAdapterError);
        assert.equal(error.failure.code, code);
        assert.equal(error.failure.retryable, false);
        return error;
    }

    assert.fail(`Expected demo commit to fail with ${code}.`);
}

async function createDemoTeam(adapter: DemoWorkspaceAdapter): Promise<string> {
    const receipt = await adapter.commit({
        kind: "team",
        action: "create",
        input: {
            name: "Infrastructure",
            key: "INFRA",
            description: "Infrastructure work",
            color: "#123456",
        },
    });
    assert.equal(receipt.action, "created");
    return receipt.resource.id;
}

test("DemoWorkspaceAdapter owns immutable snapshots and durable identifiers across issue create, update, and archive flows", async () => {
    const adapter = new DemoWorkspaceAdapter();
    const original = await adapter.readWorkspace();
    const originalSnapshot = structuredClone(original);
    await new Promise<void>((resolve) => setTimeout(resolve, 2));
    const refreshed = await adapter.readWorkspace();
    assert.notEqual(refreshed.fetchedAt, original.fetchedAt);
    assertWorkspaceContentUnchanged(refreshed, original);
    const createReceipt = await adapter.commit({
        kind: "issue",
        action: "create",
        input: {
            title: "Protect the adapter seam",
            teamId: "team-core",
            description: "Exercise every linked demo field.",
            stateId: "team-core-todo",
            priority: 1,
            projectId: "project-api",
            assigneeId: "user-xavier",
            labelIds: ["label-security", "label-bug"],
            dueDate: "2026-08-20",
            estimate: 5,
            parentId: "issue-1",
        },
    });

    assert.deepEqual(original, originalSnapshot);
    assert.equal(createReceipt.action, "created");
    assert.equal(createReceipt.resource.kind, "issue");
    const createdId = createReceipt.resource.id;
    assert.match(createdId, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u);

    let workspace = await adapter.readWorkspace();
    const created = workspace.issues.find((issue) => issue.id === createdId);
    assert.ok(created);
    assert.equal(created.kind, "issue");
    assert.equal(created.identifier, "CORE-144");
    assert.equal(created.stateId, "team-core-todo");
    assert.equal(created.projectId, "project-api");
    assert.equal(created.assigneeId, "user-xavier");
    assert.deepEqual(created.labelIds, ["label-bug", "label-security"]);
    assert.equal(created.parentId, "issue-1");
    assert.ok(workspace.customViews.find((view) => view.id === "view-urgent")?.issueIds.includes(created.id));
    assert.ok(workspace.customViews.find((view) => view.id === "view-mine")?.issueIds.includes(created.id));

    const updateReceipt = await adapter.commit({
        kind: "issue",
        action: "update",
        id: created.id,
        input: {
            title: "Adapter seam protected",
            stateId: "team-core-review",
            priority: 4,
            projectId: null,
            assigneeId: null,
            labelIds: [],
            dueDate: null,
            estimate: null,
            parentId: null,
        },
    });
    assert.deepEqual(updateReceipt, { action: "updated", resource: { kind: "issue", id: created.id } });

    workspace = await adapter.readWorkspace();
    const updated = workspace.issues.find((issue) => issue.id === created.id);
    assert.ok(updated);
    assert.equal(updated.title, "Adapter seam protected");
    assert.equal(updated.stateId, "team-core-review");
    assert.equal(updated.priority, 4);
    assert.equal(updated.projectId, null);
    assert.equal(updated.assigneeId, null);
    assert.deepEqual(updated.labelIds, []);
    assert.equal(updated.dueDate, null);
    assert.equal(updated.estimate, null);
    assert.ok(!workspace.customViews.find((view) => view.id === "view-urgent")?.issueIds.includes(created.id));
    assert.ok(workspace.customViews.find((view) => view.id === "view-review")?.issueIds.includes(created.id));

    const archiveReceipt = await adapter.commit({ kind: "issue", action: "archive", id: created.id });
    assert.deepEqual(archiveReceipt, { action: "archived", resource: { kind: "issue", id: created.id } });
    workspace = await adapter.readWorkspace();
    assert.ok(!workspace.issues.some((issue) => issue.id === created.id));
    assert.ok(workspace.customViews.every((view) => !view.issueIds.includes(created.id)));

    const secondCreateReceipt = await adapter.commit({
        kind: "issue",
        action: "create",
        input: { title: "Do not reuse an archived identifier", teamId: "team-core" },
    });
    workspace = await adapter.readWorkspace();
    assert.equal(workspace.issues.find((issue) => issue.id === secondCreateReceipt.resource.id)?.identifier, "CORE-145");

    const mutableRead = await adapter.readWorkspace();
    assert.equal(Reflect.set(mutableRead.teams, "length", 0), true);
    assert.equal((await adapter.readWorkspace()).teams.length, original.teams.length);
});

test("DemoWorkspaceAdapter rejects missing and incompatible issue relationships without changing state", async () => {
    const invalidChanges: readonly WorkspaceCommit[] = [
        {
            kind: "issue",
            action: "create",
            input: { title: "Missing team", teamId: "missing-team" },
        },
        {
            kind: "issue",
            action: "create",
            input: { title: "Wrong state", teamId: "team-core", stateId: "team-app-todo" },
        },
        {
            kind: "issue",
            action: "create",
            input: { title: "Missing assignee", teamId: "team-core", assigneeId: "missing-user" },
        },
        {
            kind: "issue",
            action: "create",
            input: { title: "Missing labels", teamId: "team-core", labelIds: ["missing-label"] },
        },
        {
            kind: "issue",
            action: "create",
            input: { title: "Missing parent", teamId: "team-core", parentId: "missing-issue" },
        },
    ];

    for (const change of invalidChanges) {
        const adapter = new DemoWorkspaceAdapter();
        const before = await adapter.readWorkspace();
        await expectCommitFailure(adapter, change, "validation");
        assertWorkspaceContentUnchanged(await adapter.readWorkspace(), before);
    }

    const adapter = new DemoWorkspaceAdapter();
    const before = await adapter.readWorkspace();
    await expectCommitFailure(adapter, {
        kind: "issue",
        action: "update",
        id: "missing-issue",
        input: { title: "Cannot update" },
    }, "notFound");
    assertWorkspaceContentUnchanged(await adapter.readWorkspace(), before);
});

test("project changes map only explicit fields, preserve searchable description, and detach issues on archive", async () => {
    const adapter = new DemoWorkspaceAdapter();
    const createReceipt = await adapter.commit({
        kind: "project",
        action: "create",
        input: {
            name: "Mutation transport",
            teamIds: ["team-app", "team-core"],
            summary: "Test the whole mutation path.",
            description: "Detailed searchable mutation transport notes.",
            color: "#112233",
            statusId: "project-status-planned",
            leadId: "user-maya",
        },
    });
    const projectId = createReceipt.resource.id;
    let workspace = await adapter.readWorkspace();
    const created = workspace.projects.find((project) => project.id === projectId);
    assert.ok(created);
    assert.deepEqual(created.teamIds, ["team-app", "team-core"]);
    assert.equal(created.leadId, "user-maya");
    assert.equal(created.summary, "Test the whole mutation path.");
    assert.equal(created.description, "Detailed searchable mutation transport notes.");
    assert.equal(created.statusId, "project-status-planned");

    const issueReceipt = await adapter.commit({
        kind: "issue",
        action: "create",
        input: { title: "Linked project issue", teamId: "team-core", projectId },
    });
    await adapter.commit({
        kind: "project",
        action: "update",
        id: projectId,
        input: {
            name: "Verified mutation transport",
            teamIds: ["team-app"],
            color: "#445566",
            statusId: "project-status-started",
            leadId: null,
        },
    });

    workspace = await adapter.readWorkspace();
    const updated = workspace.projects.find((project) => project.id === projectId);
    assert.ok(updated);
    assert.equal(updated.name, "Verified mutation transport");
    assert.deepEqual(updated.teamIds, ["team-app"]);
    assert.equal(updated.leadId, null);
    assert.equal(updated.statusId, "project-status-started");
    assert.equal(updated.description, "Detailed searchable mutation transport notes.");
    assert.equal((updated as unknown as Record<string, unknown>).content, undefined);
    assert.equal(workspace.issues.find((issue) => issue.id === issueReceipt.resource.id)?.projectId, projectId);
    const projection = createWorkspaceProjection(workspace);
    const projectsNavigation = projection.navigation.find((entry) => entry.target.kind === "projects");
    assert.ok(projectsNavigation);
    const projectsContent = projection.contentFor(projectsNavigation);
    assert.deepEqual(filterResources(projectsContent, "searchable mutation").map((resource) => resource.id), [projectId]);

    await adapter.commit({ kind: "project", action: "archive", id: projectId });
    workspace = await adapter.readWorkspace();
    assert.ok(!workspace.projects.some((project) => project.id === projectId));
    assert.equal(workspace.issues.find((issue) => issue.id === issueReceipt.resource.id)?.projectId, null);
});

test("team changes preserve normalized references and archive the complete team-owned graph", async () => {
    const adapter = new DemoWorkspaceAdapter();
    const teamId = await createDemoTeam(adapter);
    let workspace = await adapter.readWorkspace();
    assert.deepEqual(
        workspace.workflowStates.filter((state) => state.teamId === teamId).map((state) => state.type),
        ["backlog", "unstarted", "started", "completed", "canceled"],
    );

    const projectReceipt = await adapter.commit({
        kind: "project",
        action: "create",
        input: { name: "Infrastructure launch", teamIds: [teamId, "team-core"] },
    });
    const soleTeamProjectReceipt = await adapter.commit({
        kind: "project",
        action: "create",
        input: { name: "Team-owned project", teamIds: [teamId] },
    });
    const issueReceipt = await adapter.commit({
        kind: "issue",
        action: "create",
        input: { title: "Provision test cluster", teamId, projectId: projectReceipt.resource.id, priority: 1 },
    });

    await adapter.commit({
        kind: "team",
        action: "update",
        id: teamId,
        input: { name: "Platform Infrastructure", key: "PLAT", visibility: "private" },
    });
    workspace = await adapter.readWorkspace();
    const updatedTeam = workspace.teams.find((team) => team.id === teamId);
    assert.ok(updatedTeam);
    assert.equal(updatedTeam.name, "Platform Infrastructure");
    assert.equal(updatedTeam.key, "PLAT");
    assert.equal(updatedTeam.visibility, "private");
    assert.equal(workspace.issues.find((issue) => issue.id === issueReceipt.resource.id)?.teamId, teamId);
    assert.ok(workspace.workflowStates.filter((state) => state.teamId === teamId).every((state) => state.teamId === teamId));
    assert.deepEqual(workspace.projects.find((project) => project.id === projectReceipt.resource.id)?.teamIds, [teamId, "team-core"]);

    await adapter.commit({ kind: "team", action: "archive", id: teamId });
    workspace = await adapter.readWorkspace();
    assert.ok(!workspace.teams.some((team) => team.id === teamId));
    assert.ok(!workspace.issues.some((issue) => issue.id === issueReceipt.resource.id));
    assert.ok(!workspace.workflowStates.some((state) => state.teamId === teamId));
    assert.deepEqual(workspace.projects.find((project) => project.id === projectReceipt.resource.id)?.teamIds, ["team-core"]);
    assert.deepEqual(workspace.projects.find((project) => project.id === soleTeamProjectReceipt.resource.id)?.teamIds, []);
    assert.ok(workspace.customViews.every((view) => !view.issueIds.includes(issueReceipt.resource.id)));
});

test("custom views support the documented recursive grammar and recompute membership after changes", async () => {
    const adapter = new DemoWorkspaceAdapter();
    const createReceipt = await adapter.commit({
        kind: "customView",
        action: "create",
        input: {
            name: "Core active priority",
            description: "Core issues that are urgent or high and still active.",
            shared: true,
            filterData: {
                and: [
                    { priority: { in: [1, 2] } },
                    { team: { id: { eq: "team-core" } } },
                    { state: { type: { nin: ["completed", "canceled"] } } },
                    {
                        or: [
                            { labels: { some: { id: { eq: "label-security" } } } },
                            { labels: { some: { name: { eq: "Performance" } } } },
                        ],
                    },
                ],
            },
        },
    });
    let workspace = await adapter.readWorkspace();
    const view = workspace.customViews.find((candidate) => candidate.id === createReceipt.resource.id);
    assert.ok(view);
    const expected = workspace.issues.filter((issue) => {
        const state = workspace.workflowStates.find((candidate) => candidate.id === issue.stateId);
        const issueLabels = workspace.labels.filter((label) => issue.labelIds.includes(label.id));
        return [1, 2].includes(issue.priority)
            && issue.teamId === "team-core"
            && state !== undefined
            && !["completed", "canceled"].includes(state.type)
            && issueLabels.some((label) => label.id === "label-security" || label.name === "Performance");
    }).map((issue) => issue.id);
    assert.deepEqual(view.issueIds, expected);

    await adapter.commit({
        kind: "customView",
        action: "update",
        id: view.id,
        input: {
            name: "Review or unassigned",
            filterData: {
                or: [
                    { state: { name: { neq: "In Review" } } },
                    { assignee: { id: { eq: null } } },
                ],
            },
        },
    });
    workspace = await adapter.readWorkspace();
    const updated = workspace.customViews.find((candidate) => candidate.id === view.id);
    assert.equal(updated?.name, "Review or unassigned");
    assert.deepEqual(
        updated?.issueIds,
        workspace.issues.filter((issue) => {
            const state = workspace.workflowStates.find((candidate) => candidate.id === issue.stateId);
            return state?.name !== "In Review" || issue.assigneeId === null;
        }).map((issue) => issue.id),
    );

    const deleteReceipt = await adapter.commit({ kind: "customView", action: "delete", id: view.id });
    assert.deepEqual(deleteReceipt, { action: "deleted", resource: { kind: "customView", id: view.id } });
    assert.ok(!(await adapter.readWorkspace()).customViews.some((candidate) => candidate.id === view.id));
});

test("unsupported and malformed custom-view filters fail closed before adapter state changes", async () => {
    const unsupportedFilters: readonly WorkspaceCommit[] = [
        {
            kind: "customView",
            action: "create",
            input: { name: "Unknown field", filterData: { cycle: { eq: "cycle-1" } } },
        },
        {
            kind: "customView",
            action: "create",
            input: { name: "Unknown comparator", filterData: { priority: { gt: 1 } } },
        },
        {
            kind: "customView",
            action: "create",
            input: { name: "Malformed boolean", filterData: { and: { priority: { eq: 1 } } } },
        },
        {
            kind: "customView",
            action: "create",
            input: { name: "Malformed nested value", filterData: { or: [null, { priority: { eq: 1 } }] } },
        },
        {
            kind: "customView",
            action: "create",
            input: { name: "Project filter", filterData: {}, projectFilterData: { status: { eq: "planned" } } },
        },
        {
            kind: "customView",
            action: "create",
            input: { name: "Malformed labels", filterData: { labels: { every: { name: { eq: "Bug" } } } } },
        },
    ];

    for (const change of unsupportedFilters) {
        const adapter = new DemoWorkspaceAdapter();
        const before = await adapter.readWorkspace();
        await expectCommitFailure(adapter, change, "unsupported");
        assertWorkspaceContentUnchanged(await adapter.readWorkspace(), before);
    }

    const adapter = new DemoWorkspaceAdapter();
    const before = await adapter.readWorkspace();
    await expectCommitFailure(adapter, {
        kind: "customView",
        action: "update",
        id: "view-review",
        input: { filterData: { state: { name: { contains: "Review" } } } },
    }, "unsupported");
    assertWorkspaceContentUnchanged(await adapter.readWorkspace(), before);
});

test("project and team commands validate targets, identities, and referenced IDs", async () => {
    const cases: readonly { readonly change: WorkspaceCommit; readonly code: WorkspaceFailureCode }[] = [
        {
            change: { kind: "project", action: "create", input: { name: "No team", teamIds: [] } },
            code: "validation",
        },
        {
            change: { kind: "project", action: "create", input: { name: "Bad status", teamIds: ["team-core"], statusId: "missing" } },
            code: "validation",
        },
        {
            change: { kind: "team", action: "create", input: { name: "Duplicate", key: "core" } },
            code: "validation",
        },
        {
            change: { kind: "project", action: "archive", id: "missing-project" },
            code: "notFound",
        },
        {
            change: { kind: "customView", action: "delete", id: "missing-view" },
            code: "notFound",
        },
    ];

    for (const testCase of cases) {
        const adapter = new DemoWorkspaceAdapter();
        const before = await adapter.readWorkspace();
        await expectCommitFailure(adapter, testCase.change, testCase.code);
        assertWorkspaceContentUnchanged(await adapter.readWorkspace(), before);
    }
});