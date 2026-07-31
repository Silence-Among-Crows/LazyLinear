import assert from "node:assert/strict";
import test from "node:test";
import { createDemoWorkspace } from "../lib/demo-data.js";
import type { Issue } from "../lib/types.js";
import {
    buildNavigation,
    contentForNavigation,
    filterResources,
    groupResources,
    resourceKindForNavigation,
    type GroupBy,
} from "../src/domain.js";

test("buildNavigation exposes workspace, saved-view, team, and project scopes", () => {
    const workspace = createDemoWorkspace();
    const navigation = buildNavigation(workspace);

    assert.deepEqual(
        navigation.slice(0, 4).map(({ id, kind, label, section, count }) => ({ id, kind, label, section, count })),
        [
            { id: "my-issues", kind: "myIssues", label: "My issues", section: "Workspace", count: 3 },
            { id: "all-issues", kind: "allIssues", label: "All issues", section: "Workspace", count: 24 },
            { id: "projects", kind: "projects", label: "All projects", section: "Workspace", count: 5 },
            { id: "teams", kind: "teams", label: "All teams", section: "Workspace", count: 3 },
        ],
    );

    const reviewView = navigation.find((entry) => entry.kind === "customView" && entry.resourceId === "view-review");
    const coreTeam = navigation.find((entry) => entry.kind === "teamIssues" && entry.resourceId === "team-core");
    const terminalProject = navigation.find((entry) => entry.kind === "projectIssues" && entry.resourceId === "project-terminal");
    assert.deepEqual(
        [reviewView, coreTeam, terminalProject].map((entry) => ({
            label: entry?.label,
            section: entry?.section,
            count: entry?.count,
        })),
        [
            { label: "Waiting for review", section: "Views", count: 3 },
            { label: "CORE  Core Platform", section: "Teams", count: 8 },
            { label: "Keyboard-first workspace", section: "Projects", count: 8 },
        ],
    );
});

test("contentForNavigation resolves every navigation kind without changing source order", () => {
    const workspace = createDemoWorkspace();
    const navigation = buildNavigation(workspace);
    const myIssues = navigation.find((entry) => entry.kind === "myIssues");
    const allIssues = navigation.find((entry) => entry.kind === "allIssues");
    const projects = navigation.find((entry) => entry.kind === "projects");
    const teams = navigation.find((entry) => entry.kind === "teams");
    const reviewView = navigation.find((entry) => entry.kind === "customView" && entry.resourceId === "view-review");
    const coreTeam = navigation.find((entry) => entry.kind === "teamIssues" && entry.resourceId === "team-core");
    const terminalProject = navigation.find((entry) => entry.kind === "projectIssues" && entry.resourceId === "project-terminal");

    assert.ok(myIssues && allIssues && projects && teams && reviewView && coreTeam && terminalProject);
    assert.deepEqual(
        contentForNavigation(workspace, myIssues).map((resource) => resource.id),
        workspace.issues.filter((issue) => issue.assignee?.id === workspace.viewer.id).map((issue) => issue.id),
    );
    assert.strictEqual(contentForNavigation(workspace, allIssues), workspace.issues);
    assert.strictEqual(contentForNavigation(workspace, projects), workspace.projects);
    assert.strictEqual(contentForNavigation(workspace, teams), workspace.teams);
    assert.deepEqual(
        contentForNavigation(workspace, reviewView).map((resource) => resource.id),
        workspace.customViews.find((view) => view.id === "view-review")?.issueIds,
    );
    assert.ok(contentForNavigation(workspace, coreTeam).every((resource) => "identifier" in resource && resource.team.id === "team-core"));
    assert.ok(contentForNavigation(workspace, terminalProject).every((resource) => "identifier" in resource && resource.project?.id === "project-terminal"));
    assert.equal(resourceKindForNavigation(myIssues), "issues");
    assert.equal(resourceKindForNavigation(projects), "projects");
    assert.equal(resourceKindForNavigation(teams), "teams");
});

test("filterResources applies case-insensitive AND terms across resource metadata", () => {
    const workspace = createDemoWorkspace();

    assert.strictEqual(filterResources(workspace.issues, "  \t "), workspace.issues);
    assert.deepEqual(
        filterResources(workspace.issues, "CORE security").map((resource) => (resource as Issue).identifier),
        ["CORE-134", "CORE-141"],
    );
    assert.deepEqual(
        filterResources(workspace.issues, "xAvIeR TODO").map((resource) => (resource as Issue).identifier),
        ["CORE-134", "CORE-141", "GROW-58"],
    );
    assert.deepEqual(
        filterResources(workspace.projects, "PUBLIC typed").map((resource) => resource.id),
        ["project-api"],
    );
    assert.deepEqual(
        filterResources(workspace.customViews, "customer open").map((resource) => resource.id),
        ["view-customer"],
    );
});

test("groupResources partitions issues by each supported dimension", () => {
    const workspace = createDemoWorkspace();
    const dimensions: Array<[GroupBy, (issue: Issue) => string]> = [
        ["status", (issue) => `${issue.state.type}:${issue.state.name.toLocaleLowerCase()}`],
        ["project", (issue) => issue.project?.id ?? "none"],
        ["assignee", (issue) => issue.assignee?.id ?? "none"],
        ["team", (issue) => issue.team.id],
    ];

    for (const [dimension, expectedGroupId] of dimensions) {
        const groups = groupResources(workspace.issues, dimension);
        assert.equal(groups.flatMap((group) => group.items).length, workspace.issues.length);
        if (dimension === "status") {
            const positions = groups.map((group) => {
                const issue = group.items.find((resource): resource is Issue => "identifier" in resource);
                return issue?.state.position ?? 0;
            });
            assert.deepEqual(positions, [...positions].sort((left, right) => left - right));
        } else {
            const labels = groups.map((group) => group.label);
            assert.deepEqual(labels, [...labels].sort((left, right) => left.localeCompare(right)));
        }
        for (const group of groups) {
            assert.ok(group.items.every((resource) => "identifier" in resource && expectedGroupId(resource) === group.id));
        }
    }

    assert.deepEqual(
        groupResources(workspace.issues, "priority").map(({ id, label, items }) => ({ id, label, count: items.length })),
        [
            { id: "1", label: "Urgent", count: 5 },
            { id: "2", label: "High", count: 10 },
            { id: "3", label: "Medium", count: 6 },
            { id: "4", label: "Low", count: 3 },
        ],
    );
});

test("groupResources uses project states and a single team collection for non-issues", () => {
    const workspace = createDemoWorkspace();

    assert.deepEqual(
        groupResources(workspace.projects, "status").map(({ id, label, items }) => ({ id, label, count: items.length })),
        [
            { id: "project-status-planned", label: "Planned", count: 1 },
            { id: "project-status-started", label: "In progress", count: 3 },
            { id: "project-status-completed", label: "Completed", count: 1 },
        ],
    );
    assert.deepEqual(groupResources(workspace.teams, "priority"), [
        { id: "teams", label: "Teams", color: "#65D1C7", items: workspace.teams },
    ]);
    assert.deepEqual(groupResources([], "status"), []);
});