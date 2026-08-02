import { ISSUE_PRIORITIES } from "../lib/priorities.js";
import type {
    CustomView,
    Issue,
    IssueLabel,
    Project,
    ProjectStatus,
    ResourceKind,
    Team,
    WorkflowState,
    WorkspaceSave,
    WorkspaceSnapshot,
    WorkspaceUser,
} from "../lib/types.js";

export type NavigationTarget =
    | { readonly kind: "myIssues" }
    | { readonly kind: "allIssues" }
    | { readonly kind: "projects" }
    | { readonly kind: "teams" }
    | { readonly kind: "teamIssues"; readonly teamId: string }
    | { readonly kind: "projectIssues"; readonly projectId: string }
    | { readonly kind: "customView"; readonly customViewId: string };

export interface NavigationEntry {
    readonly id: string;
    readonly target: NavigationTarget;
    readonly contentKind: Exclude<ResourceKind, "customView">;
    readonly label: string;
    readonly section: "Workspace" | "Views" | "Teams" | "Projects";
    readonly count?: number;
    readonly color?: string;
}

export interface IssueContent extends Issue {
    readonly state: WorkflowState;
    readonly team: Team;
    readonly project: Project | null;
    readonly assignee: WorkspaceUser | null;
    readonly creator: WorkspaceUser | null;
    readonly labels: readonly IssueLabel[];
    readonly priorityLabel: string;
}

export interface ProjectContent extends Project {
    readonly status: ProjectStatus | null;
    readonly teams: readonly Team[];
    readonly lead: WorkspaceUser | null;
}

export type ContentResource = IssueContent | ProjectContent | Team | CustomView;

export type GroupBy = "status" | "priority" | "project" | "assignee" | "team";

export interface ResourceGroup {
    readonly id: string;
    readonly label: string;
    readonly color: string;
    readonly items: readonly ContentResource[];
}

export type WorkspaceChangeBuildResult =
    | { readonly ok: true; readonly change: WorkspaceSave }
    | { readonly ok: false; readonly message: string };

export interface WorkspaceProjection {
    readonly navigation: NavigationEntry[];

    contentFor(entry: NavigationEntry): ContentResource[];
    resourceFor(entry: NavigationEntry): ContentResource | undefined;
}

interface IndexedIssue {
    readonly issue: Issue;
    readonly state: WorkflowState;
    readonly team: Team;
}

export function createWorkspaceProjection(workspace: WorkspaceSnapshot): WorkspaceProjection {
    const teamById = new Map(workspace.teams.map((team) => [team.id, team]));
    const projectById = new Map(workspace.projects.map((project) => [project.id, project]));
    const workflowStateById = new Map(workspace.workflowStates.map((state) => [state.id, state]));
    const userById = new Map(workspace.users.map((user) => [user.id, user]));
    const labelById = new Map(workspace.labels.map((label) => [label.id, label]));
    const projectStatusById = new Map(workspace.projectStatuses.map((status) => [status.id, status]));
    const customViewById = new Map(workspace.customViews.map((view) => [view.id, view]));
    const priorityLabelByValue = new Map(ISSUE_PRIORITIES.map((priority) => [priority.value, priority.label]));

    const indexedIssues: IndexedIssue[] = [];
    const issueCountByTeamId = new Map<string, number>();
    const issueCountByProjectId = new Map<string, number>();
    let openViewerIssueCount = 0;
    for (const issue of workspace.issues) {
        const state = workflowStateById.get(issue.stateId);
        const team = teamById.get(issue.teamId);
        if (!state || !team) {
            continue;
        }
        indexedIssues.push({ issue, state, team });
        issueCountByTeamId.set(issue.teamId, (issueCountByTeamId.get(issue.teamId) ?? 0) + 1);
        if (issue.projectId) {
            issueCountByProjectId.set(issue.projectId, (issueCountByProjectId.get(issue.projectId) ?? 0) + 1);
        }
        if (issue.assigneeId === workspace.viewer.id && !["completed", "canceled"].includes(state.type)) {
            openViewerIssueCount += 1;
        }
    }

    const projectedIssueById = new Map<string, IssueContent>();
    const projectedProjectById = new Map<string, ProjectContent>();

    function projectIssue(source: IndexedIssue): IssueContent {
        const existing = projectedIssueById.get(source.issue.id);
        if (existing) {
            return existing;
        }
        const projected: IssueContent = {
            ...source.issue,
            state: source.state,
            team: source.team,
            project: source.issue.projectId ? projectById.get(source.issue.projectId) ?? null : null,
            assignee: source.issue.assigneeId ? userById.get(source.issue.assigneeId) ?? null : null,
            creator: source.issue.creatorId ? userById.get(source.issue.creatorId) ?? null : null,
            labels: source.issue.labelIds.flatMap((labelId) => {
                const label = labelById.get(labelId);
                return label ? [label] : [];
            }),
            priorityLabel: priorityLabelByValue.get(source.issue.priority) ?? "No priority",
        };
        projectedIssueById.set(source.issue.id, projected);
        return projected;
    }

    function projectIssuesMatching(predicate: (source: IndexedIssue) => boolean): IssueContent[] {
        const projected: IssueContent[] = [];
        for (const source of indexedIssues) {
            if (predicate(source)) {
                projected.push(projectIssue(source));
            }
        }
        return projected;
    }

    function projectProject(project: Project): ProjectContent {
        const existing = projectedProjectById.get(project.id);
        if (existing) {
            return existing;
        }
        const projected: ProjectContent = {
            ...project,
            status: project.statusId ? projectStatusById.get(project.statusId) ?? null : null,
            teams: project.teamIds.flatMap((teamId) => {
                const team = teamById.get(teamId);
                return team ? [team] : [];
            }),
            lead: project.leadId ? userById.get(project.leadId) ?? null : null,
        };
        projectedProjectById.set(project.id, projected);
        return projected;
    }

    const navigation: NavigationEntry[] = [
        {
            id: "my-issues",
            target: { kind: "myIssues" },
            contentKind: "issue",
            label: "My issues",
            section: "Workspace",
            count: openViewerIssueCount,
        },
        {
            id: "all-issues",
            target: { kind: "allIssues" },
            contentKind: "issue",
            label: "All issues",
            section: "Workspace",
            count: indexedIssues.length,
        },
        {
            id: "projects",
            target: { kind: "projects" },
            contentKind: "project",
            label: "All projects",
            section: "Workspace",
            count: workspace.projects.length,
        },
        {
            id: "teams",
            target: { kind: "teams" },
            contentKind: "team",
            label: "All teams",
            section: "Workspace",
            count: workspace.teams.length,
        },
        ...workspace.customViews.map((view): NavigationEntry => ({
            id: `view-${view.id}`,
            target: { kind: "customView", customViewId: view.id },
            contentKind: "issue",
            label: view.name,
            section: "Views",
            count: view.issueIds.length,
            color: view.shared ? "#65D1C7" : "#7A8791",
        })),
        ...workspace.teams.map((team): NavigationEntry => ({
            id: `team-${team.id}`,
            target: { kind: "teamIssues", teamId: team.id },
            contentKind: "issue",
            label: `${team.key}  ${team.name}`,
            section: "Teams",
            count: issueCountByTeamId.get(team.id) ?? 0,
            color: team.color,
        })),
        ...workspace.projects.map((project): NavigationEntry => ({
            id: `project-${project.id}`,
            target: { kind: "projectIssues", projectId: project.id },
            contentKind: "issue",
            label: project.name,
            section: "Projects",
            count: issueCountByProjectId.get(project.id) ?? 0,
            color: project.color,
        })),
    ];

    return {
        navigation,
        contentFor(entry): ContentResource[] {
            const target = entry.target;
            switch (target.kind) {
                case "myIssues":
                    return projectIssuesMatching((source) => source.issue.assigneeId === workspace.viewer.id
                        && !["completed", "canceled"].includes(source.state.type));
                case "allIssues":
                    return projectIssuesMatching(() => true);
                case "teamIssues":
                    return projectIssuesMatching((source) => source.issue.teamId === target.teamId);
                case "projectIssues":
                    return projectIssuesMatching((source) => source.issue.projectId === target.projectId);
                case "customView": {
                    const issueIds = new Set(customViewById.get(target.customViewId)?.issueIds ?? []);
                    return projectIssuesMatching((source) => issueIds.has(source.issue.id));
                }
                case "projects":
                    return workspace.projects.map(projectProject);
                case "teams":
                    return [...workspace.teams];
            }
        },
        resourceFor(entry): ContentResource | undefined {
            const target = entry.target;
            if (target.kind === "customView") {
                return customViewById.get(target.customViewId);
            }
            if (target.kind === "teamIssues") {
                return teamById.get(target.teamId);
            }
            if (target.kind === "projectIssues") {
                const project = projectById.get(target.projectId);
                return project ? projectProject(project) : undefined;
            }
            return undefined;
        },
    };
}

function searchText(resource: ContentResource): string {
    if (resource.kind === "issue") {
        return `${resource.identifier} ${resource.title} ${resource.description ?? ""} ${resource.state.name} ${resource.team.name} ${resource.project?.name ?? ""} ${resource.assignee?.name ?? ""} ${resource.labels.map((label) => label.name).join(" ")}`;
    }
    if (resource.kind === "team") {
        return `${resource.key} ${resource.name} ${resource.description ?? ""}`;
    }
    return `${resource.name} ${resource.description ?? ""}`;
}

export function filterResources(resources: readonly ContentResource[], query: string): ContentResource[] {
    const terms = query.trim().toLocaleLowerCase().split(/\s+/u).filter(Boolean);
    if (terms.length === 0) {
        return [...resources];
    }
    return resources.filter((resource) => {
        const candidate = searchText(resource).toLocaleLowerCase();
        return terms.every((term) => candidate.includes(term));
    });
}

export function isIssue(resource: ContentResource | undefined): resource is IssueContent {
    return resource?.kind === "issue";
}

export function isTeam(resource: ContentResource | undefined): resource is Team {
    return resource?.kind === "team";
}

export function isCustomView(resource: ContentResource | undefined): resource is CustomView {
    return resource?.kind === "customView";
}

export function isProject(resource: ContentResource | undefined): resource is ProjectContent {
    return resource?.kind === "project";
}

export function groupResources(resources: readonly ContentResource[], groupBy: GroupBy): ResourceGroup[] {
    if (resources.length === 0) {
        return [];
    }
    if (!resources.some(isIssue)) {
        if (resources.some(isProject)) {
            const order = ["backlog", "planned", "started", "paused", "completed", "canceled"];
            const projectGroups = new Map<string, { id: string; label: string; color: string; items: ContentResource[] }>();
            for (const resource of resources) {
                if (!isProject(resource)) {
                    continue;
                }
                const id = resource.status?.id ?? "planned";
                const existing = projectGroups.get(id);
                if (existing) {
                    existing.items.push(resource);
                } else {
                    projectGroups.set(id, {
                        id,
                        label: resource.status?.name ?? "Planned",
                        color: resource.status?.color ?? projectStateColor(resource.status?.type ?? "planned"),
                        items: [resource],
                    });
                }
            }
            return [...projectGroups.values()].sort((left, right) => {
                const leftProject = left.items.find(isProject);
                const rightProject = right.items.find(isProject);
                const leftIndex = order.indexOf(leftProject?.status?.type ?? "planned");
                const rightIndex = order.indexOf(rightProject?.status?.type ?? "planned");
                return (leftIndex < 0 ? order.length : leftIndex) - (rightIndex < 0 ? order.length : rightIndex);
            });
        }
        return [{ id: "teams", label: "Teams", color: "#65D1C7", items: [...resources] }];
    }

    const issues = resources.filter(isIssue);
    if (groupBy === "priority") {
        return ISSUE_PRIORITIES.map((priority) => ({
            id: String(priority.value),
            label: priority.label,
            color: priority.color,
            items: issues.filter((issue) => issue.priority === priority.value),
        })).filter((group) => group.items.length > 0);
    }

    const keyed = new Map<string, { id: string; label: string; color: string; items: ContentResource[] }>();
    for (const issue of issues) {
        const descriptor = groupDescriptor(issue, groupBy);
        const existing = keyed.get(descriptor.id);
        if (existing) {
            existing.items.push(issue);
        } else {
            keyed.set(descriptor.id, { ...descriptor, items: [issue] });
        }
    }
    const groups = [...keyed.values()];
    if (groupBy !== "status") {
        return groups.sort((left, right) => left.label.localeCompare(right.label));
    }
    const typeOrder = ["backlog", "unstarted", "started", "completed", "canceled"];
    return groups.sort((left, right) => {
        const leftState = left.items.find(isIssue)?.state;
        const rightState = right.items.find(isIssue)?.state;
        const leftType = leftState?.type ?? "backlog";
        const rightType = rightState?.type ?? "backlog";
        const leftIndex = typeOrder.indexOf(leftType);
        const rightIndex = typeOrder.indexOf(rightType);
        const typeDifference = (leftIndex < 0 ? typeOrder.length : leftIndex)
            - (rightIndex < 0 ? typeOrder.length : rightIndex);
        return typeDifference !== 0
            ? typeDifference
            : (leftState?.position ?? 0) - (rightState?.position ?? 0);
    });
}

function groupDescriptor(issue: IssueContent, groupBy: Exclude<GroupBy, "priority">): Omit<ResourceGroup, "items"> {
    if (groupBy === "status") {
        return {
            id: `${issue.state.type}:${issue.state.name.toLocaleLowerCase()}`,
            label: issue.state.name,
            color: issue.state.color,
        };
    }
    if (groupBy === "project") {
        return issue.project
            ? { id: issue.project.id, label: issue.project.name, color: issue.project.color ?? "#5E6AD2" }
            : { id: "none", label: "No project", color: "#6B7480" };
    }
    if (groupBy === "assignee") {
        return issue.assignee
            ? { id: issue.assignee.id, label: issue.assignee.displayName, color: "#65D1C7" }
            : { id: "none", label: "Unassigned", color: "#6B7480" };
    }
    return { id: issue.team.id, label: issue.team.name, color: issue.team.color ?? "#65D1C7" };
}

export function buildAdvanceIssueChange(workspace: WorkspaceSnapshot, issue: IssueContent): WorkspaceChangeBuildResult {
    const states = workspace.workflowStates
        .filter((state) => state.teamId === issue.teamId && state.type !== "canceled")
        .sort((left, right) => (left.position ?? 0) - (right.position ?? 0));
    const currentIndex = states.findIndex((state) => state.id === issue.stateId);
    if (issue.state.type === "canceled" || currentIndex < 0) {
        return { ok: false, message: "a canceled issue cannot be advanced; choose a status explicitly with edit or board move" };
    }
    const nextState = states[Math.min(currentIndex + 1, states.length - 1)];
    if (!nextState || nextState.id === issue.stateId) {
        return { ok: false, message: "issue is already in its final workflow state" };
    }
    return {
        ok: true,
        change: { kind: "issue", action: "update", id: issue.id, input: { stateId: nextState.id } },
    };
}

export function buildMoveAcrossGroupChange(
    workspace: WorkspaceSnapshot,
    resource: ContentResource,
    groupBy: GroupBy,
    targetGroup: ResourceGroup,
): WorkspaceChangeBuildResult {
    if (resource.kind === "project") {
        return {
            ok: true,
            change: { kind: "project", action: "update", id: resource.id, input: { statusId: targetGroup.id } },
        };
    }
    if (resource.kind !== "issue") {
        return { ok: false, message: "only issues and projects can move across board groups" };
    }
    if (groupBy === "status") {
        const targetExample = targetGroup.items.find(isIssue);
        const targetState = targetExample
            ? workspace.workflowStates.find((state) => state.teamId === resource.teamId
                && state.type === targetExample.state.type
                && state.name.toLocaleLowerCase() === targetExample.state.name.toLocaleLowerCase())
            : undefined;
        return targetState
            ? { ok: true, change: { kind: "issue", action: "update", id: resource.id, input: { stateId: targetState.id } } }
            : { ok: false, message: `the ${resource.team.key} workflow has no state matching ${targetGroup.label}` };
    }
    if (groupBy === "priority") {
        const priority = Number(targetGroup.id);
        return ISSUE_PRIORITIES.some((candidate) => candidate.value === priority)
            ? { ok: true, change: { kind: "issue", action: "update", id: resource.id, input: { priority: priority as Issue["priority"] } } }
            : { ok: false, message: "the target priority is invalid" };
    }
    if (groupBy === "project") {
        return { ok: true, change: { kind: "issue", action: "update", id: resource.id, input: { projectId: targetGroup.id === "none" ? null : targetGroup.id } } };
    }
    if (groupBy === "assignee") {
        return { ok: true, change: { kind: "issue", action: "update", id: resource.id, input: { assigneeId: targetGroup.id === "none" ? null : targetGroup.id } } };
    }
    const targetState = workspace.workflowStates.find((state) => state.teamId === targetGroup.id
        && state.type === resource.state.type
        && state.name.toLocaleLowerCase() === resource.state.name.toLocaleLowerCase())
        ?? workspace.workflowStates.find((state) => state.teamId === targetGroup.id && state.type === resource.state.type)
        ?? workspace.workflowStates.find((state) => state.teamId === targetGroup.id && state.type === "unstarted")
        ?? workspace.workflowStates.find((state) => state.teamId === targetGroup.id);
    return targetState
        ? { ok: true, change: { kind: "issue", action: "update", id: resource.id, input: { teamId: targetGroup.id, stateId: targetState.id } } }
        : { ok: false, message: "the target team has no workflow state" };
}

export function titleCase(value: string): string {
    return value.replace(/(^|[-_\s]+)(\p{L})/gu, (_match, separator: string, letter: string) => `${separator ? " " : ""}${letter.toLocaleUpperCase()}`);
}

export function projectStateColor(state: string): string {
    if (["completed", "finished"].includes(state)) {
        return "#65D1C7";
    }
    if (["started", "in_progress"].includes(state)) {
        return "#5E6AD2";
    }
    if (["paused", "canceled"].includes(state)) {
        return "#E06C75";
    }
    return "#E9C46A";
}

export function clampIndex(index: number, length: number): number {
    return length === 0 ? 0 : Math.max(0, Math.min(index, length - 1));
}