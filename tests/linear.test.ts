import assert from "node:assert/strict";
import { test } from "node:test";
import { LinearWorkspaceAdapter } from "../lib/linear.js";
import { LinearApiError } from "../lib/linear-error.js";
import {
    LinearGraphQlTransport,
    type LinearFetch,
} from "../lib/linear-graphql-transport.js";
import { WorkspaceAdapterError } from "../src/workspace-adapter.js";

interface GraphQlRequestBody {
    readonly query: string;
    readonly variables: Record<string, unknown>;
}

function jsonResponse(
    body: unknown,
    status = 200,
    headers: Record<string, string> = {},
): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json", ...headers },
    });
}

function requestBody(init: RequestInit | undefined): GraphQlRequestBody {
    const body = init?.body;
    if (typeof body !== "string") {
        assert.fail("Expected the GraphQL request body to be a JSON string.");
    }
    return JSON.parse(body) as GraphQlRequestBody;
}

function operationName(query: string): string {
    const match = /\b(?:query|mutation)\s+([A-Za-z0-9_]+)/u.exec(query);
    if (!match?.[1]) {
        assert.fail("Expected a named GraphQL operation.");
    }
    return match[1];
}

function connection<T>(
    nodes: readonly T[],
    hasNextPage = false,
    endCursor: string | null = null,
) {
    return { nodes, pageInfo: { hasNextPage, endCursor } };
}

function injectedFetch(
    handler: (request: GraphQlRequestBody, input: string | URL | Request, init?: RequestInit) => Promise<Response> | Response,
): LinearFetch {
    return async (input, init) => handler(requestBody(init), input, init);
}

function emptyWorkspaceResponse(operation: string, headers: Record<string, string> = {}): Response | undefined {
    if (operation === "LazyLinearViewer") {
        return jsonResponse({
            data: {
                viewer: {
                    id: "viewer-1",
                    name: "Test User",
                    displayName: "Test User",
                    organization: { id: "organization-1", name: "Test Workspace", urlKey: "test" },
                },
            },
        }, 200, headers);
    }

    const fields: Record<string, string> = {
        LazyLinearTeams: "teams",
        LazyLinearUsers: "users",
        LazyLinearWorkflowStates: "workflowStates",
        LazyLinearIssueLabels: "issueLabels",
        LazyLinearProjectStatuses: "projectStatuses",
        LazyLinearIssues: "issues",
        LazyLinearProjects: "projects",
        LazyLinearCustomViews: "customViews",
    };
    const field = fields[operation];
    return field
        ? jsonResponse({ data: { [field]: connection([]) } }, 200, headers)
        : undefined;
}

test("LinearGraphQlTransport rejects empty credentials and injects the correct authorization header", async () => {
    assert.throws(() => new LinearGraphQlTransport("  \t ", undefined, injectedFetch(() => jsonResponse({}))), (error: unknown) => {
        assert.ok(error instanceof LinearApiError);
        assert.match(error.message, /API key or OAuth access token is required/u);
        return true;
    });

    const cases = [
        { token: "  lin_api_personal  ", expected: "lin_api_personal" },
        { token: "oauth-access-token", expected: "Bearer oauth-access-token" },
        { token: "  Bearer already-prefixed  ", expected: "Bearer already-prefixed" },
    ];
    for (const { token, expected } of cases) {
        let requestCount = 0;
        const fetchImplementation = injectedFetch((_request, input, init) => {
            requestCount += 1;
            assert.equal(input, "https://linear.invalid/graphql");
            assert.equal(init?.method, "POST");
            const headers = new Headers(init?.headers);
            assert.equal(headers.get("Accept"), "application/json");
            assert.equal(headers.get("Content-Type"), "application/json");
            assert.equal(headers.get("Authorization"), expected);
            return jsonResponse({ data: { viewer: { id: "viewer-1" } } });
        });
        const transport = new LinearGraphQlTransport(token, "https://linear.invalid/graphql", fetchImplementation);

        const result = await transport.request<{ viewer: { id: string } }>("query Viewer { viewer { id } }");

        assert.equal(result.data.viewer.id, "viewer-1");
        assert.equal(requestCount, 1);
    }
});

test("LinearWorkspaceAdapter reads normalized resources and uses one nested pagination path", async () => {
    const requests: GraphQlRequestBody[] = [];
    const fetchImplementation = injectedFetch((body) => {
        requests.push(body);
        const operation = operationName(body.query);
        if (operation === "LazyLinearViewer") {
            return jsonResponse({
                data: {
                    viewer: {
                        id: "viewer-1",
                        name: "Ada",
                        displayName: "Ada Lovelace",
                        email: "ada@example.test",
                        organization: { id: "org-1", name: "Analytical", urlKey: "analytical" },
                    },
                },
            });
        }
        if (operation === "LazyLinearTeams") {
            assert.match(body.query, /\bvisibility\b/u);
            assert.doesNotMatch(body.query, /\bprivate\b/u);
            if (body.variables.after === "teams-root-1") {
                return jsonResponse({ data: { teams: connection([{
                    id: "team-2",
                    name: "App",
                    key: "APP",
                    visibility: "workspace",
                }]) } });
            }
            return jsonResponse({ data: { teams: connection([{
                id: "team-1",
                name: "Core",
                key: "CORE",
                visibility: "private",
            }], true, "teams-root-1") } });
        }
        if (operation === "LazyLinearUsers") {
            return jsonResponse({ data: { users: connection([{
                id: "user-1",
                name: "Ada",
                displayName: "Ada Lovelace",
                active: true,
            }]) } });
        }
        if (operation === "LazyLinearWorkflowStates") {
            return jsonResponse({ data: { workflowStates: connection([{
                id: "state-1",
                name: "Todo",
                type: "unstarted",
                color: "#aaaaaa",
                team: { id: "team-1", name: "Core", key: "CORE" },
            }]) } });
        }
        if (operation === "LazyLinearIssueLabels") {
            return jsonResponse({ data: { issueLabels: connection([{
                id: "label-1",
                name: "Bug",
                color: "#ff0000",
                parent: { id: "label-parent", name: "Type" },
            }]) } });
        }
        if (operation === "LazyLinearProjectStatuses") {
            return jsonResponse({ data: { projectStatuses: connection([{
                id: "status-1",
                name: "Started",
                type: "started",
                color: "#00ff00",
            }]) } });
        }
        if (operation === "LazyLinearIssues") {
            assert.match(body.query, /issues\(first: 50,/u);
            assert.match(body.query, /labels\(first: 10\)/u);
            return jsonResponse({
                data: {
                    issues: connection([{
                        id: "issue-1",
                        identifier: "CORE-1",
                        title: "Paginated labels",
                        priority: 2,
                        state: { id: "state-1", name: "Todo", type: "unstarted", color: "#aaaaaa" },
                        team: { id: "team-1", name: "Core", key: "CORE" },
                        project: { id: "project-1", name: "Engine" },
                        assignee: { id: "user-1", name: "Ada", displayName: "Ada Lovelace" },
                        creator: { id: "user-1", name: "Ada", displayName: "Ada Lovelace" },
                        labels: connection([{ id: "label-1", name: "Bug", color: "#ff0000" }], true, "labels-1"),
                        parent: { id: "issue-parent", identifier: "CORE-0", title: "Parent" },
                    }]),
                },
            });
        }
        if (operation === "LazyLinearIssueLabelsPage") {
            assert.deepEqual(body.variables, { id: "issue-1", after: "labels-1" });
            return jsonResponse({ data: { issue: { labels: connection([
                { id: "label-2", name: "Urgent", color: "#ff8800" },
            ]) } } });
        }
        if (operation === "LazyLinearProjects") {
            assert.match(body.query, /projects\(first: 100,/u);
            assert.match(body.query, /teams\(first: 10\)/u);
            return jsonResponse({
                data: {
                    projects: connection([{
                        id: "project-1",
                        name: "Engine",
                        description: "Short summary",
                        content: "Long description",
                        status: { id: "status-1", name: "Started", type: "started", color: "#00ff00" },
                        teams: connection([{ id: "team-1", name: "Core", key: "CORE" }], true, "teams-1"),
                        lead: { id: "user-1", name: "Ada", displayName: "Ada Lovelace" },
                    }]),
                },
            });
        }
        if (operation === "LazyLinearProjectTeamsPage") {
            assert.deepEqual(body.variables, { id: "project-1", after: "teams-1" });
            return jsonResponse({ data: { project: { teams: connection([
                { id: "team-2", name: "App", key: "APP" },
            ]) } } });
        }
        if (operation === "LazyLinearCustomViews") {
            assert.match(body.query, /filter: \{ modelName: \{ eq: "Issue" \} \}/u);
            return jsonResponse({
                data: {
                    customViews: connection([{
                        id: "view-1",
                        name: "My view",
                        shared: true,
                        modelName: "Issue",
                        filterData: { priority: { eq: 2 } },
                        creator: { id: "user-1", name: "Ada", displayName: "Ada Lovelace" },
                        owner: { id: "user-1", name: "Ada", displayName: "Ada Lovelace" },
                        issues: connection([{ id: "issue-1" }], true, "view-issues-1"),
                    }]),
                },
            });
        }
        if (operation === "LazyLinearCustomViewIssues") {
            assert.deepEqual(body.variables, { id: "view-1", after: "view-issues-1" });
            return jsonResponse({ data: { customView: { issues: connection([{ id: "issue-2" }]) } } });
        }

        return jsonResponse({ errors: [{ message: `Unexpected test operation ${operation}` }] }, 400);
    });
    const adapter = new LinearWorkspaceAdapter(
        "lin_api_read",
        "https://linear.invalid/graphql",
        fetchImplementation,
    );

    const workspace = await adapter.readWorkspace();

    assert.equal(workspace.viewer.organization.id, "org-1");
    assert.equal(workspace.teams[0]?.kind, "team");
    assert.equal(workspace.teams[0]?.visibility, "private");
    assert.equal(workspace.teams[1]?.visibility, "workspace");
    assert.equal(workspace.workflowStates[0]?.teamId, "team-1");
    assert.equal(workspace.labels[0]?.parentId, "label-parent");
    assert.deepEqual(workspace.issues[0]?.labelIds, ["label-1", "label-2"]);
    assert.equal(workspace.issues[0]?.stateId, "state-1");
    assert.equal(workspace.issues[0]?.projectId, "project-1");
    assert.equal("state" in workspace.issues[0]!, false);
    assert.deepEqual(workspace.projects[0]?.teamIds, ["team-1", "team-2"]);
    assert.equal(workspace.projects[0]?.summary, "Short summary");
    assert.equal(workspace.projects[0]?.description, "Long description");
    assert.equal(workspace.projects[0]?.statusId, "status-1");
    assert.equal("teams" in workspace.projects[0]!, false);
    assert.deepEqual(workspace.customViews[0]?.issueIds, ["issue-1", "issue-2"]);
    assert.equal(workspace.customViews[0]?.creatorId, "user-1");
    assert.equal(requests.filter((request) => operationName(request.query) === "LazyLinearIssueLabelsPage").length, 1);
    assert.equal(requests.filter((request) => operationName(request.query) === "LazyLinearProjectTeamsPage").length, 1);
    assert.equal(requests.filter((request) => operationName(request.query) === "LazyLinearCustomViewIssues").length, 1);
    assert.equal(requests.filter((request) => operationName(request.query) === "LazyLinearTeams").length, 2);
});

test("LinearWorkspaceAdapter custom-view fallback retains the Issue model contract", async () => {
    const customViewQueries: GraphQlRequestBody[] = [];
    const fetchImplementation = injectedFetch((body) => {
        const operation = operationName(body.query);
        if (operation === "LazyLinearCustomViews") {
            customViewQueries.push(body);
            assert.match(body.query, /filter: \{ modelName: \{ eq: "Issue" \} \}/u);
            if (customViewQueries.length === 1) {
                return jsonResponse({ errors: [{ message: 'Cannot query field "owner" on type "CustomView".' }] });
            }
            assert.doesNotMatch(body.query, /\bowner\s*\{/u);
            assert.doesNotMatch(body.query, /\bprojectFilterData\b/u);
            return jsonResponse({ data: { customViews: connection([
                { id: "view-issue", name: "Issue view", modelName: "Issue", filterData: {}, issues: connection([]) },
                { id: "view-project", name: "Project view", modelName: "Project", filterData: {}, issues: connection([]) },
            ]) } });
        }

        return emptyWorkspaceResponse(operation)
            ?? jsonResponse({ errors: [{ message: `Unexpected test operation ${operation}` }] }, 400);
    });
    const adapter = new LinearWorkspaceAdapter("lin_api_views", "https://linear.invalid/graphql", fetchImplementation);

    const workspace = await adapter.readWorkspace();

    assert.deepEqual(workspace.customViews.map((view) => view.id), ["view-issue"]);
    assert.equal(customViewQueries.length, 2);
});

test("LinearWorkspaceAdapter serializes every workspace command to the current Linear mutations", async () => {
    const requests: GraphQlRequestBody[] = [];
    const responses: Record<string, unknown> = {
        CreateIssue: { issueCreate: { success: true, issue: { id: "issue-new" } } },
        UpdateIssue: { issueUpdate: { success: true, issue: { id: "issue-1" } } },
        ArchiveIssue: { issueArchive: { success: true } },
        CreateProject: { projectCreate: { success: true, project: { id: "project-new" } } },
        UpdateProject: { projectUpdate: { success: true, project: { id: "project-1" } } },
        ArchiveProject: { projectArchive: { success: true } },
        CreateTeam: { teamCreate: { success: true, team: { id: "team-new" } } },
        UpdateTeam: { teamUpdate: { success: true, team: { id: "team-1" } } },
        DeleteTeam: { teamDelete: { success: true } },
        CreateCustomView: { customViewCreate: { success: true, customView: { id: "view-new" } } },
        UpdateCustomView: { customViewUpdate: { success: true, customView: { id: "view-1" } } },
        DeleteCustomView: { customViewDelete: { success: true } },
    };
    const fetchImplementation = injectedFetch((body) => {
        requests.push(body);
        const operation = operationName(body.query);
        const data = responses[operation];
        return data === undefined
            ? jsonResponse({ errors: [{ message: `Unexpected test operation ${operation}` }] }, 400)
            : jsonResponse({ data });
    });
    const adapter = new LinearWorkspaceAdapter("lin_api_mutations", "https://linear.invalid/graphql", fetchImplementation);

    assert.deepEqual(await adapter.commit({
        kind: "issue",
        action: "create",
        input: { title: "Create", teamId: "team-1", labelIds: ["label-1"], projectId: null },
    }), { action: "created", resource: { kind: "issue", id: "issue-new" } });
    assert.deepEqual(await adapter.commit({
        kind: "issue",
        action: "update",
        id: "issue-1",
        input: { priority: 2, assigneeId: null },
    }), { action: "updated", resource: { kind: "issue", id: "issue-1" } });
    assert.deepEqual(await adapter.commit({ kind: "issue", action: "archive", id: "issue-1" }), {
        action: "archived",
        resource: { kind: "issue", id: "issue-1" },
    });
    assert.deepEqual(await adapter.commit({
        kind: "project",
        action: "create",
        input: {
            name: "Engine",
            teamIds: ["team-1"],
            summary: "Short summary",
            description: "Long description",
            statusId: "status-1",
        },
    }), { action: "created", resource: { kind: "project", id: "project-new" } });
    await adapter.commit({ kind: "project", action: "update", id: "project-1", input: { summary: "Changed" } });
    await adapter.commit({ kind: "project", action: "archive", id: "project-1" });
    assert.deepEqual(await adapter.commit({
        kind: "team",
        action: "create",
        input: { name: "App", key: "APP", visibility: "private" },
    }), { action: "created", resource: { kind: "team", id: "team-new" } });
    await adapter.commit({ kind: "team", action: "update", id: "team-1", input: { visibility: "workspace" } });
    await adapter.commit({ kind: "team", action: "archive", id: "team-1" });
    assert.deepEqual(await adapter.commit({
        kind: "customView",
        action: "create",
        input: { name: "Urgent", shared: true, filterData: { priority: { eq: 1 } } },
    }), { action: "created", resource: { kind: "customView", id: "view-new" } });
    await adapter.commit({ kind: "customView", action: "update", id: "view-1", input: { shared: false } });
    assert.deepEqual(await adapter.commit({ kind: "customView", action: "delete", id: "view-1" }), {
        action: "deleted",
        resource: { kind: "customView", id: "view-1" },
    });

    assert.deepEqual(requests.map((request) => operationName(request.query)), Object.keys(responses));
    assert.match(requests[0]!.query, /\$input: IssueCreateInput!/u);
    assert.match(requests[0]!.query, /issueCreate\(input: \$input\)/u);
    assert.deepEqual(requests[0]?.variables, {
        input: { title: "Create", teamId: "team-1", projectId: null, labelIds: ["label-1"] },
    });
    assert.match(requests[1]!.query, /\$input: IssueUpdateInput!, \$id: String!/u);
    assert.match(requests[1]!.query, /issueUpdate\(id: \$id, input: \$input\)/u);
    assert.deepEqual(requests[1]?.variables, { id: "issue-1", input: { priority: 2, assigneeId: null } });
    assert.match(requests[2]!.query, /issueArchive\(id: \$id\)/u);
    assert.match(requests[3]!.query, /\$input: ProjectCreateInput!/u);
    assert.deepEqual(requests[3]?.variables, {
        input: {
            name: "Engine",
            teamIds: ["team-1"],
            description: "Short summary",
            content: "Long description",
            statusId: "status-1",
        },
    });
    assert.match(requests[4]!.query, /\$input: ProjectUpdateInput!, \$id: String!/u);
    assert.deepEqual(requests[4]?.variables, { id: "project-1", input: { description: "Changed" } });
    assert.match(requests[5]!.query, /projectArchive\(id: \$id\)/u);
    assert.match(requests[6]!.query, /\$input: TeamCreateInput!/u);
    assert.deepEqual(requests[6]?.variables, { input: { name: "App", key: "APP", private: true } });
    assert.match(requests[7]!.query, /\$input: TeamUpdateInput!, \$id: String!/u);
    assert.deepEqual(requests[7]?.variables, { id: "team-1", input: { private: false } });
    assert.match(requests[8]!.query, /teamDelete\(id: \$id\)/u);
    assert.match(requests[9]!.query, /\$input: CustomViewCreateInput!/u);
    assert.deepEqual(requests[9]?.variables, {
        input: { name: "Urgent", shared: true, filterData: { priority: { eq: 1 } } },
    });
    assert.match(requests[10]!.query, /\$input: CustomViewUpdateInput!, \$id: String!/u);
    assert.deepEqual(requests[10]?.variables, { id: "view-1", input: { shared: false } });
    assert.match(requests[11]!.query, /customViewDelete\(id: \$id\)/u);
});

test("LinearWorkspaceAdapter aggregates concurrent bootstrap rate limits deterministically", async () => {
    const operationOrder = [
        "LazyLinearViewer",
        "LazyLinearTeams",
        "LazyLinearUsers",
        "LazyLinearWorkflowStates",
        "LazyLinearIssueLabels",
        "LazyLinearProjectStatuses",
        "LazyLinearIssues",
        "LazyLinearProjects",
        "LazyLinearCustomViews",
    ];
    const resetBase = 1_800_000_000_000;
    const fetchImplementation = injectedFetch(async (body) => {
        const operation = operationName(body.query);
        const index = operationOrder.indexOf(operation);
        assert.notEqual(index, -1);
        await new Promise<void>((resolve) => setTimeout(resolve, operationOrder.length - index));
        const headers = {
            "x-ratelimit-requests-limit": "2500",
            "x-ratelimit-requests-remaining": String(100 - index),
            "x-ratelimit-requests-reset": String(resetBase + index * 1000),
            "x-complexity": String(index + 1),
            "x-ratelimit-complexity-limit": "3000000",
            "x-ratelimit-complexity-remaining": String(3_000_000 - index * 10),
        };
        return emptyWorkspaceResponse(operation, headers)
            ?? jsonResponse({ errors: [{ message: `Unexpected test operation ${operation}` }] }, 400);
    });
    const adapter = new LinearWorkspaceAdapter("lin_api_rates", "https://linear.invalid/graphql", fetchImplementation);

    const workspace = await adapter.readWorkspace();

    assert.deepEqual(workspace.rateLimit, {
        requestLimit: 2500,
        requestRemaining: 92,
        requestResetAt: new Date(resetBase + 8000).toISOString(),
        complexity: 45,
        complexityLimit: 3_000_000,
        complexityRemaining: 2_999_920,
    });
});

test("LinearWorkspaceAdapter maps expected provider errors to workspace failures", async () => {
    const resetAt = 1_800_000_000_000;
    const validationFetch = injectedFetch(() => jsonResponse({
        errors: [{
            message: "Internal validation detail",
            extensions: {
                code: "BAD_USER_INPUT",
                userPresentableMessage: "The issue input is invalid.",
            },
        }],
    }, 422, {
        "x-ratelimit-requests-remaining": "19",
        "x-ratelimit-requests-reset": String(resetAt),
    }));
    const validationAdapter = new LinearWorkspaceAdapter(
        "lin_api_validation",
        "https://linear.invalid/graphql",
        validationFetch,
    );

    await assert.rejects(
        validationAdapter.commit({
            kind: "issue",
            action: "create",
            input: { title: "Invalid", teamId: "team-1" },
        }),
        (error: unknown) => {
            assert.ok(error instanceof WorkspaceAdapterError);
            assert.deepEqual(error.failure, {
                code: "validation",
                message: "The issue input is invalid.",
                retryable: false,
                rateLimit: {
                    requestLimit: undefined,
                    requestRemaining: 19,
                    requestResetAt: new Date(resetAt).toISOString(),
                    complexity: undefined,
                    complexityLimit: undefined,
                    complexityRemaining: undefined,
                },
            });
            assert.ok(error.cause instanceof LinearApiError);
            return true;
        },
    );

    const userErrorAdapter = new LinearWorkspaceAdapter(
        "lin_api_user_error",
        "https://linear.invalid/graphql",
        injectedFetch(() => jsonResponse({
            errors: [{
                message: "The selected state does not belong to the issue team.",
                extensions: { userError: true },
            }],
        }, 400)),
    );
    await assert.rejects(
        userErrorAdapter.commit({ kind: "issue", action: "update", id: "issue-1", input: { stateId: "state-2" } }),
        (error: unknown) => error instanceof WorkspaceAdapterError
            && error.failure.code === "validation"
            && error.failure.message === "The selected state does not belong to the issue team.",
    );

    const networkCause = new Error("socket closed");
    const networkAdapter = new LinearWorkspaceAdapter(
        "lin_api_network",
        "https://linear.invalid/graphql",
        async () => {
            throw networkCause;
        },
    );
    await assert.rejects(
        networkAdapter.commit({ kind: "issue", action: "archive", id: "issue-1" }),
        (error: unknown) => {
            assert.ok(error instanceof WorkspaceAdapterError);
            assert.equal(error.failure.code, "unavailable");
            assert.equal(error.failure.retryable, true);
            assert.equal((error.cause as Error).cause, networkCause);
            return true;
        },
    );
});

test("LinearWorkspaceAdapter distinguishes unreadable and invalid provider contracts", async () => {
    const unreadableAdapter = new LinearWorkspaceAdapter(
        "lin_api_unreadable",
        "https://linear.invalid/graphql",
        async () => new Response("bad gateway", { status: 502 }),
    );
    await assert.rejects(
        unreadableAdapter.commit({ kind: "issue", action: "archive", id: "issue-1" }),
        (error: unknown) => {
            assert.ok(error instanceof WorkspaceAdapterError);
            assert.equal(error.failure.code, "unavailable");
            assert.equal(error.failure.retryable, true);
            return true;
        },
    );

    const missingDataAdapter = new LinearWorkspaceAdapter(
        "lin_api_empty",
        "https://linear.invalid/graphql",
        injectedFetch(() => jsonResponse({})),
    );
    await assert.rejects(
        missingDataAdapter.commit({ kind: "issue", action: "archive", id: "issue-1" }),
        (error: unknown) => {
            assert.ok(error instanceof WorkspaceAdapterError);
            assert.equal(error.failure.code, "externalContract");
            assert.equal(error.failure.retryable, false);
            return true;
        },
    );

    const invalidDocumentAdapter = new LinearWorkspaceAdapter(
        "lin_api_invalid_document",
        "https://linear.invalid/graphql",
        injectedFetch(() => jsonResponse({
            errors: [{
                message: "Cannot query field 'removedField' on type 'Issue'.",
                extensions: { code: "GRAPHQL_VALIDATION_FAILED" },
            }],
        }, 400)),
    );
    await assert.rejects(
        invalidDocumentAdapter.commit({ kind: "issue", action: "archive", id: "issue-1" }),
        (error: unknown) => error instanceof WorkspaceAdapterError
            && error.failure.code === "externalContract"
            && error.failure.retryable === false,
    );
});

test("LinearWorkspaceAdapter rejects unsuccessful, identifier-less, and cursor-less responses", async () => {
    const unsuccessful = new LinearWorkspaceAdapter(
        "lin_api_failed",
        "https://linear.invalid/graphql",
        injectedFetch(() => jsonResponse({ data: { issueCreate: { success: false } } })),
    );
    await assert.rejects(
        unsuccessful.commit({
            kind: "issue",
            action: "create",
            input: { title: "Nope", teamId: "team-1" },
        }),
        (error: unknown) => error instanceof WorkspaceAdapterError
            && error.failure.code === "externalContract"
            && /CreateIssue did not succeed/u.test(error.message),
    );

    const missingId = new LinearWorkspaceAdapter(
        "lin_api_missing_id",
        "https://linear.invalid/graphql",
        injectedFetch(() => jsonResponse({ data: { issueCreate: { success: true, issue: null } } })),
    );
    await assert.rejects(
        missingId.commit({
            kind: "issue",
            action: "create",
            input: { title: "No id", teamId: "team-1" },
        }),
        /succeeded but Linear returned no entity identifier/u,
    );

    const cursorless = new LinearWorkspaceAdapter(
        "lin_api_cursor",
        "https://linear.invalid/graphql",
        injectedFetch((body) => {
            const operation = operationName(body.query);
            if (operation === "LazyLinearIssues") {
                return jsonResponse({ data: { issues: connection([], true, null) } });
            }
            return emptyWorkspaceResponse(operation)
                ?? jsonResponse({ errors: [{ message: `Unexpected test operation ${operation}` }] }, 400);
        }),
    );
    await assert.rejects(
        cursorless.readWorkspace(),
        (error: unknown) => error instanceof WorkspaceAdapterError
            && error.failure.code === "externalContract"
            && /without a cursor/u.test(error.message),
    );
});