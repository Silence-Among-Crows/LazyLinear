import { randomUUID } from "node:crypto";
import { ISSUE_PRIORITIES } from "../lib/priorities.js";
import type {
    CustomView,
    Issue,
    IssueCreateInput,
    IssueUpdateInput,
    Project,
    ProjectCreateInput,
    ProjectUpdateInput,
    Team,
    TeamCreateInput,
    TeamUpdateInput,
    WorkspaceCommit,
    WorkspaceCommitReceipt,
    WorkspaceFailureCode,
    WorkspaceSnapshot,
} from "../lib/types.js";
import { WorkspaceAdapterError } from "./workspace-adapter.js";

export interface DemoStoreState {
    readonly snapshot: WorkspaceSnapshot;
    readonly issueNumberHighWatermarks: ReadonlyMap<string, number>;
}

export interface DemoCommitResult {
    readonly state: DemoStoreState;
    readonly receipt: WorkspaceCommitReceipt;
}

type IssueFilterPredicate = (issue: Issue) => boolean;
type FilterScalarKind = "priority" | "string" | "nullableString";

const newTeamWorkflowStates = [
    { name: "Backlog", type: "backlog", color: "#6B7480" },
    { name: "Todo", type: "unstarted", color: "#8B93A1" },
    { name: "In Progress", type: "started", color: "#F2C94C" },
    { name: "Done", type: "completed", color: "#4CB782" },
    { name: "Canceled", type: "canceled", color: "#8B93A1" },
] as const;

function throwDemoFailure(code: WorkspaceFailureCode, message: string): never {
    throw new WorkspaceAdapterError({
        code,
        message,
        retryable: false,
    });
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireNonBlank(value: string, field: string): void {
    if (value.trim().length === 0) {
        throwDemoFailure("validation", `${field} cannot be empty.`);
    }
}

function assertSupportedPriority(priority: unknown): void {
    if (priority !== undefined && !ISSUE_PRIORITIES.some((candidate) => candidate.value === priority)) {
        throwDemoFailure("validation", "Issue priority must be an integer from 0 through 4.");
    }
}

function requireExisting<T extends { readonly id: string }>(
    resources: readonly T[],
    id: string,
    resourceName: string,
): T {
    const resource = resources.find((candidate) => candidate.id === id);
    if (!resource) {
        throwDemoFailure("notFound", `${resourceName} '${id}' no longer exists.`);
    }

    return resource;
}

function assertReferencesExist(
    ids: readonly string[],
    availableIds: ReadonlySet<string>,
    field: string,
): void {
    const unknownId = ids.find((id) => !availableIds.has(id));
    if (unknownId) {
        throwDemoFailure("validation", `${field} references unknown ID '${unknownId}'.`);
    }

    if (new Set(ids).size !== ids.length) {
        throwDemoFailure("validation", `${field} cannot contain duplicate IDs.`);
    }
}

function isFilterScalar(value: unknown, kind: FilterScalarKind): boolean {
    if (kind === "priority") {
        return Number.isInteger(value) && typeof value === "number" && value >= 0 && value <= 4;
    }
    if (kind === "nullableString" && value === null) {
        return true;
    }
    return typeof value === "string";
}

function compileComparator(
    rawComparator: unknown,
    kind: FilterScalarKind,
    path: string,
): (value: unknown) => boolean {
    if (!isRecord(rawComparator)) {
        throwDemoFailure("unsupported", `${path} must contain a supported comparator.`);
    }

    const keys = Object.keys(rawComparator);
    if (keys.length !== 1 || !["eq", "neq", "in", "nin"].includes(keys[0]!)) {
        throwDemoFailure("unsupported", `${path} must use exactly one of eq, neq, in, or nin.`);
    }

    const comparator = keys[0]!;
    const expected = rawComparator[comparator];
    if (comparator === "in" || comparator === "nin") {
        if (!Array.isArray(expected) || !expected.every((value) => isFilterScalar(value, kind))) {
            throwDemoFailure("unsupported", `${path}.${comparator} contains an unsupported value.`);
        }

        return comparator === "in"
            ? (value) => expected.includes(value)
            : (value) => !expected.includes(value);
    }

    if (!isFilterScalar(expected, kind)) {
        throwDemoFailure("unsupported", `${path}.${comparator} contains an unsupported value.`);
    }

    return comparator === "eq"
        ? (value) => value === expected
        : (value) => value !== expected;
}

function compileRelatedField(
    rawField: unknown,
    propertyKinds: Readonly<Record<string, FilterScalarKind>>,
    path: string,
): Readonly<Record<string, (value: unknown) => boolean>> {
    if (!isRecord(rawField)) {
        throwDemoFailure("unsupported", `${path} must be an object.`);
    }

    const keys = Object.keys(rawField);
    if (keys.length === 0 || keys.some((key) => propertyKinds[key] === undefined)) {
        throwDemoFailure("unsupported", `${path} contains an unsupported field.`);
    }

    return Object.fromEntries(keys.map((key) => [
        key,
        compileComparator(rawField[key], propertyKinds[key]!, `${path}.${key}`),
    ]));
}

function compileIssueFilter(workspace: WorkspaceSnapshot, rawFilter: unknown, path = "filterData"): IssueFilterPredicate {
    if (rawFilter === undefined || rawFilter === null) {
        return () => true;
    }
    if (!isRecord(rawFilter)) {
        throwDemoFailure("unsupported", `${path} must be an object.`);
    }

    const allowedKeys = new Set(["and", "or", "priority", "state", "team", "project", "assignee", "labels"]);
    const keys = Object.keys(rawFilter);
    const unsupportedKey = keys.find((key) => !allowedKeys.has(key));
    if (unsupportedKey) {
        throwDemoFailure("unsupported", `${path}.${unsupportedKey} is not supported in demo mode.`);
    }

    const predicates: IssueFilterPredicate[] = [];
    for (const key of keys) {
        const value = rawFilter[key];
        if (key === "and" || key === "or") {
            if (!Array.isArray(value) || value.length === 0 || value.some((part) => !isRecord(part))) {
                throwDemoFailure("unsupported", `${path}.${key} must be a non-empty array.`);
            }
            const nested = value.map((part, index) => compileIssueFilter(workspace, part, `${path}.${key}[${index}]`));
            predicates.push(key === "and"
                ? (issue) => nested.every((predicate) => predicate(issue))
                : (issue) => nested.some((predicate) => predicate(issue)));
            continue;
        }

        if (key === "priority") {
            const matches = compileComparator(value, "priority", `${path}.priority`);
            predicates.push((issue) => matches(issue.priority));
            continue;
        }

        if (key === "state") {
            const fields = compileRelatedField(value, { id: "string", name: "string", type: "string" }, `${path}.state`);
            predicates.push((issue) => {
                const state = workspace.workflowStates.find((candidate) => candidate.id === issue.stateId);
                return state !== undefined
                    && (fields.id?.(state.id) ?? true)
                    && (fields.name?.(state.name) ?? true)
                    && (fields.type?.(state.type) ?? true);
            });
            continue;
        }

        if (key === "team") {
            const fields = compileRelatedField(value, { id: "string" }, `${path}.team`);
            predicates.push((issue) => fields.id?.(issue.teamId) ?? true);
            continue;
        }

        if (key === "project" || key === "assignee") {
            const fields = compileRelatedField(value, { id: "nullableString" }, `${path}.${key}`);
            predicates.push(key === "project"
                ? (issue) => fields.id?.(issue.projectId ?? null) ?? true
                : (issue) => fields.id?.(issue.assigneeId ?? null) ?? true);
            continue;
        }

        if (key === "labels") {
            if (!isRecord(value) || Object.keys(value).length !== 1 || !("some" in value)) {
                throwDemoFailure("unsupported", `${path}.labels only supports the some relationship filter.`);
            }
            const fields = compileRelatedField(value.some, { id: "string", name: "string" }, `${path}.labels.some`);
            predicates.push((issue) => issue.labelIds.some((labelId) => {
                const label = workspace.labels.find((candidate) => candidate.id === labelId);
                return label !== undefined
                    && (fields.id?.(label.id) ?? true)
                    && (fields.name?.(label.name) ?? true);
            }));
        }
    }

    return (issue) => predicates.every((predicate) => predicate(issue));
}

function assertSupportedProjectFilter(rawFilter: unknown): void {
    if (rawFilter === undefined || rawFilter === null) {
        return;
    }
    if (!isRecord(rawFilter) || Object.keys(rawFilter).length > 0) {
        throwDemoFailure("unsupported", "projectFilterData is not supported in demo mode.");
    }
}

function refreshCustomViewMembership(workspace: WorkspaceSnapshot): WorkspaceSnapshot {
    const customViews = workspace.customViews.map((view) => {
        const matches = compileIssueFilter(workspace, view.filterData);
        return {
            ...view,
            issueIds: workspace.issues.filter(matches).map((issue) => issue.id),
        };
    });
    return { ...workspace, customViews };
}

export function createDemoStoreState(snapshot: WorkspaceSnapshot): DemoStoreState {
    const issueNumberHighWatermarks = new Map<string, number>();
    for (const issue of snapshot.issues) {
        const issueNumber = Number(issue.identifier.split("-").at(-1));
        if (!Number.isFinite(issueNumber)) {
            continue;
        }

        const currentHighWatermark = issueNumberHighWatermarks.get(issue.teamId) ?? 0;
        issueNumberHighWatermarks.set(issue.teamId, Math.max(currentHighWatermark, issueNumber));
    }

    return {
        snapshot: structuredClone(snapshot),
        issueNumberHighWatermarks,
    };
}

function issueStateId(workspace: WorkspaceSnapshot, teamId: string, requestedStateId?: string): string {
    const state = requestedStateId === undefined
        ? workspace.workflowStates.find((candidate) => candidate.teamId === teamId && candidate.type === "unstarted")
            ?? workspace.workflowStates.find((candidate) => candidate.teamId === teamId)
        : workspace.workflowStates.find((candidate) => candidate.id === requestedStateId);
    if (!state || state.teamId !== teamId) {
        throwDemoFailure("validation", "The selected workflow state does not belong to the selected team.");
    }

    return state.id;
}

function assertIssueRelationships(
    workspace: WorkspaceSnapshot,
    issueId: string | undefined,
    teamId: string,
    stateId: string,
    projectId: string | null | undefined,
    assigneeId: string | null | undefined,
    labelIds: readonly string[],
    parentId: string | null | undefined,
): void {
    if (!workspace.teams.some((team) => team.id === teamId)) {
        throwDemoFailure("validation", `Team '${teamId}' does not exist.`);
    }
    const state = workspace.workflowStates.find((candidate) => candidate.id === stateId);
    if (!state || state.teamId !== teamId) {
        throwDemoFailure("validation", "The selected workflow state does not belong to the selected team.");
    }

    if (projectId !== undefined && projectId !== null) {
        const project = workspace.projects.find((candidate) => candidate.id === projectId);
        if (!project) {
            throwDemoFailure("validation", `Project '${projectId}' does not exist.`);
        }
    }
    if (assigneeId !== undefined && assigneeId !== null && !workspace.users.some((user) => user.id === assigneeId)) {
        throwDemoFailure("validation", `Assignee '${assigneeId}' does not exist.`);
    }

    assertReferencesExist(labelIds, new Set(workspace.labels.map((label) => label.id)), "labelIds");
    if (parentId !== undefined && parentId !== null) {
        if (parentId === issueId) {
            throwDemoFailure("validation", "An issue cannot be its own parent.");
        }
        if (!workspace.issues.some((issue) => issue.id === parentId)) {
            throwDemoFailure("validation", `Parent issue '${parentId}' does not exist.`);
        }
    }
}

function createIssue(
    workspace: WorkspaceSnapshot,
    input: IssueCreateInput,
    issueNumber: number,
    now: string,
): Issue {
    requireNonBlank(input.title, "Issue title");
    assertSupportedPriority(input.priority);
    const team = workspace.teams.find((candidate) => candidate.id === input.teamId);
    if (!team) {
        throwDemoFailure("validation", `Team '${input.teamId}' does not exist.`);
    }
    const stateId = issueStateId(workspace, team.id, input.stateId);
    const labelIds = input.labelIds ?? [];
    assertIssueRelationships(
        workspace,
        undefined,
        team.id,
        stateId,
        input.projectId,
        input.assigneeId,
        labelIds,
        input.parentId,
    );

    return {
        kind: "issue",
        id: randomUUID(),
        identifier: `${team.key}-${issueNumber}`,
        title: input.title,
        description: input.description ?? "",
        priority: input.priority ?? 0,
        estimate: input.estimate ?? null,
        dueDate: input.dueDate ?? null,
        createdAt: now,
        updatedAt: now,
        url: `https://linear.app/${workspace.viewer.organization.urlKey}/issue/new-demo-issue`,
        stateId,
        teamId: team.id,
        projectId: input.projectId ?? null,
        assigneeId: input.assigneeId ?? null,
        creatorId: workspace.viewer.id,
        labelIds: workspace.labels.filter((label) => labelIds.includes(label.id)).map((label) => label.id),
        parentId: input.parentId ?? null,
    };
}

function updateIssue(
    workspace: WorkspaceSnapshot,
    issue: Issue,
    input: IssueUpdateInput,
    now: string,
): Issue {
    if (input.title !== undefined) {
        requireNonBlank(input.title, "Issue title");
    }
    assertSupportedPriority(input.priority);

    const teamId = input.teamId ?? issue.teamId;
    const stateId = input.stateId ?? issue.stateId;
    const projectId = input.projectId === undefined ? issue.projectId : input.projectId;
    const assigneeId = input.assigneeId === undefined ? issue.assigneeId : input.assigneeId;
    const labelIds = input.labelIds ?? issue.labelIds;
    const parentId = input.parentId === undefined ? issue.parentId : input.parentId;
    assertIssueRelationships(workspace, issue.id, teamId, stateId, projectId, assigneeId, labelIds, parentId);

    return {
        kind: "issue",
        id: issue.id,
        identifier: issue.identifier,
        title: input.title ?? issue.title,
        description: input.description ?? issue.description,
        priority: input.priority ?? issue.priority,
        estimate: input.estimate === undefined ? issue.estimate : input.estimate,
        dueDate: input.dueDate === undefined ? issue.dueDate : input.dueDate,
        createdAt: issue.createdAt,
        updatedAt: now,
        url: issue.url,
        stateId,
        teamId,
        projectId,
        assigneeId,
        creatorId: issue.creatorId,
        labelIds: workspace.labels.filter((label) => labelIds.includes(label.id)).map((label) => label.id),
        parentId,
    };
}

function assertProjectRelationships(workspace: WorkspaceSnapshot, input: ProjectCreateInput | ProjectUpdateInput): void {
    if (input.teamIds !== undefined) {
        if (input.teamIds.length === 0) {
            throwDemoFailure("validation", "A project must be associated with at least one team.");
        }
        assertReferencesExist(input.teamIds, new Set(workspace.teams.map((team) => team.id)), "teamIds");
    }
    if (input.statusId !== undefined && !workspace.projectStatuses.some((status) => status.id === input.statusId)) {
        throwDemoFailure("validation", `Project status '${input.statusId}' does not exist.`);
    }
    if (input.leadId !== undefined && input.leadId !== null && !workspace.users.some((user) => user.id === input.leadId)) {
        throwDemoFailure("validation", `Project lead '${input.leadId}' does not exist.`);
    }
}

function createProject(workspace: WorkspaceSnapshot, input: ProjectCreateInput, now: string): Project {
    requireNonBlank(input.name, "Project name");
    assertProjectRelationships(workspace, input);
    return {
        kind: "project",
        id: randomUUID(),
        name: input.name,
        summary: input.summary,
        description: input.description,
        color: input.color ?? "#5E6AD2",
        icon: input.icon,
        statusId: input.statusId ?? workspace.projectStatuses[0]?.id ?? null,
        progress: 0,
        startDate: input.startDate ?? null,
        targetDate: input.targetDate ?? null,
        createdAt: now,
        updatedAt: now,
        teamIds: [...input.teamIds],
        leadId: input.leadId ?? null,
    };
}

function updateProject(
    workspace: WorkspaceSnapshot,
    project: Project,
    input: ProjectUpdateInput,
    now: string,
): Project {
    if (input.name !== undefined) {
        requireNonBlank(input.name, "Project name");
    }
    assertProjectRelationships(workspace, input);

    return {
        kind: "project",
        id: project.id,
        name: input.name ?? project.name,
        summary: input.summary ?? project.summary,
        description: input.description ?? project.description,
        color: input.color ?? project.color,
        icon: input.icon ?? project.icon,
        statusId: input.statusId ?? project.statusId,
        progress: project.progress,
        startDate: input.startDate === undefined ? project.startDate : input.startDate,
        targetDate: input.targetDate === undefined ? project.targetDate : input.targetDate,
        createdAt: project.createdAt,
        updatedAt: now,
        url: project.url,
        teamIds: input.teamIds === undefined
            ? project.teamIds
            : [...input.teamIds],
        leadId: input.leadId === undefined ? project.leadId : input.leadId,
    };
}

function assertTeamIdentity(workspace: WorkspaceSnapshot, input: TeamCreateInput | TeamUpdateInput, teamId?: string): void {
    if (input.name !== undefined) {
        requireNonBlank(input.name, "Team name");
    }
    if (input.key !== undefined) {
        requireNonBlank(input.key, "Team key");
        const keyIsUsed = workspace.teams.some((team) => team.id !== teamId && team.key.toLowerCase() === input.key?.toLowerCase());
        if (keyIsUsed) {
            throwDemoFailure("validation", `Team key '${input.key}' is already in use.`);
        }
    }
}

function createTeam(workspace: WorkspaceSnapshot, input: TeamCreateInput, now: string): Team {
    assertTeamIdentity(workspace, input);
    return {
        kind: "team",
        id: randomUUID(),
        name: input.name,
        key: input.key,
        description: input.description,
        color: input.color,
        icon: input.icon,
        visibility: input.visibility ?? "workspace",
        createdAt: now,
        updatedAt: now,
    };
}

function updateTeam(workspace: WorkspaceSnapshot, team: Team, input: TeamUpdateInput, now: string): Team {
    assertTeamIdentity(workspace, input, team.id);
    return {
        kind: "team",
        id: team.id,
        name: input.name ?? team.name,
        key: input.key ?? team.key,
        description: input.description ?? team.description,
        color: input.color ?? team.color,
        icon: input.icon ?? team.icon,
        visibility: input.visibility ?? team.visibility,
        createdAt: team.createdAt,
        updatedAt: now,
    };
}

function assertCustomViewFilters(filterData: unknown, projectFilterData: unknown, workspace: WorkspaceSnapshot): void {
    compileIssueFilter(workspace, filterData);
    assertSupportedProjectFilter(projectFilterData);
}

export function commitDemoWorkspace(current: DemoStoreState, change: WorkspaceCommit): DemoCommitResult {
    const workspace = current.snapshot;
    const now = new Date().toISOString();
    let snapshot = structuredClone(workspace);
    let issueNumberHighWatermarks = current.issueNumberHighWatermarks;
    let receipt: WorkspaceCommitReceipt;

    if (change.kind === "issue") {
        if (change.action === "create") {
            const issueNumber = (current.issueNumberHighWatermarks.get(change.input.teamId) ?? 0) + 1;
            const issue = createIssue(workspace, change.input, issueNumber, now);
            snapshot = { ...snapshot, issues: [issue, ...snapshot.issues] };
            issueNumberHighWatermarks = new Map(current.issueNumberHighWatermarks).set(issue.teamId, issueNumber);
            receipt = { action: "created", resource: { kind: "issue", id: issue.id } };
        } else {
            const issue = requireExisting(workspace.issues, change.id, "Issue");
            if (change.action === "update") {
                const updated = updateIssue(workspace, issue, change.input, now);
                snapshot = {
                    ...snapshot,
                    issues: snapshot.issues.map((candidate) => candidate.id === issue.id ? updated : candidate),
                };
                receipt = { action: "updated", resource: { kind: "issue", id: issue.id } };
            } else {
                snapshot = {
                    ...snapshot,
                    issues: snapshot.issues
                        .filter((candidate) => candidate.id !== issue.id)
                        .map((candidate) => candidate.parentId === issue.id
                            ? { ...candidate, parentId: null }
                            : candidate),
                };
                receipt = { action: "archived", resource: { kind: "issue", id: issue.id } };
            }
        }
    } else if (change.kind === "project") {
        if (change.action === "create") {
            const project = createProject(workspace, change.input, now);
            snapshot = { ...snapshot, projects: [project, ...snapshot.projects] };
            receipt = { action: "created", resource: { kind: "project", id: project.id } };
        } else {
            const project = requireExisting(workspace.projects, change.id, "Project");
            if (change.action === "update") {
                const updated = updateProject(workspace, project, change.input, now);
                snapshot = {
                    ...snapshot,
                    projects: snapshot.projects.map((candidate) => candidate.id === project.id ? updated : candidate),
                };
                receipt = { action: "updated", resource: { kind: "project", id: project.id } };
            } else {
                snapshot = {
                    ...snapshot,
                    projects: snapshot.projects.filter((candidate) => candidate.id !== project.id),
                    issues: snapshot.issues.map((issue) => issue.projectId === project.id
                        ? { ...issue, projectId: null }
                        : issue),
                };
                receipt = { action: "archived", resource: { kind: "project", id: project.id } };
            }
        }
    } else if (change.kind === "team") {
        if (change.action === "create") {
            const team = createTeam(workspace, change.input, now);
            const states = newTeamWorkflowStates.map((state, index) => ({
                id: `${team.id}-${index}`,
                name: state.name,
                type: state.type,
                color: state.color,
                position: index,
                teamId: team.id,
            }));
            snapshot = {
                ...snapshot,
                teams: [...snapshot.teams, team],
                workflowStates: [...snapshot.workflowStates, ...states],
            };
            receipt = { action: "created", resource: { kind: "team", id: team.id } };
        } else {
            const team = requireExisting(workspace.teams, change.id, "Team");
            if (change.action === "update") {
                const updated = updateTeam(workspace, team, change.input, now);
                snapshot = {
                    ...snapshot,
                    teams: snapshot.teams.map((candidate) => candidate.id === team.id ? updated : candidate),
                };
                receipt = { action: "updated", resource: { kind: "team", id: team.id } };
            } else {
                const archivedIssueIds = new Set(snapshot.issues
                    .filter((issue) => issue.teamId === team.id)
                    .map((issue) => issue.id));
                snapshot = {
                    ...snapshot,
                    teams: snapshot.teams.filter((candidate) => candidate.id !== team.id),
                    issues: snapshot.issues
                        .filter((issue) => issue.teamId !== team.id)
                        .map((issue) => issue.parentId !== undefined
                            && issue.parentId !== null
                            && archivedIssueIds.has(issue.parentId)
                            ? { ...issue, parentId: null }
                            : issue),
                    workflowStates: snapshot.workflowStates.filter((state) => state.teamId !== team.id),
                    projects: snapshot.projects.map((project) => ({
                        ...project,
                        teamIds: project.teamIds.filter((teamId) => teamId !== team.id),
                    })),
                };
                receipt = { action: "archived", resource: { kind: "team", id: team.id } };
            }
        }
    } else if (change.action === "create") {
        requireNonBlank(change.input.name, "Custom view name");
        assertCustomViewFilters(change.input.filterData, change.input.projectFilterData, workspace);
        const id = randomUUID();
        const customView: CustomView = {
            kind: "customView",
            id,
            name: change.input.name,
            description: change.input.description,
            shared: change.input.shared ?? false,
            filterData: change.input.filterData,
            projectFilterData: change.input.projectFilterData,
            createdAt: now,
            updatedAt: now,
            creatorId: workspace.viewer.id,
            ownerId: workspace.viewer.id,
            issueIds: [],
        };
        snapshot = { ...snapshot, customViews: [...snapshot.customViews, customView] };
        receipt = { action: "created", resource: { kind: "customView", id } };
    } else {
        const customView = requireExisting(workspace.customViews, change.id, "Custom view");
        if (change.action === "update") {
            if (change.input.name !== undefined) {
                requireNonBlank(change.input.name, "Custom view name");
            }
            const filterData = change.input.filterData === undefined ? customView.filterData : change.input.filterData;
            const projectFilterData = change.input.projectFilterData === undefined
                ? customView.projectFilterData
                : change.input.projectFilterData;
            assertCustomViewFilters(filterData, projectFilterData, workspace);
            const updated: CustomView = {
                kind: "customView",
                id: customView.id,
                name: change.input.name ?? customView.name,
                description: change.input.description ?? customView.description,
                shared: change.input.shared ?? customView.shared,
                filterData,
                projectFilterData,
                createdAt: customView.createdAt,
                updatedAt: now,
                creatorId: customView.creatorId,
                ownerId: customView.ownerId,
                issueIds: customView.issueIds,
            };
            snapshot = {
                ...snapshot,
                customViews: snapshot.customViews.map((candidate) => candidate.id === customView.id ? updated : candidate),
            };
            receipt = { action: "updated", resource: { kind: "customView", id: customView.id } };
        } else {
            snapshot = {
                ...snapshot,
                customViews: snapshot.customViews.filter((candidate) => candidate.id !== customView.id),
            };
            receipt = { action: "deleted", resource: { kind: "customView", id: customView.id } };
        }
    }

    snapshot = refreshCustomViewMembership({ ...snapshot, fetchedAt: now });
    return {
        state: { snapshot, issueNumberHighWatermarks },
        receipt,
    };
}