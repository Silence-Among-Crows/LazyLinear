import assert from "node:assert/strict";
import test from "node:test";
import { createDemoWorkspace } from "../lib/demo-data.js";
import type { WorkspaceData } from "../lib/types.js";
import { applyDemoMutation } from "../src/demo-store.js";

function createWorkspaceWithDemoTeam(): { workspace: WorkspaceData; teamId: string } {
    const workspace = applyDemoMutation(createDemoWorkspace(), {
        kind: "team",
        action: "create",
        input: {
            name: "Infrastructure",
            key: "INFRA",
            description: "Infrastructure work",
            color: "#123456",
        },
    });
    const team = workspace.teams.find((candidate) => candidate.key === "INFRA");
    assert.ok(team);
    return { workspace, teamId: team.id };
}

test("issue mutations create complete demo records, update nullable fields, and archive cleanly", () => {
    const original = createDemoWorkspace();
    const originalSnapshot = structuredClone(original);
    let workspace = applyDemoMutation(original, {
        kind: "issue",
        action: "create",
        input: {
            title: "Protect the mutation boundary",
            teamId: "team-core",
            description: "Exercise linked demo fields.",
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
    assert.notStrictEqual(workspace, original);
    const created = workspace.issues[0]!;
    assert.match(created.id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u);
    assert.equal(created.identifier, "CORE-144");
    assert.equal(created.state.id, "team-core-todo");
    assert.equal(created.project?.id, "project-api");
    assert.equal(created.assignee?.id, "user-xavier");
    assert.deepEqual(created.labels.map((label) => label.id), ["label-bug", "label-security"]);
    assert.equal(created.parent?.id, "issue-1");
    assert.ok(workspace.customViews.find((view) => view.id === "view-urgent")?.issueIds.includes(created.id));
    assert.ok(workspace.customViews.find((view) => view.id === "view-mine")?.issueIds.includes(created.id));

    workspace = applyDemoMutation(workspace, {
        kind: "issue",
        action: "update",
        id: created.id,
        input: {
            title: "Mutation boundary protected",
            stateId: "team-core-review",
            priority: 4,
            projectId: null,
            assigneeId: null,
            labelIds: [],
            dueDate: null,
            estimate: null,
        },
    });
    const updated = workspace.issues.find((issue) => issue.id === created.id);
    assert.ok(updated);
    assert.equal(updated.title, "Mutation boundary protected");
    assert.equal(updated.state.id, "team-core-review");
    assert.equal(updated.priorityLabel, "Low");
    assert.equal(updated.project, null);
    assert.equal(updated.assignee, null);
    assert.deepEqual(updated.labels, []);
    assert.equal(updated.dueDate, null);
    assert.equal(updated.estimate, null);
    assert.ok(!workspace.customViews.find((view) => view.id === "view-urgent")?.issueIds.includes(created.id));
    assert.ok(workspace.customViews.find((view) => view.id === "view-review")?.issueIds.includes(created.id));

    workspace = applyDemoMutation(workspace, { kind: "issue", action: "archive", id: created.id });
    assert.ok(!workspace.issues.some((issue) => issue.id === created.id));
    assert.ok(workspace.customViews.every((view) => !view.issueIds.includes(created.id)));
});

test("issue creation rejects teams that cannot supply a valid workflow state", () => {
    const workspace = createDemoWorkspace();
    assert.throws(
        () => applyDemoMutation(workspace, {
            kind: "issue",
            action: "create",
            input: { title: "Impossible issue", teamId: "missing-team" },
        }),
        /valid team is required/u,
    );
});

test("project mutations keep linked issue references current and detach them on archive", () => {
    let workspace = applyDemoMutation(createDemoWorkspace(), {
        kind: "project",
        action: "create",
        input: {
            name: "Mutation transport",
            teamIds: ["team-core", "team-app"],
            description: "Test the whole mutation path.",
            content: "Detailed mutation transport notes.",
            color: "#112233",
            statusId: "project-status-planned",
            leadId: "user-maya",
        },
    });
    const project = workspace.projects.find((candidate) => candidate.name === "Mutation transport");
    assert.ok(project);
    assert.deepEqual(project.teams.map((team) => team.id), ["team-core", "team-app"]);
    assert.equal(project.lead?.id, "user-maya");
    assert.equal(project.summary, "Test the whole mutation path.");
    assert.equal(project.description, "Detailed mutation transport notes.");
    assert.equal(project.status?.id, "project-status-planned");

    workspace = applyDemoMutation(workspace, {
        kind: "issue",
        action: "create",
        input: { title: "Linked project issue", teamId: "team-core", projectId: project.id },
    });
    const issueId = workspace.issues[0]!.id;
    workspace = applyDemoMutation(workspace, {
        kind: "project",
        action: "update",
        id: project.id,
        input: {
            name: "Verified mutation transport",
            teamIds: ["team-app"],
            color: "#445566",
            statusId: "project-status-started",
            leadId: null,
        },
    });
    const updated = workspace.projects.find((candidate) => candidate.id === project.id);
    const linkedIssue = workspace.issues.find((issue) => issue.id === issueId);
    assert.ok(updated && linkedIssue);
    assert.equal(updated.name, "Verified mutation transport");
    assert.deepEqual(updated.teams.map((team) => team.id), ["team-app"]);
    assert.equal(updated.lead, null);
    assert.equal(updated.status?.id, "project-status-started");
    assert.equal(updated.state, "started");
    assert.equal(linkedIssue.project?.id, project.id);
    assert.equal(linkedIssue.project?.name, "Verified mutation transport");
    assert.equal(linkedIssue.project?.color, "#445566");

    workspace = applyDemoMutation(workspace, { kind: "project", action: "archive", id: project.id });
    assert.ok(!workspace.projects.some((candidate) => candidate.id === project.id));
    assert.equal(workspace.issues.find((issue) => issue.id === issueId)?.project, null);
});

test("team create and update mutations keep all embedded team references consistent", () => {
    let { workspace, teamId } = createWorkspaceWithDemoTeam();
    const states = workspace.workflowStates.filter((state) => state.team?.id === teamId);
    assert.deepEqual(states.map((state) => state.type), ["backlog", "unstarted", "started", "completed", "canceled"]);

    workspace = applyDemoMutation(workspace, {
        kind: "project",
        action: "create",
        input: { name: "Infrastructure launch", teamIds: [teamId] },
    });
    const projectId = workspace.projects[0]!.id;
    workspace = applyDemoMutation(workspace, {
        kind: "issue",
        action: "create",
        input: { title: "Provision test cluster", teamId, projectId, priority: 1 },
    });
    const issueId = workspace.issues[0]!.id;
    assert.equal(workspace.issues[0]!.state.type, "unstarted");

    workspace = applyDemoMutation(workspace, {
        kind: "team",
        action: "update",
        id: teamId,
        input: { name: "Platform Infrastructure", key: "PLAT" },
    });
    assert.equal(workspace.teams.find((team) => team.id === teamId)?.name, "Platform Infrastructure");
    const issueTeam = workspace.issues.find((issue) => issue.id === issueId)?.team;
    assert.equal(issueTeam?.id, teamId);
    assert.equal(issueTeam?.name, "Platform Infrastructure");
    assert.equal(issueTeam?.key, "PLAT");
    assert.ok(workspace.workflowStates.filter((state) => state.team?.id === teamId).every((state) => state.team?.name === "Platform Infrastructure" && state.team.key === "PLAT"));
    assert.deepEqual(workspace.projects.find((project) => project.id === projectId)?.teams.map((team) => team.key), ["PLAT"]);
});

test("team archive removes its issues, workflow states, and project associations", () => {
    let { workspace, teamId } = createWorkspaceWithDemoTeam();
    workspace = applyDemoMutation(workspace, {
        kind: "project",
        action: "create",
        input: { name: "Infrastructure launch", teamIds: [teamId, "team-core"] },
    });
    const projectId = workspace.projects[0]!.id;
    workspace = applyDemoMutation(workspace, {
        kind: "issue",
        action: "create",
        input: { title: "Provision test cluster", teamId, projectId, priority: 1 },
    });
    const issueId = workspace.issues[0]!.id;

    workspace = applyDemoMutation(workspace, { kind: "team", action: "archive", id: teamId });
    assert.ok(!workspace.teams.some((team) => team.id === teamId));
    assert.ok(!workspace.issues.some((issue) => issue.id === issueId));
    assert.ok(!workspace.workflowStates.some((state) => state.team?.id === teamId));
    assert.deepEqual(workspace.projects.find((project) => project.id === projectId)?.teams.map((team) => team.id), ["team-core"]);
    assert.ok(workspace.customViews.every((view) => !view.issueIds.includes(issueId)));
});

test("custom view mutations recompute memberships after create and update", () => {
    let workspace = applyDemoMutation(createDemoWorkspace(), {
        kind: "customView",
        action: "create",
        input: {
            name: "Core urgency",
            description: "Urgent core work",
            shared: true,
            filterData: {
                and: [
                    { priority: { eq: 1 } },
                    { team: { id: { eq: "team-core" } } },
                ],
            },
        },
    });
    const view = workspace.customViews.find((candidate) => candidate.name === "Core urgency");
    assert.ok(view);
    assert.deepEqual(
        view.issueIds,
        workspace.issues.filter((issue) => issue.priority === 1 && issue.team.id === "team-core").map((issue) => issue.id),
    );

    workspace = applyDemoMutation(workspace, {
        kind: "customView",
        action: "update",
        id: view.id,
        input: {
            name: "Core review",
            filterData: { state: { name: { eq: "In Review" } } },
        },
    });
    const updated = workspace.customViews.find((candidate) => candidate.id === view.id);
    assert.equal(updated?.name, "Core review");
    assert.deepEqual(
        updated?.issueIds,
        workspace.issues.filter((issue) => issue.state.name === "In Review").map((issue) => issue.id),
    );

    workspace = applyDemoMutation(workspace, { kind: "customView", action: "archive", id: view.id });
    assert.ok(!workspace.customViews.some((candidate) => candidate.id === view.id));
});