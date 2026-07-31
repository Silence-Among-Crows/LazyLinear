import type {
    CustomView,
    Issue,
    Project,
    ResourceKind,
    Team,
    WorkspaceData,
} from "../lib/types.js";

export type NavigationKind = ResourceKind | "myIssues" | "allIssues" | "teamIssues" | "projectIssues" | "customView";

export interface NavigationEntry {
    id: string;
    kind: NavigationKind;
    label: string;
    section: "Workspace" | "Views" | "Teams" | "Projects";
    count?: number;
    resourceId?: string;
    color?: string;
}

export type ContentResource = Issue | Project | Team | CustomView;

export type GroupBy = "status" | "priority" | "project" | "assignee" | "team";

export interface ResourceGroup {
    id: string;
    label: string;
    color: string;
    items: ContentResource[];
}

export function buildNavigation(workspace: WorkspaceData): NavigationEntry[] {
    const openIssues = workspace.issues.filter((issue) => !["completed", "canceled"].includes(issue.state.type));
    return [
        {
            id: "my-issues",
            kind: "myIssues",
            label: "My issues",
            section: "Workspace",
            count: openIssues.filter((issue) => issue.assignee?.id === workspace.viewer.id).length,
        },
        {
            id: "all-issues",
            kind: "allIssues",
            label: "All issues",
            section: "Workspace",
            count: workspace.issues.length,
        },
        {
            id: "projects",
            kind: "projects",
            label: "All projects",
            section: "Workspace",
            count: workspace.projects.length,
        },
        {
            id: "teams",
            kind: "teams",
            label: "All teams",
            section: "Workspace",
            count: workspace.teams.length,
        },
        ...workspace.customViews.map((view) => ({
            id: `view-${view.id}`,
            kind: "customView" as const,
            label: view.name,
            section: "Views" as const,
            count: view.issueIds.length,
            resourceId: view.id,
            color: view.shared ? "#65D1C7" : "#7A8791",
        })),
        ...workspace.teams.map((team) => ({
            id: `team-${team.id}`,
            kind: "teamIssues" as const,
            label: `${team.key}  ${team.name}`,
            section: "Teams" as const,
            count: workspace.issues.filter((issue) => issue.team.id === team.id).length,
            resourceId: team.id,
            color: team.color,
        })),
        ...workspace.projects.map((project) => ({
            id: `project-${project.id}`,
            kind: "projectIssues" as const,
            label: project.name,
            section: "Projects" as const,
            count: workspace.issues.filter((issue) => issue.project?.id === project.id).length,
            resourceId: project.id,
            color: project.color,
        })),
    ];
}

export function resourceKindForNavigation(entry: NavigationEntry): ResourceKind {
    if (entry.kind === "projects") {
        return "projects";
    }
    if (entry.kind === "teams") {
        return "teams";
    }
    return "issues";
}

export function contentForNavigation(workspace: WorkspaceData, entry: NavigationEntry): ContentResource[] {
    switch (entry.kind) {
        case "myIssues":
            return workspace.issues.filter((issue) => issue.assignee?.id === workspace.viewer.id
                && !["completed", "canceled"].includes(issue.state.type));
        case "allIssues":
            return workspace.issues;
        case "teamIssues":
            return workspace.issues.filter((issue) => issue.team.id === entry.resourceId);
        case "projectIssues":
            return workspace.issues.filter((issue) => issue.project?.id === entry.resourceId);
        case "customView": {
            const view = workspace.customViews.find((candidate) => candidate.id === entry.resourceId);
            const issueIds = new Set(view?.issueIds ?? []);
            return workspace.issues.filter((issue) => issueIds.has(issue.id));
        }
        case "projects":
            return workspace.projects;
        case "teams":
            return workspace.teams;
        case "issues":
        case "customViews":
            return workspace.issues;
    }
}

function searchText(resource: ContentResource): string {
    if ("identifier" in resource) {
        return `${resource.identifier} ${resource.title} ${resource.description ?? ""} ${resource.state.name} ${resource.team.name} ${resource.project?.name ?? ""} ${resource.assignee?.name ?? ""} ${resource.labels.map((label) => label.name).join(" ")}`;
    }
    if ("key" in resource) {
        return `${resource.key} ${resource.name} ${resource.description ?? ""}`;
    }
    if ("teamIds" in resource) {
        return resource.name;
    }
    return `${resource.name} ${resource.description ?? ""}`;
}

export function filterResources(resources: ContentResource[], query: string): ContentResource[] {
    const terms = query.trim().toLocaleLowerCase().split(/\s+/u).filter(Boolean);
    if (terms.length === 0) {
        return resources;
    }

    return resources.filter((resource) => {
        const candidate = searchText(resource).toLocaleLowerCase();
        return terms.every((term) => candidate.includes(term));
    });
}

export function isIssue(resource: ContentResource | undefined): resource is Issue {
    return resource !== undefined && "identifier" in resource;
}

export function isTeam(resource: ContentResource | undefined): resource is Team {
    return resource !== undefined && "key" in resource && !("identifier" in resource);
}

export function isCustomView(resource: ContentResource | undefined): resource is CustomView {
    return resource !== undefined && "issueIds" in resource;
}

export function isProject(resource: ContentResource | undefined): resource is Project {
    return resource !== undefined && !isIssue(resource) && !isTeam(resource) && !isCustomView(resource);
}

const priorityGroups = [
    { id: "1", label: "Urgent", color: "#E06C75" },
    { id: "2", label: "High", color: "#E89B62" },
    { id: "3", label: "Medium", color: "#E9C46A" },
    { id: "4", label: "Low", color: "#6EA6D9" },
    { id: "0", label: "No priority", color: "#6B7480" },
];

export function groupResources(resources: ContentResource[], groupBy: GroupBy): ResourceGroup[] {
    if (resources.length === 0) {
        return [];
    }

    if (!resources.some((resource) => isIssue(resource))) {
        if (resources.some((resource) => isProject(resource))) {
            const order = ["backlog", "planned", "started", "paused", "completed", "canceled"];
            const projectGroups = new Map<string, ResourceGroup>();
            for (const resource of resources) {
                if (!isProject(resource)) {
                    continue;
                }
                const id = resource.status?.id ?? resource.state ?? "planned";
                const existing = projectGroups.get(id);
                if (existing) {
                    existing.items.push(resource);
                } else {
                    projectGroups.set(id, {
                        id,
                        label: resource.status?.name ?? titleCase(resource.state ?? "planned"),
                        color: resource.status?.color ?? projectStateColor(resource.state ?? "planned"),
                        items: [resource],
                    });
                }
            }
            return [...projectGroups.values()].sort((left, right) => {
                const leftProject = left.items.find(isProject);
                const rightProject = right.items.find(isProject);
                const leftIndex = order.indexOf(leftProject?.status?.type ?? leftProject?.state ?? "planned");
                const rightIndex = order.indexOf(rightProject?.status?.type ?? rightProject?.state ?? "planned");
                return (leftIndex < 0 ? order.length : leftIndex) - (rightIndex < 0 ? order.length : rightIndex);
            });
        }
        return [{ id: "teams", label: "Teams", color: "#65D1C7", items: resources }];
    }

    const issues = resources.filter(isIssue);
    if (groupBy === "priority") {
        return priorityGroups.map((group) => ({
            ...group,
            items: issues.filter((issue) => String(issue.priority) === group.id),
        })).filter((group) => group.items.length > 0);
    }

    const keyed = new Map<string, ResourceGroup>();
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
    if (groupBy === "status") {
        return groups.sort((left, right) => {
            const leftIssue = left.items.find(isIssue);
            const rightIssue = right.items.find(isIssue);
            const typeOrder = ["backlog", "unstarted", "started", "completed", "canceled"];
            const leftIndex = typeOrder.indexOf(leftIssue?.state.type ?? "backlog");
            const rightIndex = typeOrder.indexOf(rightIssue?.state.type ?? "backlog");
            const typeDifference = (leftIndex < 0 ? typeOrder.length : leftIndex)
                - (rightIndex < 0 ? typeOrder.length : rightIndex);
            return typeDifference !== 0
                ? typeDifference
                : (leftIssue?.state.position ?? 0) - (rightIssue?.state.position ?? 0);
        });
    }
    return groups.sort((left, right) => left.label.localeCompare(right.label));
}

function groupDescriptor(issue: Issue, groupBy: GroupBy): Omit<ResourceGroup, "items"> {
    switch (groupBy) {
        case "status":
            return {
                id: `${issue.state.type}:${issue.state.name.toLocaleLowerCase()}`,
                label: issue.state.name,
                color: issue.state.color,
            };
        case "project":
            return { id: issue.project?.id ?? "none", label: issue.project?.name ?? "No project", color: issue.project?.color ?? "#6B7480" };
        case "assignee":
            return { id: issue.assignee?.id ?? "none", label: issue.assignee?.displayName ?? "Unassigned", color: "#AD8EE6" };
        case "team":
            return { id: issue.team.id, label: issue.team.name, color: "#65D1C7" };
        case "priority":
            return { id: String(issue.priority), label: issue.priorityLabel ?? "No priority", color: "#E9C46A" };
    }
}

export function titleCase(value: string): string {
    return value.replace(/[_-]+/gu, " ").replace(/\b\w/gu, (character) => character.toUpperCase());
}

export function priorityGlyph(priority: number): string {
    if (priority === 1) {
        return "!!!";
    }
    if (priority === 2) {
        return "!! ";
    }
    if (priority === 3) {
        return "!  ";
    }
    if (priority === 4) {
        return "·  ";
    }
    return "—  ";
}

export function priorityColor(priority: number): string {
    return priorityGroups.find((group) => group.id === String(priority))?.color ?? "#6B7480";
}

export function projectStateColor(state: string): string {
    const colors: Record<string, string> = {
        backlog: "#6B7480",
        planned: "#6EA6D9",
        started: "#E9C46A",
        paused: "#AD8EE6",
        completed: "#8CCF7E",
        canceled: "#6B7480",
    };
    return colors[state] ?? "#6B7480";
}

export function clampIndex(index: number, length: number): number {
    if (length === 0) {
        return 0;
    }
    return Math.max(0, Math.min(index, length - 1));
}