import assert from "node:assert/strict";
import test from "node:test";
import { createDemoWorkspace } from "../lib/demo-data.js";
import { customViewEditorDefinition } from "../src/editor/custom-view-editor.js";
import { issueEditorDefinition } from "../src/editor/issue-editor.js";
import { projectEditorDefinition } from "../src/editor/project-editor.js";
import { teamEditorDefinition } from "../src/editor/team-editor.js";

test("issue editor keeps team and state dependent, validates visible relationships, and decodes create and edit commands", () => {
    const snapshot = createDemoWorkspace();
    const createContext = {
        snapshot,
        target: {
            mode: "create",
            kind: "issue",
            context: {
                teamId: "team-app",
                projectId: "project-terminal",
                assigneeId: "user-maya",
            },
        },
    } as const;
    const initial = issueEditorDefinition.initialValues(createContext);
    assert.equal(initial.teamId, "team-app");
    assert.equal(initial.stateId, "team-app-todo");
    assert.equal(initial.projectId, "project-terminal");
    assert.equal(initial.assigneeId, "user-maya");

    const changedTeam = issueEditorDefinition.applyChange?.(initial, "teamId", "team-growth", createContext);
    assert.ok(changedTeam);
    assert.equal(changedTeam.teamId, "team-growth");
    assert.equal(changedTeam.stateId, "team-growth-todo");
    assert.deepEqual(
        issueEditorDefinition.validate({ ...changedTeam, title: "Cross-team issue", stateId: "team-core-todo" }, createContext),
        { valid: false, field: "stateId", message: "Status must belong to the selected team." },
    );

    const createValues = {
        ...changedTeam,
        title: "  Ship dependent editor state  ",
        description: "Keep the command provider independent.",
        priority: "1",
        labelIds: "Bug, label-security, Bug",
        dueDate: "",
        estimate: "3",
    };
    assert.deepEqual(issueEditorDefinition.validate(createValues, createContext), { valid: true });
    assert.deepEqual(issueEditorDefinition.decode(createValues, createContext), {
        kind: "issue",
        action: "create",
        input: {
            title: "Ship dependent editor state",
            description: "Keep the command provider independent.",
            teamId: "team-growth",
            stateId: "team-growth-todo",
            priority: 1,
            projectId: "project-terminal",
            assigneeId: "user-maya",
            labelIds: ["label-bug", "label-security"],
            dueDate: null,
            estimate: 3,
        },
    });

    const issue = snapshot.issues[0]!;
    const editContext = { snapshot, target: { mode: "edit", kind: "issue", resource: issue } } as const;
    const editValues = issueEditorDefinition.initialValues(editContext);
    const editCommand = issueEditorDefinition.decode({ ...editValues, title: "Edited issue" }, editContext);
    assert.equal(editCommand.action, "update");
    assert.equal(editCommand.kind, "issue");
    if (editCommand.action === "update" && editCommand.kind === "issue") {
        assert.equal(editCommand.id, issue.id);
        assert.equal(editCommand.input.title, "Edited issue");
        assert.deepEqual(editCommand.input.labelIds, issue.labelIds);
    }
});

test("project editor resolves stable team IDs and decodes create and edit commands without leaking display references", () => {
    const snapshot = createDemoWorkspace();
    const createContext = {
        snapshot,
        target: { mode: "create", kind: "project", context: {} },
    } as const;
    const initial = projectEditorDefinition.initialValues(createContext);
    const createValues = {
        ...initial,
        name: "  Architecture migration  ",
        summary: "  Move persistence behind the workspace session.  ",
        description: "Detailed implementation context.",
        teamIds: "CORE, Product Experience, CORE",
        statusId: "project-status-started",
        leadId: "",
        color: " #123456 ",
        startDate: "",
        targetDate: "2026-10-31",
    };
    assert.deepEqual(projectEditorDefinition.validate(createValues, createContext), { valid: true });
    assert.deepEqual(projectEditorDefinition.decode(createValues, createContext), {
        kind: "project",
        action: "create",
        input: {
            name: "Architecture migration",
            summary: "Move persistence behind the workspace session.",
            description: "Detailed implementation context.",
            teamIds: ["team-core", "team-app"],
            statusId: "project-status-started",
            leadId: null,
            color: "#123456",
            startDate: null,
            targetDate: "2026-10-31",
        },
    });
    assert.equal(
        projectEditorDefinition.validate({ ...createValues, teamIds: "missing-team" }, createContext).valid,
        false,
    );

    const project = snapshot.projects[1]!;
    const editContext = { snapshot, target: { mode: "edit", kind: "project", resource: project } } as const;
    const editValues = projectEditorDefinition.initialValues(editContext);
    assert.equal(editValues.teamIds, "APP, CORE");
    const editCommand = projectEditorDefinition.decode({ ...editValues, summary: "Updated summary" }, editContext);
    assert.equal(editCommand.action, "update");
    assert.equal(editCommand.kind, "project");
    if (editCommand.action === "update" && editCommand.kind === "project") {
        assert.equal(editCommand.id, project.id);
        assert.equal(editCommand.input.summary, "Updated summary");
        assert.deepEqual(editCommand.input.teamIds, project.teamIds);
    }
});

test("team editor owns visibility and key invariants for create and edit commands", () => {
    const snapshot = createDemoWorkspace();
    const createContext = { snapshot, target: { mode: "create", kind: "team", context: {} } } as const;
    const initial = teamEditorDefinition.initialValues(createContext);
    const createValues = {
        ...initial,
        name: "  Infrastructure  ",
        key: " infra ",
        description: "Infrastructure work",
        color: " #ABCDEF ",
        visibility: "private",
    };
    assert.deepEqual(teamEditorDefinition.validate(createValues, createContext), { valid: true });
    assert.deepEqual(teamEditorDefinition.decode(createValues, createContext), {
        kind: "team",
        action: "create",
        input: {
            name: "Infrastructure",
            key: "INFRA",
            description: "Infrastructure work",
            color: "#ABCDEF",
            visibility: "private",
        },
    });
    assert.deepEqual(
        teamEditorDefinition.validate({ ...createValues, visibility: "secret" }, createContext),
        { valid: false, field: "visibility", message: "Visibility is invalid." },
    );

    const team = snapshot.teams[0]!;
    const editContext = { snapshot, target: { mode: "edit", kind: "team", resource: team } } as const;
    const editValues = teamEditorDefinition.initialValues(editContext);
    const editCommand = teamEditorDefinition.decode({ ...editValues, name: "Core Systems" }, editContext);
    assert.equal(editCommand.action, "update");
    assert.equal(editCommand.kind, "team");
    if (editCommand.action === "update" && editCommand.kind === "team") {
        assert.equal(editCommand.id, team.id);
        assert.equal(editCommand.input.name, "Core Systems");
        assert.equal(editCommand.input.visibility, team.visibility);
    }
});

test("custom-view editor builds simple filters, validates advanced JSON, and decodes create and edit commands", () => {
    const snapshot = createDemoWorkspace();
    const createContext = {
        snapshot,
        target: { mode: "create", kind: "customView", context: {} },
    } as const;
    const initial = customViewEditorDefinition.initialValues(createContext);
    const createValues = {
        ...initial,
        name: "  Core urgency  ",
        description: "Urgent core work",
        shared: "true",
        teamId: "team-core",
        stateType: "started",
        priority: "1",
        projectId: "project-api",
        assigneeId: "user-xavier",
    };
    assert.deepEqual(customViewEditorDefinition.validate(createValues, createContext), { valid: true });
    assert.deepEqual(customViewEditorDefinition.decode(createValues, createContext), {
        kind: "customView",
        action: "create",
        input: {
            name: "Core urgency",
            description: "Urgent core work",
            shared: true,
            filterData: {
                and: [
                    { team: { id: { eq: "team-core" } } },
                    { state: { type: { eq: "started" } } },
                    { priority: { eq: 1 } },
                    { project: { id: { eq: "project-api" } } },
                    { assignee: { id: { eq: "user-xavier" } } },
                ],
            },
        },
    });
    assert.deepEqual(
        customViewEditorDefinition.validate({ ...createValues, filterJson: "[1, 2]" }, createContext),
        { valid: false, field: "filterJson", message: "Advanced filter JSON must be an object." },
    );
    assert.equal(
        customViewEditorDefinition.validate({ ...createValues, filterJson: "{" }, createContext).valid,
        false,
    );

    const advancedValues = {
        ...createValues,
        filterJson: JSON.stringify({ labels: { some: { name: { eq: "Security" } } } }),
    };
    const advancedCommand = customViewEditorDefinition.decode(advancedValues, createContext);
    assert.equal(advancedCommand.kind, "customView");
    assert.equal(advancedCommand.action, "create");
    if (advancedCommand.kind === "customView" && advancedCommand.action === "create") {
        assert.deepEqual(advancedCommand.input.filterData, {
            labels: { some: { name: { eq: "Security" } } },
        });
    }

    const view = snapshot.customViews[0]!;
    const editContext = { snapshot, target: { mode: "edit", kind: "customView", resource: view } } as const;
    const editValues = customViewEditorDefinition.initialValues(editContext);
    const editCommand = customViewEditorDefinition.decode({ ...editValues, name: "Urgent active work" }, editContext);
    assert.equal(editCommand.action, "update");
    assert.equal(editCommand.kind, "customView");
    if (editCommand.action === "update" && editCommand.kind === "customView") {
        assert.equal(editCommand.id, view.id);
        assert.equal(editCommand.input.name, "Urgent active work");
        assert.deepEqual(editCommand.input.filterData, view.filterData);
    }
});