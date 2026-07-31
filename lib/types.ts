export type ResourceKind = "issues" | "projects" | "teams" | "customViews";

export type ViewMode = "list" | "board";

export type FocusPanel = "navigation" | "content" | "detail";

export interface Organization {
    id: string;
    name: string;
    urlKey: string;
}

export interface LinearViewer {
    id: string;
    name: string;
    displayName: string;
    email?: string;
    organization: Organization;
}

export interface LinearUser {
    id: string;
    name: string;
    displayName: string;
    email?: string;
    avatarUrl?: string;
    active?: boolean;
}

export interface TeamReference {
    id: string;
    name: string;
    key: string;
}

export interface Team extends TeamReference {
    description?: string;
    color?: string;
    icon?: string;
    private?: boolean;
    visibility?: string;
    createdAt?: string;
    updatedAt?: string;
}

export interface WorkflowState {
    id: string;
    name: string;
    type: "backlog" | "unstarted" | "started" | "completed" | "canceled" | string;
    color: string;
    position?: number;
    team?: TeamReference;
}

export interface IssueLabel {
    id: string;
    name: string;
    description?: string;
    color: string;
    parent?: {
        id: string;
        name: string;
    } | null;
}

export interface ProjectStatus {
    id: string;
    name: string;
    type: string;
    color: string;
}

export interface ProjectReference {
    id: string;
    name: string;
    color?: string;
}

export interface Project extends ProjectReference {
    description?: string;
    summary?: string;
    icon?: string;
    state?: string;
    status?: ProjectStatus | null;
    progress?: number;
    startDate?: string | null;
    targetDate?: string | null;
    createdAt?: string;
    updatedAt?: string;
    url?: string;
    teams: TeamReference[];
    lead?: LinearUser | null;
}

export interface Issue {
    id: string;
    identifier: string;
    title: string;
    description?: string;
    priority: number;
    priorityLabel?: string;
    estimate?: number | null;
    dueDate?: string | null;
    createdAt?: string;
    updatedAt?: string;
    url?: string;
    state: WorkflowState;
    team: TeamReference;
    project?: ProjectReference | null;
    assignee?: LinearUser | null;
    creator?: LinearUser | null;
    labels: IssueLabel[];
    parent?: {
        id: string;
        identifier: string;
        title: string;
    } | null;
}

export interface CustomView {
    id: string;
    name: string;
    description?: string;
    shared?: boolean;
    modelName?: string;
    filterData?: Record<string, unknown> | null;
    projectFilterData?: Record<string, unknown> | null;
    createdAt?: string;
    updatedAt?: string;
    creator?: LinearUser | null;
    owner?: LinearUser | null;
    issueIds: string[];
}

export interface RateLimitInfo {
    requestLimit?: number;
    requestRemaining?: number;
    requestResetAt?: Date;
    complexity?: number;
    complexityLimit?: number;
    complexityRemaining?: number;
}

export interface WorkspaceData {
    viewer: LinearViewer;
    organization: Organization;
    teams: Team[];
    projects: Project[];
    issues: Issue[];
    workflowStates: WorkflowState[];
    users: LinearUser[];
    labels: IssueLabel[];
    projectStatuses: ProjectStatus[];
    customViews: CustomView[];
    fetchedAt: string;
    rateLimit?: RateLimitInfo;
}

export interface IssueInput {
    title: string;
    teamId: string;
    description?: string;
    stateId?: string;
    priority?: number;
    projectId?: string | null;
    assigneeId?: string | null;
    labelIds?: string[];
    dueDate?: string | null;
    estimate?: number | null;
    parentId?: string | null;
}

export type IssueUpdateInput = Partial<IssueInput>;

export interface ProjectInput {
    name: string;
    teamIds: string[];
    description?: string;
    content?: string;
    color?: string;
    icon?: string;
    statusId?: string;
    leadId?: string | null;
    startDate?: string | null;
    targetDate?: string | null;
}

export type ProjectUpdateInput = Partial<ProjectInput>;

export interface TeamInput {
    name: string;
    key: string;
    description?: string;
    color?: string;
    icon?: string;
    private?: boolean;
}

export type TeamUpdateInput = Partial<TeamInput>;

export interface CustomViewInput {
    name: string;
    description?: string;
    shared?: boolean;
    filterData?: Record<string, unknown>;
    projectFilterData?: Record<string, unknown>;
}

export type CustomViewUpdateInput = Partial<CustomViewInput>;