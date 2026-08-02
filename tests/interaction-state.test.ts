import assert from "node:assert/strict";
import test from "node:test";
import { createDemoWorkspace } from "../lib/demo-data.js";
import type { WorkspaceResourceReference } from "../lib/types.js";
import {
    initialInteractionState,
    interactionReducer,
    type InteractionState,
} from "../src/interaction-state.js";

test("workspace reconciliation preserves a visible selection and repairs invalid navigation and selection together", () => {
    const snapshot = createDemoWorkspace();
    const selectedIssue = snapshot.issues.find((issue) => issue.teamId === "team-core");
    const replacementProject = snapshot.projects[0];
    assert.ok(selectedIssue && replacementProject);
    const selectedReference: WorkspaceResourceReference = { kind: "issue", id: selectedIssue.id };
    let state: InteractionState = {
        ...initialInteractionState,
        focus: "content",
        navigation: { kind: "teamIssues", teamId: "team-core" },
        selectedResource: selectedReference,
    };

    const unchanged = interactionReducer(state, {
        type: "workspaceReconciled",
        snapshot,
        visibleResources: [selectedReference, { kind: "issue", id: snapshot.issues[1]!.id }],
    });
    assert.strictEqual(unchanged, state);

    const snapshotWithoutSelectedTeam = {
        ...snapshot,
        teams: snapshot.teams.filter((team) => team.id !== "team-core"),
    };
    const replacementReference: WorkspaceResourceReference = { kind: "project", id: replacementProject.id };
    state = interactionReducer(state, {
        type: "workspaceReconciled",
        snapshot: snapshotWithoutSelectedTeam,
        visibleResources: [replacementReference],
    });

    assert.deepEqual(state.navigation, { kind: "myIssues" });
    assert.deepEqual(state.selectedResource, replacementReference);
    assert.equal(state.focus, "content");
});

test("reconciliation does not close an editor when no committed workspace outcome was published", () => {
    const snapshot = createDemoWorkspace();
    const issue = snapshot.issues[0]!;
    const state = interactionReducer(initialInteractionState, {
        type: "modalOpened",
        modal: {
            type: "editor",
            target: { mode: "edit", kind: "issue", resource: issue },
        },
    });

    const reconciled = interactionReducer(state, {
        type: "workspaceReconciled",
        snapshot,
        visibleResources: [{ kind: "issue", id: issue.id }],
    });

    assert.equal(reconciled.modal?.type, "editor");
    assert.equal(reconciled.handledOutcomeId, 0);
});

test("committed outcomes close the modal exactly once and select or clear the affected resource", () => {
    const snapshot = createDemoWorkspace();
    const issue = snapshot.issues[0]!;
    let state = interactionReducer(initialInteractionState, {
        type: "modalOpened",
        modal: {
            type: "editor",
            target: { mode: "edit", kind: "issue", resource: issue },
        },
    });
    const createdOutcome = {
        id: 1,
        status: "committed" as const,
        receipt: {
            action: "created" as const,
            resource: { kind: "customView" as const, id: "view-created" },
        },
    };

    state = interactionReducer(state, { type: "workspaceOutcomeApplied", outcome: createdOutcome });
    assert.equal(state.modal, null);
    assert.deepEqual(state.selectedResource, { kind: "customView", id: "view-created" });
    assert.equal(state.handledOutcomeId, 1);
    assert.strictEqual(
        interactionReducer(state, { type: "workspaceOutcomeApplied", outcome: createdOutcome }),
        state,
    );

    state = interactionReducer(state, {
        type: "modalOpened",
        modal: {
            type: "confirm",
            resource: snapshot.customViews[0]!,
            title: "Delete custom view?",
            body: "This permanently deletes the selected custom view.",
        },
    });
    state = interactionReducer(state, {
        type: "workspaceOutcomeApplied",
        outcome: {
            id: 2,
            status: "committed",
            receipt: {
                action: "deleted",
                resource: { kind: "customView", id: "view-created" },
            },
        },
    });

    assert.equal(state.modal, null);
    assert.equal(state.selectedResource, undefined);
    assert.equal(state.handledOutcomeId, 2);
});

test("an archive outcome preserves an unrelated selection but clears the archived selection", () => {
    const selected: WorkspaceResourceReference = { kind: "issue", id: "issue-selected" };
    const initial: InteractionState = { ...initialInteractionState, selectedResource: selected };
    const unrelated = interactionReducer(initial, {
        type: "workspaceOutcomeApplied",
        outcome: {
            id: 1,
            status: "committed",
            receipt: { action: "archived", resource: { kind: "project", id: "project-1" } },
        },
    });
    assert.deepEqual(unrelated.selectedResource, selected);

    const archived = interactionReducer(unrelated, {
        type: "workspaceOutcomeApplied",
        outcome: {
            id: 2,
            status: "committed",
            receipt: { action: "archived", resource: selected },
        },
    });
    assert.equal(archived.selectedResource, undefined);
});