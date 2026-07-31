import type {
    CustomView,
    CustomViewInput,
    CustomViewUpdateInput,
    Issue,
    IssueInput,
    IssueLabel,
    IssueUpdateInput,
    LinearUser,
    LinearViewer,
    Project,
    ProjectInput,
    ProjectStatus,
    ProjectUpdateInput,
    RateLimitInfo,
    Team,
    TeamInput,
    TeamUpdateInput,
    WorkflowState,
    WorkspaceData,
} from "./types.js";
import { LinearApiError, type GraphQlErrorShape } from "./linear-error.js";

export { LinearApiError };

const LINEAR_GRAPHQL_ENDPOINT = "https://api.linear.app/graphql";
const ROOT_CONNECTION_PAGE_SIZE = 100;
const ISSUE_PAGE_SIZE = 50;
const ISSUE_LABEL_PAGE_SIZE = 10;
const PROJECT_PAGE_SIZE = 100;
const PROJECT_TEAM_PAGE_SIZE = 10;
const CUSTOM_VIEW_PAGE_SIZE = 25;
const CUSTOM_VIEW_ISSUE_PAGE_SIZE = 50;

interface GraphQlResponse<T> {
    data?: T;
    errors?: GraphQlErrorShape[];
}

interface Connection<T> {
    nodes: T[];
    pageInfo?: {
        hasNextPage: boolean;
        endCursor?: string | null;
    };
}

function numericHeader(headers: Headers, name: string): number | undefined {
    const value = headers.get(name);
    if (value === null) {
        return undefined;
    }

    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
}

function readRateLimit(headers: Headers): RateLimitInfo {
    const reset = numericHeader(headers, "x-ratelimit-requests-reset");
    return {
        requestLimit: numericHeader(headers, "x-ratelimit-requests-limit"),
        requestRemaining: numericHeader(headers, "x-ratelimit-requests-remaining"),
        requestResetAt: reset === undefined ? undefined : new Date(reset),
        complexity: numericHeader(headers, "x-complexity"),
        complexityLimit: numericHeader(headers, "x-ratelimit-complexity-limit"),
        complexityRemaining: numericHeader(headers, "x-ratelimit-complexity-remaining"),
    };
}

function authorizationHeader(token: string): string {
    const trimmed = token.trim();
    if (/^Bearer\s+/i.test(trimmed)) {
        return trimmed;
    }

    return trimmed.startsWith("lin_api_") ? trimmed : `Bearer ${trimmed}`;
}

function mutationFailure(operation: string): never {
    throw new LinearApiError(`Linear reported that ${operation} did not succeed.`);
}

export class LinearApi {
    readonly #token: string;
    readonly #endpoint: string;
    #lastRateLimit: RateLimitInfo | undefined;

    constructor(token: string, endpoint = LINEAR_GRAPHQL_ENDPOINT) {
        if (token.trim().length === 0) {
            throw new LinearApiError("A Linear API key or OAuth access token is required.");
        }

        this.#token = token.trim();
        this.#endpoint = endpoint;
    }

    get lastRateLimit(): RateLimitInfo | undefined {
        return this.#lastRateLimit;
    }

    async #request<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
        let response: Response;
        try {
            response = await fetch(this.#endpoint, {
                method: "POST",
                headers: {
                    Accept: "application/json",
                    Authorization: authorizationHeader(this.#token),
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({ query, variables }),
            });
        } catch (error) {
            throw new LinearApiError("Unable to reach Linear. Check your network connection.", { cause: error });
        }

        const rateLimit = readRateLimit(response.headers);
        this.#lastRateLimit = rateLimit;

        let payload: GraphQlResponse<T>;
        try {
            payload = await response.json() as GraphQlResponse<T>;
        } catch (error) {
            throw new LinearApiError(`Linear returned an unreadable response (${response.status}).`, {
                status: response.status,
                rateLimit,
                cause: error,
            });
        }

        if (!response.ok || payload.errors?.length) {
            const errors = payload.errors ?? [];
            const primary = errors[0];
            const message = primary?.extensions?.userPresentableMessage
                ?? primary?.message
                ?? `Linear request failed with HTTP ${response.status}.`;
            throw new LinearApiError(message, {
                code: primary?.extensions?.code,
                graphQlErrors: errors,
                status: response.status,
                rateLimit,
            });
        }

        if (payload.data === undefined) {
            throw new LinearApiError("Linear returned no data for the request.", { rateLimit });
        }

        return payload.data;
    }

    async bootstrap(): Promise<WorkspaceData> {
        const viewerPromise = this.#request<{ viewer: LinearViewer }>(`
            query LazyLinearViewer {
                viewer {
                    id name displayName email
                    organization { id name urlKey }
                }
            }
        `).then((result) => result.viewer);
        const teamsPromise = this.#fetchRootConnection<Team>(
            "LazyLinearTeams",
            "teams",
            "id name key description color icon visibility createdAt updatedAt",
        ).then((teams) => teams.map((team) => ({
            ...team,
            private: team.visibility === "private",
        })));
        const usersPromise = this.#fetchRootConnection<LinearUser>(
            "LazyLinearUsers",
            "users",
            "id name displayName email avatarUrl active",
        );
        const workflowStatesPromise = this.#fetchRootConnection<WorkflowState>(
            "LazyLinearWorkflowStates",
            "workflowStates",
            "id name type color position team { id name key }",
        );
        const labelsPromise = this.#fetchRootConnection<IssueLabel>(
            "LazyLinearIssueLabels",
            "issueLabels",
            "id name description color parent { id name }",
        );
        const projectStatusesPromise = this.#fetchRootConnection<ProjectStatus>(
            "LazyLinearProjectStatuses",
            "projectStatuses",
            "id name type color",
        );
        const [viewer, teams, users, workflowStates, labels, projectStatuses, issues, projects, customViews] = await Promise.all([
            viewerPromise,
            teamsPromise,
            usersPromise,
            workflowStatesPromise,
            labelsPromise,
            projectStatusesPromise,
            this.#fetchIssues(),
            this.#fetchProjects(),
            this.#fetchCustomViews(),
        ]);

        return {
            viewer,
            organization: viewer.organization,
            teams,
            users,
            workflowStates,
            labels,
            projectStatuses,
            issues,
            projects,
            customViews,
            fetchedAt: new Date().toISOString(),
            rateLimit: this.#lastRateLimit,
        };
    }

    async #fetchRootConnection<T>(
        operation: string,
        field: string,
        selection: string,
        extraArguments = "",
        pageSize = ROOT_CONNECTION_PAGE_SIZE,
    ): Promise<T[]> {
        const nodes: T[] = [];
        let after: string | null = null;
        do {
            const result: Record<string, Connection<T>> = await this.#request(`
                query ${operation}($after: String) {
                    ${field}(first: ${pageSize}, after: $after${extraArguments ? `, ${extraArguments}` : ""}) {
                        nodes { ${selection} }
                        pageInfo { hasNextPage endCursor }
                    }
                }
            `, { after });
            const connection = result[field];
            if (!connection) {
                throw new LinearApiError(`Linear returned no ${field} connection.`);
            }
            nodes.push(...connection.nodes);
            if (connection.pageInfo?.hasNextPage && !connection.pageInfo.endCursor) {
                throw new LinearApiError(`Linear reported another ${field} page without a cursor.`);
            }
            after = connection.pageInfo?.hasNextPage ? connection.pageInfo.endCursor! : null;
        } while (after !== null);
        return nodes;
    }

    async #fetchAllNestedConnectionNodes<T>(
        operation: string,
        parentField: string,
        parentId: string,
        connectionField: string,
        selection: string,
        initialConnection: Connection<T>,
        pageSize: number,
    ): Promise<T[]> {
        const nodes = [...initialConnection.nodes];
        if (initialConnection.pageInfo?.hasNextPage && !initialConnection.pageInfo.endCursor) {
            throw new LinearApiError(`Linear reported another ${parentField}.${connectionField} page without a cursor.`);
        }
        let after = initialConnection.pageInfo?.hasNextPage
            ? initialConnection.pageInfo.endCursor!
            : null;
        while (after !== null) {
            const result = await this.#request<Record<string, Record<string, Connection<T>>>>(`
                query ${operation}($id: String!, $after: String) {
                    ${parentField}(id: $id) {
                        ${connectionField}(first: ${pageSize}, after: $after) {
                            nodes { ${selection} }
                            pageInfo { hasNextPage endCursor }
                        }
                    }
                }
            `, { id: parentId, after });
            const connection = result[parentField]?.[connectionField];
            if (!connection) {
                throw new LinearApiError(`Linear returned no ${parentField}.${connectionField} connection.`);
            }
            nodes.push(...connection.nodes);
            if (connection.pageInfo?.hasNextPage && !connection.pageInfo.endCursor) {
                throw new LinearApiError(`Linear reported another ${parentField}.${connectionField} page without a cursor.`);
            }
            after = connection.pageInfo?.hasNextPage ? connection.pageInfo.endCursor! : null;
        }
        return nodes;
    }

    async #fetchIssues(): Promise<Issue[]> {
        type ApiIssue = Omit<Issue, "labels"> & { labels: Connection<IssueLabel>; };
        const issues = await this.#fetchRootConnection<ApiIssue>(
            "LazyLinearIssues",
            "issues",
            `
                id identifier title description priority priorityLabel estimate dueDate
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
        return Promise.all(issues.map(async (issue) => ({
            ...issue,
            labels: await this.#fetchAllNestedConnectionNodes(
                "LazyLinearIssueLabelsPage",
                "issue",
                issue.id,
                "labels",
                "id name description color",
                issue.labels,
                ISSUE_LABEL_PAGE_SIZE,
            ),
        })));
    }

    async #fetchProjects(): Promise<Project[]> {
        type ApiProject = Omit<Project, "teams" | "summary" | "description" | "state"> & {
            description?: string;
            content?: string;
            teams: Connection<Team>;
        };
        const projects = await this.#fetchRootConnection<ApiProject>(
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
        return Promise.all(projects.map(async (project) => ({
            ...project,
            summary: project.description,
            description: project.content ?? project.description,
            state: project.status?.type ?? "planned",
            teams: await this.#fetchAllNestedConnectionNodes(
                "LazyLinearProjectTeamsPage",
                "project",
                project.id,
                "teams",
                "id name key",
                project.teams,
                PROJECT_TEAM_PAGE_SIZE,
            ),
        })));
    }

    async #fetchCustomViews(): Promise<CustomView[]> {
        type ApiCustomView = Omit<CustomView, "issueIds" | "modelName"> & {
            modelName: string;
            issues: Connection<{ id: string }>;
        };
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

        const views: ApiCustomView[] = [];
        let after: string | null = null;
        let optionalFields = "projectFilterData owner { id name displayName email avatarUrl active }";
        do {
            let result: { customViews: Connection<ApiCustomView> };
            try {
                result = await this.#request(query(optionalFields), { after });
            } catch (error) {
                const optionalFieldUnavailable = error instanceof LinearApiError
                    && error.graphQlErrors.some((graphQlError) => (
                        graphQlError.message.includes('Cannot query field "projectFilterData"')
                        || graphQlError.message.includes('Cannot query field "owner"')
                    ));
                if (!optionalFieldUnavailable || optionalFields.length === 0) {
                    throw error;
                }
                optionalFields = "";
                result = await this.#request(query(optionalFields), { after });
            }
            views.push(...result.customViews.nodes.filter((view) => view.modelName === "Issue"));
            if (result.customViews.pageInfo?.hasNextPage && !result.customViews.pageInfo.endCursor) {
                throw new LinearApiError("Linear reported another customViews page without a cursor.");
            }
            after = result.customViews.pageInfo?.hasNextPage ? result.customViews.pageInfo.endCursor! : null;
        } while (after !== null);

        return Promise.all(views.map(async (view) => {
            const issueIds = view.issues.nodes.map((issue) => issue.id);
            if (view.issues.pageInfo?.hasNextPage && !view.issues.pageInfo.endCursor) {
                throw new LinearApiError(`Linear reported another issues page for custom view ${view.id} without a cursor.`);
            }
            let issueAfter = view.issues.pageInfo?.hasNextPage ? view.issues.pageInfo.endCursor! : null;
            while (issueAfter !== null) {
                const result = await this.#request<{ customView: { issues: Connection<{ id: string }> } }>(`
                    query LazyLinearCustomViewIssues($id: String!, $after: String) {
                        customView(id: $id) {
                            issues(first: ${CUSTOM_VIEW_ISSUE_PAGE_SIZE}, after: $after) {
                                nodes { id }
                                pageInfo { hasNextPage endCursor }
                            }
                        }
                    }
                `, { id: view.id, after: issueAfter });
                issueIds.push(...result.customView.issues.nodes.map((issue) => issue.id));
                if (result.customView.issues.pageInfo?.hasNextPage && !result.customView.issues.pageInfo.endCursor) {
                    throw new LinearApiError(`Linear reported another issues page for custom view ${view.id} without a cursor.`);
                }
                issueAfter = result.customView.issues.pageInfo?.hasNextPage
                    ? result.customView.issues.pageInfo.endCursor!
                    : null;
            }
            return { ...view, issueIds };
        }));
    }

    async createIssue(input: IssueInput): Promise<string> {
        return this.#mutationWithId("CreateIssue", "issueCreate", "IssueCreateInput", undefined, input);
    }

    async updateIssue(id: string, input: IssueUpdateInput): Promise<string> {
        return this.#mutationWithId("UpdateIssue", "issueUpdate", "IssueUpdateInput", id, input);
    }

    async deleteIssue(id: string): Promise<void> {
        await this.#archive("ArchiveIssue", "issueArchive", id);
    }

    async createProject(input: ProjectInput): Promise<string> {
        return this.#mutationWithId("CreateProject", "projectCreate", "ProjectCreateInput", undefined, input);
    }

    async updateProject(id: string, input: ProjectUpdateInput): Promise<string> {
        return this.#mutationWithId("UpdateProject", "projectUpdate", "ProjectUpdateInput", id, input);
    }

    async deleteProject(id: string): Promise<void> {
        await this.#archive("DeleteProject", "projectDelete", id);
    }

    async createTeam(input: TeamInput): Promise<string> {
        return this.#mutationWithId("CreateTeam", "teamCreate", "TeamCreateInput", undefined, input);
    }

    async updateTeam(id: string, input: TeamUpdateInput): Promise<string> {
        return this.#mutationWithId("UpdateTeam", "teamUpdate", "TeamUpdateInput", id, input);
    }

    async deleteTeam(id: string): Promise<void> {
        const result = await this.#request<{ teamDelete: { success: boolean } }>(`
            mutation DeleteTeam($id: String!) {
                teamDelete(id: $id) { success }
            }
        `, { id });
        if (!result.teamDelete.success) {
            mutationFailure("team deletion");
        }
    }

    async createCustomView(input: CustomViewInput): Promise<string> {
        return this.#mutationWithId("CreateCustomView", "customViewCreate", "CustomViewCreateInput", undefined, input);
    }

    async updateCustomView(id: string, input: CustomViewUpdateInput): Promise<string> {
        return this.#mutationWithId("UpdateCustomView", "customViewUpdate", "CustomViewUpdateInput", id, input);
    }

    async deleteCustomView(id: string): Promise<void> {
        const result = await this.#request<{ customViewDelete: { success: boolean } }>(`
            mutation DeleteCustomView($id: String!) {
                customViewDelete(id: $id) { success }
            }
        `, { id });
        if (!result.customViewDelete.success) {
            mutationFailure("custom view deletion");
        }
    }

    async #mutationWithId(
        operation: string,
        field: string,
        inputType: string,
        id: string | undefined,
        input: object,
    ): Promise<string> {
        const entityField = field.replace(/(?:Create|Update)$/u, "");
        const result = await this.#request<Record<string, { success: boolean; [key: string]: unknown }>>(`
            mutation ${operation}($input: ${inputType}!${id === undefined ? "" : ", $id: String!"}) {
                ${field}(${id === undefined ? "" : "id: $id, "}input: $input) {
                    success
                    ${entityField} { id }
                }
            }
        `, id === undefined ? { input } : { id, input });

        const payload = result[field];
        if (!payload?.success) {
            mutationFailure(operation);
        }

        const entity = payload[entityField] as { id?: string } | undefined;
        if (!entity?.id) {
            throw new LinearApiError(`${operation} succeeded but Linear returned no entity identifier.`);
        }

        return entity.id;
    }

    async #archive(operation: string, field: string, id: string): Promise<void> {
        const result = await this.#request<Record<string, { success: boolean }>>(`
            mutation ${operation}($id: String!) {
                ${field}(id: $id) { success }
            }
        `, { id });
        if (!result[field]?.success) {
            mutationFailure(operation);
        }
    }
}