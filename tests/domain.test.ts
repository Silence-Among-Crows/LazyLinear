import assert from "node:assert/strict";
import test from "node:test";
import { createDemoWorkspace } from "../lib/demo-data.js";
import type { WorkspaceSnapshot } from "../lib/types.js";
import {
    buildAdvanceIssueChange,
    buildMoveAcrossGroupChange,
    createWorkspaceProjection,
    filterResources,
    groupResources,
    isIssue,
    isProject,
} from "../src/domain.js";

test("navigation exposes only valid discriminated workspace targets", () => {
    const workspace = createDemoWorkspace();
    const navigation = createWorkspaceProjection(workspace).navigation;

    assert.deepEqual(navigation.slice(0, 4).map((entry) => entry.target.kind), [
        "myIssues",
        "allIssues",
        "projects",
        "teams",
    ]);
    assert.ok(navigation.some((entry) => entry.target.kind === "teamIssues" && entry.target.teamId === workspace.teams[0]?.id));
    assert.ok(navigation.some((entry) => entry.target.kind === "projectIssues" && entry.target.projectId === workspace.projects[0]?.id));
    assert.ok(navigation.some((entry) => entry.target.kind === "customView" && entry.target.customViewId === workspace.customViews[0]?.id));
    assert.ok(navigation.every((entry) => ["issue", "project", "team"].includes(entry.contentKind)));
});

test("content projection resolves ID relationships without changing source order", () => {
    const workspace = createDemoWorkspace();
    const projection = createWorkspaceProjection(workspace);
    const navigation = projection.navigation;
    const allIssuesEntry = navigation.find((entry) => entry.target.kind === "allIssues")!;
    const issues = projection.contentFor(allIssuesEntry).filter(isIssue);

    assert.deepEqual(issues.map((issue) => issue.id), workspace.issues.map((issue) => issue.id));
    assert.equal(issues[0]?.team.id, issues[0]?.teamId);
    assert.equal(issues[0]?.state.id, issues[0]?.stateId);
    assert.deepEqual(issues[0]?.labels.map((label) => label.id), issues[0]?.labelIds);

    const projectsEntry = navigation.find((entry) => entry.target.kind === "projects")!;
    const projects = projection.contentFor(projectsEntry).filter(isProject);
    assert.deepEqual(projects[0]?.teams.map((team) => team.id), projects[0]?.teamIds);
    assert.equal(projects[0]?.status?.id, projects[0]?.statusId);
});

test("search applies case-insensitive AND terms across projected metadata", () => {
    const workspace = createDemoWorkspace();
    const projection = createWorkspaceProjection(workspace);
    const allIssuesEntry = projection.navigation.find((entry) => entry.target.kind === "allIssues")!;
    const issues = projection.contentFor(allIssuesEntry);
    const selected = issues.find(isIssue)!;

    assert.deepEqual(filterResources(issues, `${selected.identifier} ${selected.team.name}`).map((issue) => issue.id), [selected.id]);
    assert.deepEqual(filterResources(issues, "term-that-does-not-exist"), []);

    const projectsEntry = projection.navigation.find((entry) => entry.target.kind === "projects")!;
    const projects = projection.contentFor(projectsEntry);
    const project = projects.find(isProject)!;
    assert.ok(filterResources(projects, project.description ?? project.name).some((candidate) => candidate.id === project.id));
});

test("grouping uses resolved issue dimensions and project status", () => {
    const workspace = createDemoWorkspace();
    const projection = createWorkspaceProjection(workspace);
    const navigation = projection.navigation;
    const issues = projection.contentFor(navigation.find((entry) => entry.target.kind === "allIssues")!);

    for (const groupBy of ["status", "priority", "project", "assignee", "team"] as const) {
        const groups = groupResources(issues, groupBy);
        assert.equal(groups.flatMap((group) => group.items).length, issues.length);
    }

    const projects = projection.contentFor(navigation.find((entry) => entry.target.kind === "projects")!);
    const projectGroups = groupResources(projects, "status");
    assert.equal(projectGroups.flatMap((group) => group.items).length, projects.length);

    const teams = projection.contentFor(navigation.find((entry) => entry.target.kind === "teams")!);
    assert.deepEqual(groupResources(teams, "status").map((group) => group.id), ["teams"]);
});

test("domain command builders encode advance and board moves without UI policy", () => {
    const workspace = createDemoWorkspace();
    const projection = createWorkspaceProjection(workspace);
    const allIssues = projection.contentFor(
        projection.navigation.find((entry) => entry.target.kind === "allIssues")!,
    );
    const issue = allIssues.filter(isIssue).find((resource) => resource.state.type !== "canceled")!;
    const advance = buildAdvanceIssueChange(workspace, issue);
    assert.equal(advance.ok, true);
    if (advance.ok) {
        assert.equal(advance.change.kind, "issue");
        assert.equal(advance.change.action, "update");
    }

    const priorityGroups = groupResources(allIssues, "priority");
    const targetGroup = priorityGroups.find((group) => !group.items.some((item) => item.id === issue.id));
    assert.ok(targetGroup);
    const move = buildMoveAcrossGroupChange(workspace, issue, "priority", targetGroup!);
    assert.equal(move.ok, true);
});

test("status boards merge cross-team states by semantic identity and move into the selected issue's matching state", () => {
    const workspace = createDemoWorkspace();
    const projection = createWorkspaceProjection(workspace);
    const allIssues = projection.contentFor(
        projection.navigation.find((entry) => entry.target.kind === "allIssues")!,
    );
    const statusGroups = groupResources(allIssues, "status");

    assert.deepEqual(statusGroups.map((group) => group.id), [
        "backlog:backlog",
        "unstarted:todo",
        "started:in progress",
        "started:in review",
        "completed:done",
        "canceled:canceled",
    ]);
    const reviewGroup = statusGroups.find((group) => group.id === "started:in review")!;
    assert.deepEqual(
        [...new Set(reviewGroup.items.filter(isIssue).map((issue) => issue.teamId))].sort(),
        ["team-app", "team-core", "team-growth"],
    );

    const coreTodo = allIssues.filter(isIssue).find((issue) => issue.identifier === "CORE-134")!;
    const move = buildMoveAcrossGroupChange(workspace, coreTodo, "status", reviewGroup);
    assert.deepEqual(move, {
        ok: true,
        change: {
            kind: "issue",
            action: "update",
            id: coreTodo.id,
            input: { stateId: "team-core-review" },
        },
    });
});

test("status board moves fail instead of substituting a differently named state of the same type", () => {
    const workspace = createDemoWorkspace();
    const renamedWorkspace: WorkspaceSnapshot = {
        ...workspace,
        workflowStates: workspace.workflowStates.map((state) => state.id === "team-core-review"
            ? { ...state, name: "Peer Review" }
            : state),
    };
    const projection = createWorkspaceProjection(renamedWorkspace);
    const allIssues = projection.contentFor(
        projection.navigation.find((entry) => entry.target.kind === "allIssues")!,
    );
    const coreTodo = allIssues.filter(isIssue).find((issue) => issue.identifier === "CORE-134")!;
    const inReview = groupResources(allIssues, "status").find((group) => group.id === "started:in review")!;

    assert.deepEqual(buildMoveAcrossGroupChange(renamedWorkspace, coreTodo, "status", inReview), {
        ok: false,
        message: "the CORE workflow has no state matching In Review",
    });
});

test("team board moves preserve the exact semantic workflow state before using broader fallbacks", () => {
    const workspace = createDemoWorkspace();
    const projection = createWorkspaceProjection(workspace);
    const allIssues = projection.contentFor(
        projection.navigation.find((entry) => entry.target.kind === "allIssues")!,
    );
    const coreReview = allIssues.filter(isIssue).find((issue) => issue.identifier === "CORE-131")!;
    const appTeam = groupResources(allIssues, "team").find((group) => group.id === "team-app")!;

    assert.deepEqual(buildMoveAcrossGroupChange(workspace, coreReview, "team", appTeam), {
        ok: true,
        change: {
            kind: "issue",
            action: "update",
            id: coreReview.id,
            input: { teamId: "team-app", stateId: "team-app-review" },
        },
    });
});

function arrayThatRejectsLinearFind<T>(values: readonly T[]): readonly T[] {
    return new Proxy([...values], {
        get(target, property, receiver) {
            if (property === "find") {
                throw new Error("workspace projection must use its relationship index instead of linear scans");
            }
            return Reflect.get(target, property, receiver);
        },
    });
}

test("one projection indexes relationships once, defers issue hydration for project and team views, and reuses hydrated resources", () => {
    const workspace = createDemoWorkspace();
    let issueLabelReads = 0;
    const firstIssue = workspace.issues[0]!;
    const instrumentedIssue = new Proxy(firstIssue, {
        get(target, property, receiver) {
            if (property === "labelIds") {
                issueLabelReads += 1;
            }
            return Reflect.get(target, property, receiver);
        },
    });
    const indexedWorkspace: WorkspaceSnapshot = {
        ...workspace,
        issues: [instrumentedIssue, ...workspace.issues.slice(1)],
        teams: arrayThatRejectsLinearFind(workspace.teams),
        projects: arrayThatRejectsLinearFind(workspace.projects),
        workflowStates: arrayThatRejectsLinearFind(workspace.workflowStates),
        users: arrayThatRejectsLinearFind(workspace.users),
        labels: arrayThatRejectsLinearFind(workspace.labels),
        projectStatuses: arrayThatRejectsLinearFind(workspace.projectStatuses),
        customViews: arrayThatRejectsLinearFind(workspace.customViews),
    };
    const projection = createWorkspaceProjection(indexedWorkspace);
    const projectsEntry = projection.navigation.find((entry) => entry.target.kind === "projects")!;
    const teamsEntry = projection.navigation.find((entry) => entry.target.kind === "teams")!;
    const firstProjects = projection.contentFor(projectsEntry);

    projection.contentFor(teamsEntry);
    projection.resourceFor(
        projection.navigation.find((entry) => entry.target.kind === "projectIssues")!,
    );
    assert.equal(issueLabelReads, 0, "non-issue views must not hydrate issue relationships");
    assert.strictEqual(projection.contentFor(projectsEntry)[0], firstProjects[0]);

    const allIssuesEntry = projection.navigation.find((entry) => entry.target.kind === "allIssues")!;
    const firstIssues = projection.contentFor(allIssuesEntry);
    const readsAfterFirstIssueProjection = issueLabelReads;
    assert.ok(readsAfterFirstIssueProjection > 0);
    assert.strictEqual(projection.contentFor(allIssuesEntry)[0], firstIssues[0]);
    assert.equal(issueLabelReads, readsAfterFirstIssueProjection, "hydrated issues must be reused within a snapshot projection");
});