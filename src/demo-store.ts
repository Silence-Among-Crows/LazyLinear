import { randomUUID } from "node:crypto";
import type {
    CustomViewInput,
    CustomViewUpdateInput,
    Issue,
    IssueInput,
    IssueUpdateInput,
    ProjectInput,
    ProjectUpdateInput,
    TeamInput,
    TeamUpdateInput,
    WorkspaceData,
} from "../lib/types.js";

export type DemoMutation =
    | { kind: "issue"; action: "create"; input: IssueInput }
    | { kind: "issue"; action: "update"; id: string; input: IssueUpdateInput }
    | { kind: "issue"; action: "archive"; id: string }
    | { kind: "project"; action: "create"; input: ProjectInput }
    | { kind: "project"; action: "update"; id: string; input: ProjectUpdateInput }
    | { kind: "project"; action: "archive"; id: string }
    | { kind: "team"; action: "create"; input: TeamInput }
    | { kind: "team"; action: "update"; id: string; input: TeamUpdateInput }
    | { kind: "team"; action: "archive"; id: string }
    | { kind: "customView"; action: "create"; input: CustomViewInput }
    | { kind: "customView"; action: "update"; id: string; input: CustomViewUpdateInput }
    | { kind: "customView"; action: "archive"; id: string };

function nextIssueIdentifier(workspace: WorkspaceData, teamId: string): string {
    const team = workspace.teams.find((candidate) => candidate.id === teamId);
    if (!team) {
        throw new Error("The selected team no longer exists.");
    }

    const highest = workspace.issues
        .filter((issue) => issue.team.id === teamId)
        .map((issue) => Number(issue.identifier.split("-").at(-1)))
        .filter(Number.isFinite)
        .reduce((maximum, value) => Math.max(maximum, value), 0);
    return `${team.key}-${highest + 1}`;
}

function createIssue(workspace: WorkspaceData, input: IssueInput): Issue {
    const team = workspace.teams.find((candidate) => candidate.id === input.teamId);
    if (!team) {
        throw new Error("A valid team is required to create an issue.");
    }

    const state = workspace.workflowStates.find((candidate) => candidate.id === input.stateId)
        ?? workspace.workflowStates.find((candidate) => candidate.team?.id === team.id && candidate.type === "unstarted")
        ?? workspace.workflowStates.find((candidate) => candidate.team?.id === team.id);
    if (!state) {
        throw new Error("The selected team has no workflow state available.");
    }

    const priority = input.priority ?? 0;
    return {
        id: randomUUID(),
        identifier: nextIssueIdentifier(workspace, team.id),
        title: input.title,
        description: input.description ?? "",
        priority,
        priorityLabel: ["No priority", "Urgent", "High", "Medium", "Low"][priority],
        estimate: input.estimate ?? null,
        dueDate: input.dueDate ?? null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        url: `https://linear.app/${workspace.organization.urlKey}/issue/new-demo-issue`,
        state,
        team,
        project: workspace.projects.find((candidate) => candidate.id === input.projectId) ?? null,
        assignee: workspace.users.find((candidate) => candidate.id === input.assigneeId) ?? null,
        creator: workspace.viewer,
        labels: workspace.labels.filter((label) => input.labelIds?.includes(label.id)),
        parent: input.parentId === undefined || input.parentId === null
            ? null
            : workspace.issues.find((candidate) => candidate.id === input.parentId) ?? null,
    };
}

function updateIssue(workspace: WorkspaceData, issue: Issue, input: IssueUpdateInput): Issue {
    const team = input.teamId === undefined
        ? issue.team
        : workspace.teams.find((candidate) => candidate.id === input.teamId) ?? issue.team;
    const state = input.stateId === undefined
        ? issue.state
        : workspace.workflowStates.find((candidate) => candidate.id === input.stateId) ?? issue.state;
    const priority = input.priority ?? issue.priority;
    return {
        ...issue,
        ...input,
        team,
        state,
        priority,
        priorityLabel: ["No priority", "Urgent", "High", "Medium", "Low"][priority],
        project: input.projectId === undefined
            ? issue.project
            : workspace.projects.find((candidate) => candidate.id === input.projectId) ?? null,
        assignee: input.assigneeId === undefined
            ? issue.assignee
            : workspace.users.find((candidate) => candidate.id === input.assigneeId) ?? null,
        labels: input.labelIds === undefined
            ? issue.labels
            : workspace.labels.filter((label) => input.labelIds?.includes(label.id)),
        dueDate: input.dueDate === undefined ? issue.dueDate : input.dueDate,
        estimate: input.estimate === undefined ? issue.estimate : input.estimate,
        updatedAt: new Date().toISOString(),
    };
}

function comparatorMatches(value: unknown, comparator: unknown): boolean {
    if (typeof comparator !== "object" || comparator === null) {
        return true;
    }
    const candidate = comparator as Record<string, unknown>;
    if ("eq" in candidate) {
        return value === candidate.eq;
    }
    if ("neq" in candidate) {
        return value !== candidate.neq;
    }
    if (Array.isArray(candidate.in)) {
        return candidate.in.includes(value);
    }
    if (Array.isArray(candidate.nin)) {
        return !candidate.nin.includes(value);
    }
    return true;
}

function filterMatchesIssue(issue: Issue, rawFilter: unknown): boolean {
    if (typeof rawFilter !== "object" || rawFilter === null) {
        return true;
    }
    const filter = rawFilter as Record<string, unknown>;
    if (Array.isArray(filter.and) && !filter.and.every((part) => filterMatchesIssue(issue, part))) {
        return false;
    }
    if (Array.isArray(filter.or) && !filter.or.some((part) => filterMatchesIssue(issue, part))) {
        return false;
    }
    if (filter.priority !== undefined && !comparatorMatches(issue.priority, filter.priority)) {
        return false;
    }
    if (typeof filter.state === "object" && filter.state !== null) {
        const state = filter.state as Record<string, unknown>;
        if (state.id !== undefined && !comparatorMatches(issue.state.id, state.id)) {
            return false;
        }
        if (state.name !== undefined && !comparatorMatches(issue.state.name, state.name)) {
            return false;
        }
        if (state.type !== undefined && !comparatorMatches(issue.state.type, state.type)) {
            return false;
        }
    }
    if (typeof filter.team === "object" && filter.team !== null) {
        const team = filter.team as Record<string, unknown>;
        if (team.id !== undefined && !comparatorMatches(issue.team.id, team.id)) {
            return false;
        }
    }
    if (typeof filter.project === "object" && filter.project !== null) {
        const project = filter.project as Record<string, unknown>;
        if (project.id !== undefined && !comparatorMatches(issue.project?.id ?? null, project.id)) {
            return false;
        }
    }
    if (typeof filter.assignee === "object" && filter.assignee !== null) {
        const assignee = filter.assignee as Record<string, unknown>;
        if (assignee.id !== undefined && !comparatorMatches(issue.assignee?.id ?? null, assignee.id)) {
            return false;
        }
    }
    if (typeof filter.labels === "object" && filter.labels !== null) {
        const labelFilter = filter.labels as Record<string, unknown>;
        const some = labelFilter.some as Record<string, unknown> | undefined;
        if (some?.id !== undefined && !issue.labels.some((label) => comparatorMatches(label.id, some.id))) {
            return false;
        }
        if (some?.name !== undefined && !issue.labels.some((label) => comparatorMatches(label.name, some.name))) {
            return false;
        }
    }
    return true;
}

function refreshCustomViewMembership(workspace: WorkspaceData): void {
    for (const view of workspace.customViews) {
        view.issueIds = workspace.issues
            .filter((issue) => filterMatchesIssue(issue, view.filterData))
            .map((issue) => issue.id);
    }
}

export function applyDemoMutation(current: WorkspaceData, mutation: DemoMutation): WorkspaceData {
    const workspace = structuredClone(current);
    if (mutation.kind === "issue") {
        if (mutation.action === "create") {
            workspace.issues.unshift(createIssue(workspace, mutation.input));
        } else if (mutation.action === "update") {
            workspace.issues = workspace.issues.map((issue) => issue.id === mutation.id
                ? updateIssue(workspace, issue, mutation.input)
                : issue);
        } else {
            workspace.issues = workspace.issues.filter((issue) => issue.id !== mutation.id);
        }
    }

    if (mutation.kind === "project") {
        if (mutation.action === "create") {
            workspace.projects.unshift({
                id: randomUUID(),
                name: mutation.input.name,
                summary: mutation.input.description,
                description: mutation.input.content ?? mutation.input.description,
                color: mutation.input.color ?? "#5E6AD2",
                icon: mutation.input.icon,
                state: workspace.projectStatuses.find((status) => status.id === mutation.input.statusId)?.type ?? "planned",
                status: workspace.projectStatuses.find((status) => status.id === mutation.input.statusId) ?? workspace.projectStatuses[0] ?? null,
                progress: 0,
                startDate: mutation.input.startDate,
                targetDate: mutation.input.targetDate,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                teams: workspace.teams.filter((team) => mutation.input.teamIds.includes(team.id)),
                lead: workspace.users.find((user) => user.id === mutation.input.leadId) ?? null,
            });
        } else if (mutation.action === "update") {
            workspace.projects = workspace.projects.map((project) => project.id === mutation.id ? {
                ...project,
                ...mutation.input,
                summary: mutation.input.description ?? project.summary,
                description: mutation.input.content ?? project.description,
                status: mutation.input.statusId === undefined
                    ? project.status
                    : workspace.projectStatuses.find((status) => status.id === mutation.input.statusId) ?? project.status,
                state: mutation.input.statusId === undefined
                    ? project.state
                    : workspace.projectStatuses.find((status) => status.id === mutation.input.statusId)?.type ?? project.state,
                teams: mutation.input.teamIds === undefined
                    ? project.teams
                    : workspace.teams.filter((team) => mutation.input.teamIds?.includes(team.id)),
                lead: mutation.input.leadId === undefined
                    ? project.lead
                    : workspace.users.find((user) => user.id === mutation.input.leadId) ?? null,
                updatedAt: new Date().toISOString(),
            } : project);
            const updatedProject = workspace.projects.find((project) => project.id === mutation.id);
            if (updatedProject) {
                workspace.issues = workspace.issues.map((issue) => issue.project?.id === mutation.id
                    ? { ...issue, project: { id: updatedProject.id, name: updatedProject.name, color: updatedProject.color } }
                    : issue);
            }
        } else {
            workspace.projects = workspace.projects.filter((project) => project.id !== mutation.id);
            workspace.issues = workspace.issues.map((issue) => issue.project?.id === mutation.id
                ? { ...issue, project: null }
                : issue);
        }
    }

    if (mutation.kind === "team") {
        if (mutation.action === "create") {
            const id = randomUUID();
            workspace.teams.push({ id, ...mutation.input });
            const templates = [
                { name: "Backlog", type: "backlog", color: "#6B7480" },
                { name: "Todo", type: "unstarted", color: "#8B93A1" },
                { name: "In Progress", type: "started", color: "#F2C94C" },
                { name: "Done", type: "completed", color: "#4CB782" },
                { name: "Canceled", type: "canceled", color: "#8B93A1" },
            ];
            workspace.workflowStates.push(...templates.map((state, index) => ({
                id: `${id}-${index}`,
                ...state,
                position: index,
                team: { id, name: mutation.input.name, key: mutation.input.key },
            })));
        } else if (mutation.action === "update") {
            workspace.teams = workspace.teams.map((team) => team.id === mutation.id ? { ...team, ...mutation.input } : team);
            const updatedTeam = workspace.teams.find((team) => team.id === mutation.id);
            if (updatedTeam) {
                workspace.issues = workspace.issues.map((issue) => issue.team.id === mutation.id
                    ? { ...issue, team: updatedTeam }
                    : issue);
                workspace.workflowStates = workspace.workflowStates.map((state) => state.team?.id === mutation.id
                    ? { ...state, team: { id: updatedTeam.id, name: updatedTeam.name, key: updatedTeam.key } }
                    : state);
                workspace.projects = workspace.projects.map((project) => ({
                    ...project,
                    teams: project.teams.map((team) => team.id === mutation.id
                        ? { id: updatedTeam.id, name: updatedTeam.name, key: updatedTeam.key }
                        : team),
                }));
            }
        } else {
            workspace.teams = workspace.teams.filter((team) => team.id !== mutation.id);
            workspace.issues = workspace.issues.filter((issue) => issue.team.id !== mutation.id);
            workspace.workflowStates = workspace.workflowStates.filter((state) => state.team?.id !== mutation.id);
            workspace.projects = workspace.projects.map((project) => ({
                ...project,
                teams: project.teams.filter((team) => team.id !== mutation.id),
            }));
        }
    }

    if (mutation.kind === "customView") {
        if (mutation.action === "create") {
            workspace.customViews.push({
                id: randomUUID(),
                name: mutation.input.name,
                description: mutation.input.description,
                shared: mutation.input.shared,
                modelName: "Issue",
                filterData: mutation.input.filterData,
                projectFilterData: mutation.input.projectFilterData,
                creator: workspace.viewer,
                owner: workspace.viewer,
                issueIds: workspace.issues.filter((issue) => filterMatchesIssue(issue, mutation.input.filterData)).map((issue) => issue.id),
            });
        } else if (mutation.action === "update") {
            workspace.customViews = workspace.customViews.map((view) => view.id === mutation.id
                ? { ...view, ...mutation.input }
                : view);
        } else {
            workspace.customViews = workspace.customViews.filter((view) => view.id !== mutation.id);
        }
    }

    refreshCustomViewMembership(workspace);
    workspace.fetchedAt = new Date().toISOString();
    return workspace;
}