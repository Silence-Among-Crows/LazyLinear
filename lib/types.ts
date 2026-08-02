import type { IssuePriority } from "./priorities.js";

export type { IssuePriority } from "./priorities.js";

export type ResourceKind = "issue" | "project" | "team" | "customView";

export type ViewMode = "list" | "board";

export type FocusPanel = "navigation" | "content" | "detail";

export type WorkspaceEnvironment = "demo" | "linear";

export interface Organization {
    readonly id: string;
    readonly name: string;
    readonly urlKey: string;
}

export interface WorkspaceViewer {
    readonly id: string;
    readonly name: string;
    readonly displayName: string;
    readonly email?: string;
    readonly organization: Organization;
}

export interface WorkspaceUser {
    readonly id: string;
    readonly name: string;
    readonly displayName: string;
    readonly email?: string;
    readonly avatarUrl?: string;
    readonly active?: boolean;
}

export interface Team {
    readonly kind: "team";
    readonly id: string;
    readonly name: string;
    readonly key: string;
    readonly description?: string;
    readonly color?: string;
    readonly icon?: string;
    readonly visibility: "workspace" | "private";
    readonly createdAt?: string;
    readonly updatedAt?: string;
}

export interface WorkflowState {
    readonly id: string;
    readonly name: string;
    readonly type: string;
    readonly color: string;
    readonly position?: number;
    readonly teamId: string;
}

export interface IssueLabel {
    readonly id: string;
    readonly name: string;
    readonly description?: string;
    readonly color: string;
    readonly parentId?: string | null;
}

export interface ProjectStatus {
    readonly id: string;
    readonly name: string;
    readonly type: string;
    readonly color: string;
}

export interface Project {
    readonly kind: "project";
    readonly id: string;
    readonly name: string;
    readonly summary?: string;
    readonly description?: string;
    readonly color?: string;
    readonly icon?: string;
    readonly statusId?: string | null;
    readonly progress?: number;
    readonly startDate?: string | null;
    readonly targetDate?: string | null;
    readonly createdAt?: string;
    readonly updatedAt?: string;
    readonly url?: string;
    readonly teamIds: readonly string[];
    readonly leadId?: string | null;
}

export interface Issue {
    readonly kind: "issue";
    readonly id: string;
    readonly identifier: string;
    readonly title: string;
    readonly description?: string;
    readonly priority: IssuePriority;
    readonly estimate?: number | null;
    readonly dueDate?: string | null;
    readonly createdAt?: string;
    readonly updatedAt?: string;
    readonly url?: string;
    readonly stateId: string;
    readonly teamId: string;
    readonly projectId?: string | null;
    readonly assigneeId?: string | null;
    readonly creatorId?: string | null;
    readonly labelIds: readonly string[];
    readonly parentId?: string | null;
}

export interface CustomView {
    readonly kind: "customView";
    readonly id: string;
    readonly name: string;
    readonly description?: string;
    readonly shared: boolean;
    readonly filterData?: Readonly<Record<string, unknown>> | null;
    readonly projectFilterData?: Readonly<Record<string, unknown>> | null;
    readonly createdAt?: string;
    readonly updatedAt?: string;
    readonly creatorId?: string | null;
    readonly ownerId?: string | null;
    readonly issueIds: readonly string[];
}

export interface RateLimitInfo {
    readonly requestLimit?: number;
    readonly requestRemaining?: number;
    readonly requestResetAt?: string;
    readonly complexity?: number;
    readonly complexityLimit?: number;
    readonly complexityRemaining?: number;
}

export interface WorkspaceSnapshot {
    readonly viewer: WorkspaceViewer;
    readonly teams: readonly Team[];
    readonly projects: readonly Project[];
    readonly issues: readonly Issue[];
    readonly workflowStates: readonly WorkflowState[];
    readonly users: readonly WorkspaceUser[];
    readonly labels: readonly IssueLabel[];
    readonly projectStatuses: readonly ProjectStatus[];
    readonly customViews: readonly CustomView[];
    readonly fetchedAt: string;
    readonly rateLimit?: RateLimitInfo;
}

export interface IssueCreateInput {
    readonly title: string;
    readonly teamId: string;
    readonly description?: string;
    readonly stateId?: string;
    readonly priority?: IssuePriority;
    readonly projectId?: string | null;
    readonly assigneeId?: string | null;
    readonly labelIds?: readonly string[];
    readonly dueDate?: string | null;
    readonly estimate?: number | null;
    readonly parentId?: string | null;
}

export interface IssueUpdateInput {
    readonly title?: string;
    readonly teamId?: string;
    readonly description?: string;
    readonly stateId?: string;
    readonly priority?: IssuePriority;
    readonly projectId?: string | null;
    readonly assigneeId?: string | null;
    readonly labelIds?: readonly string[];
    readonly dueDate?: string | null;
    readonly estimate?: number | null;
    readonly parentId?: string | null;
}

export interface ProjectCreateInput {
    readonly name: string;
    readonly teamIds: readonly string[];
    readonly summary?: string;
    readonly description?: string;
    readonly color?: string;
    readonly icon?: string;
    readonly statusId?: string;
    readonly leadId?: string | null;
    readonly startDate?: string | null;
    readonly targetDate?: string | null;
}

export interface ProjectUpdateInput {
    readonly name?: string;
    readonly teamIds?: readonly string[];
    readonly summary?: string;
    readonly description?: string;
    readonly color?: string;
    readonly icon?: string;
    readonly statusId?: string;
    readonly leadId?: string | null;
    readonly startDate?: string | null;
    readonly targetDate?: string | null;
}

export interface TeamCreateInput {
    readonly name: string;
    readonly key: string;
    readonly description?: string;
    readonly color?: string;
    readonly icon?: string;
    readonly visibility?: "workspace" | "private";
}

export interface TeamUpdateInput {
    readonly name?: string;
    readonly key?: string;
    readonly description?: string;
    readonly color?: string;
    readonly icon?: string;
    readonly visibility?: "workspace" | "private";
}

export interface CustomViewCreateInput {
    readonly name: string;
    readonly description?: string;
    readonly shared?: boolean;
    readonly filterData?: Readonly<Record<string, unknown>> | null;
    readonly projectFilterData?: Readonly<Record<string, unknown>> | null;
}

export interface CustomViewUpdateInput {
    readonly name?: string;
    readonly description?: string;
    readonly shared?: boolean;
    readonly filterData?: Readonly<Record<string, unknown>> | null;
    readonly projectFilterData?: Readonly<Record<string, unknown>> | null;
}

export type WorkspaceSave =
    | { readonly kind: "issue"; readonly action: "create"; readonly input: IssueCreateInput }
    | { readonly kind: "issue"; readonly action: "update"; readonly id: string; readonly input: IssueUpdateInput }
    | { readonly kind: "project"; readonly action: "create"; readonly input: ProjectCreateInput }
    | { readonly kind: "project"; readonly action: "update"; readonly id: string; readonly input: ProjectUpdateInput }
    | { readonly kind: "team"; readonly action: "create"; readonly input: TeamCreateInput }
    | { readonly kind: "team"; readonly action: "update"; readonly id: string; readonly input: TeamUpdateInput }
    | { readonly kind: "customView"; readonly action: "create"; readonly input: CustomViewCreateInput }
    | { readonly kind: "customView"; readonly action: "update"; readonly id: string; readonly input: CustomViewUpdateInput };

export type WorkspaceResourceReference =
    | { readonly kind: "issue"; readonly id: string }
    | { readonly kind: "project"; readonly id: string }
    | { readonly kind: "team"; readonly id: string }
    | { readonly kind: "customView"; readonly id: string };

export type WorkspaceRemoval =
    | { readonly kind: "issue"; readonly action: "archive"; readonly id: string }
    | { readonly kind: "project"; readonly action: "archive"; readonly id: string }
    | { readonly kind: "team"; readonly action: "archive"; readonly id: string }
    | { readonly kind: "customView"; readonly action: "delete"; readonly id: string };

export type WorkspaceCommit = WorkspaceSave | WorkspaceRemoval;

export interface WorkspaceCommitReceipt {
    readonly action: "created" | "updated" | "archived" | "deleted";
    readonly resource: WorkspaceResourceReference;
}

export type WorkspaceFailureCode =
    | "authentication"
    | "permission"
    | "validation"
    | "notFound"
    | "rateLimited"
    | "unavailable"
    | "unsupported"
    | "externalContract";

export interface WorkspaceFailure {
    readonly code: WorkspaceFailureCode;
    readonly message: string;
    readonly retryable: boolean;
    readonly rateLimit?: RateLimitInfo;
}