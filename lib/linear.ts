import type { IssuePriority } from "./priorities.js";
import type {
    CustomView,
    CustomViewCreateInput,
    CustomViewUpdateInput,
    Issue,
    IssueCreateInput,
    IssueLabel,
    IssueUpdateInput,
    Organization,
    Project,
    ProjectCreateInput,
    ProjectStatus,
    ProjectUpdateInput,
    RateLimitInfo,
    Team,
    TeamCreateInput,
    TeamUpdateInput,
    WorkflowState,
    WorkspaceCommit,
    WorkspaceCommitReceipt,
    WorkspaceFailureCode,
    WorkspaceSnapshot,
    WorkspaceUser,
    WorkspaceViewer,
} from "./types.js";
import { LinearApiError } from "./linear-error.js";
import {
    LINEAR_GRAPHQL_ENDPOINT,
    LinearGraphQlTransport,
    type LinearFetch,
    type LinearGraphQlResult,
} from "./linear-graphql-transport.js";
import {
    WorkspaceAdapterError,
    type WorkspaceAdapter,
} from "../src/workspace-adapter.js";

export { LinearApiError };

const ROOT_CONNECTION_PAGE_SIZE = 100;
const ISSUE_PAGE_SIZE = 50;
const ISSUE_LABEL_PAGE_SIZE = 10;
const PROJECT_PAGE_SIZE = 100;
const PROJECT_TEAM_PAGE_SIZE = 10;
const CUSTOM_VIEW_PAGE_SIZE = 25;
const CUSTOM_VIEW_ISSUE_PAGE_SIZE = 50;

interface Connection<T> {
    readonly nodes: readonly T[];
    readonly pageInfo?: {
        readonly hasNextPage: boolean;
        readonly endCursor?: string | null;
    };
}

interface Loaded<T> {
    readonly value: T;
    readonly rateLimits: readonly RateLimitInfo[];
}

interface LinearOrganization {
    readonly id: string;
    readonly name: string;
    readonly urlKey: string;
}

interface LinearViewerDto {
    readonly id: string;
    readonly name: string;
    readonly displayName: string;
    readonly email?: string;
    readonly organization: LinearOrganization;
}

interface LinearUserDto {
    readonly id: string;
    readonly name: string;
    readonly displayName: string;
    readonly email?: string;
    readonly avatarUrl?: string;
    readonly active?: boolean;
}

interface LinearTeamReferenceDto {
    readonly id: string;
    readonly name: string;
    readonly key: string;
}

interface LinearTeamDto extends LinearTeamReferenceDto {
    readonly description?: string;
    readonly color?: string;
    readonly icon?: string;
    readonly visibility?: string;
    readonly createdAt?: string;
    readonly updatedAt?: string;
}

interface LinearWorkflowStateDto {
    readonly id: string;
    readonly name: string;
    readonly type: string;
    readonly color: string;
    readonly position?: number;
    readonly team?: LinearTeamReferenceDto | null;
}

interface LinearIssueLabelDto {
    readonly id: string;
    readonly name: string;
    readonly description?: string;
    readonly color: string;
    readonly parent?: { readonly id: string; readonly name: string } | null;
}

interface LinearProjectStatusDto {
    readonly id: string;
    readonly name: string;
    readonly type: string;
    readonly color: string;
}

interface LinearProjectReferenceDto {
    readonly id: string;
    readonly name: string;
    readonly color?: string;
}

interface LinearIssueDto {
    readonly id: string;
    readonly identifier: string;
    readonly title: string;
    readonly description?: string;
    readonly priority: number;
    readonly estimate?: number | null;
    readonly dueDate?: string | null;
    readonly createdAt?: string;
    readonly updatedAt?: string;
    readonly url?: string;
    readonly state: LinearWorkflowStateDto;
    readonly team: LinearTeamReferenceDto;
    readonly project?: LinearProjectReferenceDto | null;
    readonly assignee?: LinearUserDto | null;
    readonly creator?: LinearUserDto | null;
    readonly labels: Connection<LinearIssueLabelDto>;
    readonly parent?: {
        readonly id: string;
        readonly identifier: string;
        readonly title: string;
    } | null;
}

interface LinearProjectDto {
    readonly id: string;
    readonly name: string;
    readonly description?: string;
    readonly content?: string;
    readonly color?: string;
    readonly icon?: string;
    readonly progress?: number;
    readonly startDate?: string | null;
    readonly targetDate?: string | null;
    readonly createdAt?: string;
    readonly updatedAt?: string;
    readonly url?: string;
    readonly status?: LinearProjectStatusDto | null;
    readonly teams: Connection<LinearTeamReferenceDto>;
    readonly lead?: LinearUserDto | null;
}

interface LinearCustomViewDto {
    readonly id: string;
    readonly name: string;
    readonly description?: string;
    readonly shared?: boolean;
    readonly modelName: string;
    readonly filterData?: Record<string, unknown> | null;
    readonly projectFilterData?: Record<string, unknown> | null;
    readonly createdAt?: string;
    readonly updatedAt?: string;
    readonly creator?: LinearUserDto | null;
    readonly owner?: LinearUserDto | null;
    readonly issues: Connection<{ readonly id: string }>;
}

function mapLinearOrganization(organization: LinearOrganization): Organization {
    return {
        id: organization.id,
        name: organization.name,
        urlKey: organization.urlKey,
    };
}

function mapLinearViewer(viewer: LinearViewerDto): WorkspaceViewer {
    return {
        id: viewer.id,
        name: viewer.name,
        displayName: viewer.displayName,
        email: viewer.email,
        organization: mapLinearOrganization(viewer.organization),
    };
}

function mapLinearUser(user: LinearUserDto): WorkspaceUser {
    return {
        id: user.id,
        name: user.name,
        displayName: user.displayName,
        email: user.email,
        avatarUrl: user.avatarUrl,
        active: user.active,
    };
}

function mapLinearTeam(team: LinearTeamDto): Team {
    return {
        kind: "team",
        id: team.id,
        name: team.name,
        key: team.key,
        description: team.description,
        color: team.color,
        icon: team.icon,
        visibility: team.visibility === "private" ? "private" : "workspace",
        createdAt: team.createdAt,
        updatedAt: team.updatedAt,
    };
}

function mapLinearWorkflowState(state: LinearWorkflowStateDto): WorkflowState {
    if (!state.team?.id) {
        throw new LinearApiError(`Workflow state ${state.id} has no team identifier.`);
    }

    return {
        id: state.id,
        name: state.name,
        type: state.type,
        color: state.color,
        position: state.position,
        teamId: state.team.id,
    };
}

function mapLinearIssueLabel(label: LinearIssueLabelDto): IssueLabel {
    return {
        id: label.id,
        name: label.name,
        description: label.description,
        color: label.color,
        parentId: label.parent?.id ?? null,
    };
}

function mapLinearProjectStatus(status: LinearProjectStatusDto): ProjectStatus {
    return {
        id: status.id,
        name: status.name,
        type: status.type,
        color: status.color,
    };
}

function mapLinearIssuePriority(priority: number, issueId: string): IssuePriority {
    if (priority === 0 || priority === 1 || priority === 2 || priority === 3 || priority === 4) {
        return priority;
    }

    throw new LinearApiError(`Issue ${issueId} has unsupported priority ${priority}.`);
}

function mapLinearIssue(
    issue: LinearIssueDto,
    labelIds: readonly string[],
): Issue {
    return {
        kind: "issue",
        id: issue.id,
        identifier: issue.identifier,
        title: issue.title,
        description: issue.description,
        priority: mapLinearIssuePriority(issue.priority, issue.id),
        estimate: issue.estimate,
        dueDate: issue.dueDate,
        createdAt: issue.createdAt,
        updatedAt: issue.updatedAt,
        url: issue.url,
        stateId: issue.state.id,
        teamId: issue.team.id,
        projectId: issue.project?.id ?? null,
        assigneeId: issue.assignee?.id ?? null,
        creatorId: issue.creator?.id ?? null,
        labelIds,
        parentId: issue.parent?.id ?? null,
    };
}

function mapLinearProject(
    project: LinearProjectDto,
    teamIds: readonly string[],
): Project {
    return {
        kind: "project",
        id: project.id,
        name: project.name,
        summary: project.description,
        description: project.content ?? project.description,
        color: project.color,
        icon: project.icon,
        statusId: project.status?.id ?? null,
        progress: project.progress,
        startDate: project.startDate,
        targetDate: project.targetDate,
        createdAt: project.createdAt,
        updatedAt: project.updatedAt,
        url: project.url,
        teamIds,
        leadId: project.lead?.id ?? null,
    };
}

function mapLinearCustomView(
    view: LinearCustomViewDto,
    issueIds: readonly string[],
): CustomView {
    return {
        kind: "customView",
        id: view.id,
        name: view.name,
        description: view.description,
        shared: view.shared ?? false,
        filterData: view.filterData,
        projectFilterData: view.projectFilterData,
        createdAt: view.createdAt,
        updatedAt: view.updatedAt,
        creatorId: view.creator?.id ?? null,
        ownerId: view.owner?.id ?? null,
        issueIds,
    };
}

function mapIssueCommandToLinearInput(
    input: IssueCreateInput | IssueUpdateInput,
): Record<string, unknown> {
    return {
        title: input.title,
        teamId: input.teamId,
        description: input.description,
        stateId: input.stateId,
        priority: input.priority,
        projectId: input.projectId,
        assigneeId: input.assigneeId,
        labelIds: input.labelIds,
        dueDate: input.dueDate,
        estimate: input.estimate,
        parentId: input.parentId,
    };
}

function mapProjectCommandToLinearInput(
    input: ProjectCreateInput | ProjectUpdateInput,
): Record<string, unknown> {
    return {
        name: input.name,
        teamIds: input.teamIds,
        description: input.summary,
        content: input.description,
        color: input.color,
        icon: input.icon,
        statusId: input.statusId,
        leadId: input.leadId,
        startDate: input.startDate,
        targetDate: input.targetDate,
    };
}

function mapTeamCommandToLinearInput(
    input: TeamCreateInput | TeamUpdateInput,
): Record<string, unknown> {
    return {
        name: input.name,
        key: input.key,
        description: input.description,
        color: input.color,
        icon: input.icon,
        private: input.visibility === undefined ? undefined : input.visibility === "private",
    };
}

function mapCustomViewCommandToLinearInput(
    input: CustomViewCreateInput | CustomViewUpdateInput,
): Record<string, unknown> {
    return {
        name: input.name,
        description: input.description,
        shared: input.shared,
        filterData: input.filterData,
        projectFilterData: input.projectFilterData,
    };
}

function aggregateRateLimits(rateLimits: readonly RateLimitInfo[]): RateLimitInfo | undefined {
    let requestLimit: number | undefined;
    let requestRemaining: number | undefined;
    let requestResetAt: string | undefined;
    let complexity: number | undefined;
    let complexityLimit: number | undefined;
    let complexityRemaining: number | undefined;

    for (const rateLimit of rateLimits) {
        if (rateLimit.requestLimit !== undefined) {
            if (requestLimit !== undefined && requestLimit !== rateLimit.requestLimit) {
                throw new LinearApiError("Linear returned inconsistent request rate limits during workspace loading.");
            }
            requestLimit = rateLimit.requestLimit;
        }
        if (rateLimit.requestRemaining !== undefined) {
            requestRemaining = requestRemaining === undefined
                ? rateLimit.requestRemaining
                : Math.min(requestRemaining, rateLimit.requestRemaining);
        }
        if (rateLimit.requestResetAt !== undefined) {
            requestResetAt = requestResetAt === undefined || rateLimit.requestResetAt > requestResetAt
                ? rateLimit.requestResetAt
                : requestResetAt;
        }
        if (rateLimit.complexity !== undefined) {
            complexity = (complexity ?? 0) + rateLimit.complexity;
        }
        if (rateLimit.complexityLimit !== undefined) {
            if (complexityLimit !== undefined && complexityLimit !== rateLimit.complexityLimit) {
                throw new LinearApiError("Linear returned inconsistent complexity rate limits during workspace loading.");
            }
            complexityLimit = rateLimit.complexityLimit;
        }
        if (rateLimit.complexityRemaining !== undefined) {
            complexityRemaining = complexityRemaining === undefined
                ? rateLimit.complexityRemaining
                : Math.min(complexityRemaining, rateLimit.complexityRemaining);
        }
    }

    if (
        requestLimit === undefined
        && requestRemaining === undefined
        && requestResetAt === undefined
        && complexity === undefined
        && complexityLimit === undefined
        && complexityRemaining === undefined
    ) {
        return undefined;
    }

    return {
        requestLimit,
        requestRemaining,
        requestResetAt,
        complexity,
        complexityLimit,
        complexityRemaining,
    };
}

function workspaceFailureCode(error: LinearApiError): WorkspaceFailureCode {
    const code = error.code?.toUpperCase() ?? "";
    const isUserError = error.graphQlErrors.some((graphQlError) => graphQlError.extensions?.userError === true);
    if (error.status === 401 || code.includes("AUTHENTICAT") || code === "UNAUTHENTICATED") {
        return "authentication";
    }
    if (error.status === 403 || code.includes("FORBIDDEN") || code.includes("PERMISSION")) {
        return "permission";
    }
    if (error.status === 404 || code.includes("NOT_FOUND") || code.includes("NOTFOUND")) {
        return "notFound";
    }
    if (error.status === 429 || code.includes("RATE_LIMIT") || code.includes("RATELIMIT")) {
        return "rateLimited";
    }
    if (
        error.status === 422
        || isUserError
        || code === "BAD_USER_INPUT"
        || code === "INVALID_INPUT"
        || code === "INVALID_ARGUMENT"
    ) {
        return "validation";
    }
    if (error.failureKind === "network" || (error.status !== undefined && error.status >= 500)) {
        return "unavailable";
    }

    return "externalContract";
}

function translateLinearError(error: LinearApiError): WorkspaceAdapterError {
    const code = workspaceFailureCode(error);
    return new WorkspaceAdapterError({
        code,
        message: error.message,
        retryable: code === "rateLimited" || code === "unavailable",
        rateLimit: error.rateLimit,
    }, { cause: error });
}

export class LinearWorkspaceAdapter implements WorkspaceAdapter {
    readonly environment = "linear" as const;
    readonly #transport: LinearGraphQlTransport;

    constructor(
        token: string,
        endpoint = LINEAR_GRAPHQL_ENDPOINT,
        fetchImplementation: LinearFetch = globalThis.fetch,
    ) {
        this.#transport = new LinearGraphQlTransport(token, endpoint, fetchImplementation);
    }

    async readWorkspace(): Promise<WorkspaceSnapshot> {
        try {
            return await this.#loadWorkspace();
        } catch (error) {
            if (error instanceof LinearApiError) {
                throw translateLinearError(error);
            }
            throw error;
        }
    }

    async commit(change: WorkspaceCommit): Promise<WorkspaceCommitReceipt> {
        try {
            return await this.#commitWorkspace(change);
        } catch (error) {
            if (error instanceof LinearApiError) {
                throw translateLinearError(error);
            }
            throw error;
        }
    }

    async #loadWorkspace(): Promise<WorkspaceSnapshot> {
        const viewerPromise = this.#transport.request<{ viewer: LinearViewerDto }>(`
            query LazyLinearViewer {
                viewer {
                    id name displayName email
                    organization { id name urlKey }
                }
            }
        `).then((result): Loaded<WorkspaceViewer> => ({
            value: mapLinearViewer(result.data.viewer),
            rateLimits: [result.rateLimit],
        }));
        const teamsPromise = this.#fetchRootConnection<LinearTeamDto>(
            "LazyLinearTeams",
            "teams",
            "id name key description color icon visibility createdAt updatedAt",
        ).then((loaded): Loaded<readonly Team[]> => ({
            value: loaded.value.map(mapLinearTeam),
            rateLimits: loaded.rateLimits,
        }));
        const usersPromise = this.#fetchRootConnection<LinearUserDto>(
            "LazyLinearUsers",
            "users",
            "id name displayName email avatarUrl active",
        ).then((loaded): Loaded<readonly WorkspaceUser[]> => ({
            value: loaded.value.map(mapLinearUser),
            rateLimits: loaded.rateLimits,
        }));
        const workflowStatesPromise = this.#fetchRootConnection<LinearWorkflowStateDto>(
            "LazyLinearWorkflowStates",
            "workflowStates",
            "id name type color position team { id name key }",
        ).then((loaded): Loaded<readonly WorkflowState[]> => ({
            value: loaded.value.map(mapLinearWorkflowState),
            rateLimits: loaded.rateLimits,
        }));
        const labelsPromise = this.#fetchRootConnection<LinearIssueLabelDto>(
            "LazyLinearIssueLabels",
            "issueLabels",
            "id name description color parent { id name }",
        ).then((loaded): Loaded<readonly IssueLabel[]> => ({
            value: loaded.value.map(mapLinearIssueLabel),
            rateLimits: loaded.rateLimits,
        }));
        const projectStatusesPromise = this.#fetchRootConnection<LinearProjectStatusDto>(
            "LazyLinearProjectStatuses",
            "projectStatuses",
            "id name type color",
        ).then((loaded): Loaded<readonly ProjectStatus[]> => ({
            value: loaded.value.map(mapLinearProjectStatus),
            rateLimits: loaded.rateLimits,
        }));

        const loaded = await Promise.all([
            viewerPromise,
            teamsPromise,
            usersPromise,
            workflowStatesPromise,
            labelsPromise,
            projectStatusesPromise,
            this.#fetchIssues(),
            this.#fetchProjects(),
            this.#fetchCustomViews(),
        ] as const);
        const [viewer, teams, users, workflowStates, labels, projectStatuses, issues, projects, customViews] = loaded;
        const rateLimit = aggregateRateLimits(loaded.flatMap((item) => item.rateLimits));

        return {
            viewer: viewer.value,
            teams: teams.value,
            users: users.value,
            workflowStates: workflowStates.value,
            labels: labels.value,
            projectStatuses: projectStatuses.value,
            issues: issues.value,
            projects: projects.value,
            customViews: customViews.value,
            fetchedAt: new Date().toISOString(),
            rateLimit,
        };
    }

    async #fetchRootConnection<T>(
        operation: string,
        field: string,
        selection: string,
        extraArguments = "",
        pageSize = ROOT_CONNECTION_PAGE_SIZE,
    ): Promise<Loaded<readonly T[]>> {
        const nodes: T[] = [];
        const rateLimits: RateLimitInfo[] = [];
        let after: string | null = null;
        do {
            const result: LinearGraphQlResult<Record<string, Connection<T>>> = await this.#transport.request(`
                query ${operation}($after: String) {
                    ${field}(first: ${pageSize}, after: $after${extraArguments ? `, ${extraArguments}` : ""}) {
                        nodes { ${selection} }
                        pageInfo { hasNextPage endCursor }
                    }
                }
            `, { after });
            rateLimits.push(result.rateLimit);
            const connection: Connection<T> | undefined = result.data[field];
            if (!connection) {
                throw new LinearApiError(`Linear returned no ${field} connection.`);
            }
            nodes.push(...connection.nodes);
            if (connection.pageInfo?.hasNextPage && !connection.pageInfo.endCursor) {
                throw new LinearApiError(`Linear reported another ${field} page without a cursor.`);
            }
            after = connection.pageInfo?.hasNextPage ? connection.pageInfo.endCursor! : null;
        } while (after !== null);

        return { value: nodes, rateLimits };
    }

    async #fetchAllNestedConnectionNodes<T>(
        operation: string,
        parentField: string,
        parentId: string,
        connectionField: string,
        selection: string,
        initialConnection: Connection<T>,
        pageSize: number,
    ): Promise<Loaded<readonly T[]>> {
        const nodes = [...initialConnection.nodes];
        const rateLimits: RateLimitInfo[] = [];
        if (initialConnection.pageInfo?.hasNextPage && !initialConnection.pageInfo.endCursor) {
            throw new LinearApiError(`Linear reported another ${parentField}.${connectionField} page without a cursor.`);
        }
        let after = initialConnection.pageInfo?.hasNextPage
            ? initialConnection.pageInfo.endCursor!
            : null;
        while (after !== null) {
            const result = await this.#transport.request<Record<string, Record<string, Connection<T>> | null>>(`
                query ${operation}($id: String!, $after: String) {
                    ${parentField}(id: $id) {
                        ${connectionField}(first: ${pageSize}, after: $after) {
                            nodes { ${selection} }
                            pageInfo { hasNextPage endCursor }
                        }
                    }
                }
            `, { id: parentId, after });
            rateLimits.push(result.rateLimit);
            const connection = result.data[parentField]?.[connectionField];
            if (!connection) {
                throw new LinearApiError(`Linear returned no ${parentField}.${connectionField} connection.`);
            }
            nodes.push(...connection.nodes);
            if (connection.pageInfo?.hasNextPage && !connection.pageInfo.endCursor) {
                throw new LinearApiError(`Linear reported another ${parentField}.${connectionField} page without a cursor.`);
            }
            after = connection.pageInfo?.hasNextPage ? connection.pageInfo.endCursor! : null;
        }

        return { value: nodes, rateLimits };
    }

    async #fetchIssues(): Promise<Loaded<readonly Issue[]>> {
        const issues = await this.#fetchRootConnection<LinearIssueDto>(
            "LazyLinearIssues",
            "issues",
            `
                id identifier title description priority estimate dueDate
                createdAt updatedAt url
                state { id name type color position team { id name key } }
                team { id name key }
                project { id name color }
                assignee { id name displayName email avatarUrl active }
                creator { id name displayName email avatarUrl active }
                labels(first: ${ISSUE_LABEL_PAGE_SIZE}) {
                    nodes { id name description color }
                    pageInfo { hasNextPage endCursor }
                }
                parent { id identifier title }
            `,
            "orderBy: updatedAt",
            ISSUE_PAGE_SIZE,
        );
        const labels = await Promise.all(issues.value.map((issue) => this.#fetchAllNestedConnectionNodes(
            "LazyLinearIssueLabelsPage",
            "issue",
            issue.id,
            "labels",
            "id name description color",
            issue.labels,
            ISSUE_LABEL_PAGE_SIZE,
        )));

        return {
            value: issues.value.map((issue, index) => mapLinearIssue(
                issue,
                labels[index]!.value.map((label) => label.id),
            )),
            rateLimits: [
                ...issues.rateLimits,
                ...labels.flatMap((loaded) => loaded.rateLimits),
            ],
        };
    }

    async #fetchProjects(): Promise<Loaded<readonly Project[]>> {
        const projects = await this.#fetchRootConnection<LinearProjectDto>(
            "LazyLinearProjects",
            "projects",
            `
                id name description content color icon progress startDate targetDate
                createdAt updatedAt url
                status { id name type color }
                teams(first: ${PROJECT_TEAM_PAGE_SIZE}) {
                    nodes { id name key }
                    pageInfo { hasNextPage endCursor }
                }
                lead { id name displayName email avatarUrl active }
            `,
            "orderBy: updatedAt",
            PROJECT_PAGE_SIZE,
        );
        const teams = await Promise.all(projects.value.map((project) => this.#fetchAllNestedConnectionNodes(
            "LazyLinearProjectTeamsPage",
            "project",
            project.id,
            "teams",
            "id name key",
            project.teams,
            PROJECT_TEAM_PAGE_SIZE,
        )));

        return {
            value: projects.value.map((project, index) => mapLinearProject(
                project,
                teams[index]!.value.map((team) => team.id),
            )),
            rateLimits: [
                ...projects.rateLimits,
                ...teams.flatMap((loaded) => loaded.rateLimits),
            ],
        };
    }

    async #fetchCustomViews(): Promise<Loaded<readonly CustomView[]>> {
        const query = (optionalFields: string) => `
            query LazyLinearCustomViews($after: String) {
                customViews(first: ${CUSTOM_VIEW_PAGE_SIZE}, after: $after, filter: { modelName: { eq: "Issue" } }) {
                    nodes {
                        id name description shared filterData createdAt updatedAt
                        modelName
                        ${optionalFields}
                        creator { id name displayName email avatarUrl active }
                        issues(first: ${CUSTOM_VIEW_ISSUE_PAGE_SIZE}) {
                            nodes { id }
                            pageInfo { hasNextPage endCursor }
                        }
                    }
                    pageInfo { hasNextPage endCursor }
                }
            }
        `;

        const views: LinearCustomViewDto[] = [];
        const rateLimits: RateLimitInfo[] = [];
        let after: string | null = null;
        let optionalFields = "projectFilterData owner { id name displayName email avatarUrl active }";
        do {
            let connection: Connection<LinearCustomViewDto>;
            try {
                const result = await this.#transport.request<{ customViews?: Connection<LinearCustomViewDto> }>(
                    query(optionalFields),
                    { after },
                );
                rateLimits.push(result.rateLimit);
                if (!result.data.customViews) {
                    throw new LinearApiError("Linear returned no customViews connection.");
                }
                connection = result.data.customViews;
            } catch (error) {
                const optionalFieldUnavailable = error instanceof LinearApiError
                    && error.graphQlErrors.some((graphQlError) => (
                        graphQlError.message.includes('Cannot query field "projectFilterData"')
                        || graphQlError.message.includes('Cannot query field "owner"')
                    ));
                if (!optionalFieldUnavailable || optionalFields.length === 0) {
                    throw error;
                }
                if (error.rateLimit) {
                    rateLimits.push(error.rateLimit);
                }
                optionalFields = "";
                const fallback = await this.#transport.request<{ customViews?: Connection<LinearCustomViewDto> }>(
                    query(optionalFields),
                    { after },
                );
                rateLimits.push(fallback.rateLimit);
                if (!fallback.data.customViews) {
                    throw new LinearApiError("Linear returned no customViews connection.");
                }
                connection = fallback.data.customViews;
            }

            views.push(...connection.nodes.filter((view) => view.modelName === "Issue"));
            if (connection.pageInfo?.hasNextPage && !connection.pageInfo.endCursor) {
                throw new LinearApiError("Linear reported another customViews page without a cursor.");
            }
            after = connection.pageInfo?.hasNextPage ? connection.pageInfo.endCursor! : null;
        } while (after !== null);

        const issueIds = await Promise.all(views.map((view) => this.#fetchAllNestedConnectionNodes(
            "LazyLinearCustomViewIssues",
            "customView",
            view.id,
            "issues",
            "id",
            view.issues,
            CUSTOM_VIEW_ISSUE_PAGE_SIZE,
        )));
        return {
            value: views.map((view, index) => mapLinearCustomView(
                view,
                issueIds[index]!.value.map((issue) => issue.id),
            )),
            rateLimits: [
                ...rateLimits,
                ...issueIds.flatMap((loaded) => loaded.rateLimits),
            ],
        };
    }

    async #commitWorkspace(change: WorkspaceCommit): Promise<WorkspaceCommitReceipt> {
        switch (change.kind) {
            case "issue": {
                if (change.action === "archive") {
                    await this.#commitIdOnlyMutation("ArchiveIssue", "issueArchive", change.id);
                    return { action: "archived", resource: { kind: "issue", id: change.id } };
                }

                const input = mapIssueCommandToLinearInput(change.input);
                const id = change.action === "create"
                    ? await this.#mutationWithId("CreateIssue", "issueCreate", "IssueCreateInput", undefined, input)
                    : await this.#mutationWithId("UpdateIssue", "issueUpdate", "IssueUpdateInput", change.id, input);
                return {
                    action: change.action === "create" ? "created" : "updated",
                    resource: { kind: "issue", id },
                };
            }
            case "project": {
                if (change.action === "archive") {
                    await this.#commitIdOnlyMutation("ArchiveProject", "projectArchive", change.id);
                    return { action: "archived", resource: { kind: "project", id: change.id } };
                }

                const input = mapProjectCommandToLinearInput(change.input);
                const id = change.action === "create"
                    ? await this.#mutationWithId("CreateProject", "projectCreate", "ProjectCreateInput", undefined, input)
                    : await this.#mutationWithId("UpdateProject", "projectUpdate", "ProjectUpdateInput", change.id, input);
                return {
                    action: change.action === "create" ? "created" : "updated",
                    resource: { kind: "project", id },
                };
            }
            case "team": {
                if (change.action === "archive") {
                    await this.#commitIdOnlyMutation("DeleteTeam", "teamDelete", change.id);
                    return { action: "archived", resource: { kind: "team", id: change.id } };
                }

                const input = mapTeamCommandToLinearInput(change.input);
                const id = change.action === "create"
                    ? await this.#mutationWithId("CreateTeam", "teamCreate", "TeamCreateInput", undefined, input)
                    : await this.#mutationWithId("UpdateTeam", "teamUpdate", "TeamUpdateInput", change.id, input);
                return {
                    action: change.action === "create" ? "created" : "updated",
                    resource: { kind: "team", id },
                };
            }
            case "customView": {
                if (change.action === "delete") {
                    await this.#commitIdOnlyMutation("DeleteCustomView", "customViewDelete", change.id);
                    return { action: "deleted", resource: { kind: "customView", id: change.id } };
                }

                const input = mapCustomViewCommandToLinearInput(change.input);
                const id = change.action === "create"
                    ? await this.#mutationWithId(
                        "CreateCustomView",
                        "customViewCreate",
                        "CustomViewCreateInput",
                        undefined,
                        input,
                    )
                    : await this.#mutationWithId(
                        "UpdateCustomView",
                        "customViewUpdate",
                        "CustomViewUpdateInput",
                        change.id,
                        input,
                    );
                return {
                    action: change.action === "create" ? "created" : "updated",
                    resource: { kind: "customView", id },
                };
            }
        }
    }

    async #mutationWithId(
        operation: string,
        field: string,
        inputType: string,
        id: string | undefined,
        input: Readonly<Record<string, unknown>>,
    ): Promise<string> {
        const entityField = field.replace(/(?:Create|Update)$/u, "");
        const result = await this.#transport.request<Record<string, { success: boolean; [key: string]: unknown }>>(`
            mutation ${operation}($input: ${inputType}!${id === undefined ? "" : ", $id: String!"}) {
                ${field}(${id === undefined ? "" : "id: $id, "}input: $input) {
                    success
                    ${entityField} { id }
                }
            }
        `, id === undefined ? { input } : { id, input });

        const payload = result.data[field];
        if (!payload?.success) {
            throw new LinearApiError(`Linear reported that ${operation} did not succeed.`);
        }

        const entity = payload[entityField] as { readonly id?: string } | undefined;
        if (!entity?.id) {
            throw new LinearApiError(`${operation} succeeded but Linear returned no entity identifier.`);
        }

        return entity.id;
    }

    async #commitIdOnlyMutation(operation: string, field: string, id: string): Promise<void> {
        const result = await this.#transport.request<Record<string, { success: boolean }>>(`
            mutation ${operation}($id: String!) {
                ${field}(id: $id) { success }
            }
        `, { id });
        if (!result.data[field]?.success) {
            throw new LinearApiError(`Linear reported that ${operation} did not succeed.`);
        }
    }
}