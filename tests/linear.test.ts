import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { LinearApi, LinearApiError } from "../lib/linear.js";

interface GraphQlRequestBody {
    query: string;
    variables: Record<string, unknown>;
}

const nativeFetch = globalThis.fetch;

afterEach(() => {
    globalThis.fetch = nativeFetch;
});

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

function connection<T>(nodes: T[], hasNextPage = false, endCursor: string | null = null) {
    return { nodes, pageInfo: { hasNextPage, endCursor } };
}

function emptyBootstrapResponse(operation: string): Response | undefined {
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
        });
    }

    const fields: Record<string, string> = {
        LazyLinearTeams: "teams",
        LazyLinearUsers: "users",
        LazyLinearWorkflowStates: "workflowStates",
        LazyLinearIssueLabels: "issueLabels",
        LazyLinearProjectStatuses: "projectStatuses",
        LazyLinearIssues: "issues",
        LazyLinearProjects: "projects",
    };
    const field = fields[operation];
    return field ? jsonResponse({ data: { [field]: connection([]) } }) : undefined;
}

test("LinearApi rejects an empty credential before making a request", () => {
    assert.throws(() => new LinearApi("  \t "), (error: unknown) => {
        assert.ok(error instanceof LinearApiError);
        assert.match(error.message, /API key or OAuth access token is required/u);
        return true;
    });
});

test("LinearApi sends the correct Authorization form for API keys and OAuth tokens", async () => {
    const cases = [
        { token: "  lin_api_personal  ", expected: "lin_api_personal" },
        { token: "oauth-access-token", expected: "Bearer oauth-access-token" },
        { token: "  Bearer already-prefixed  ", expected: "Bearer already-prefixed" },
    ];

    for (const { token, expected } of cases) {
        let requestCount = 0;
        globalThis.fetch = (async (input, init) => {
            requestCount += 1;
            assert.equal(input, "https://linear.invalid/graphql");
            assert.equal(init?.method, "POST");
            const headers = new Headers(init?.headers);
            assert.equal(headers.get("Accept"), "application/json");
            assert.equal(headers.get("Content-Type"), "application/json");
            assert.equal(headers.get("Authorization"), expected);
            return jsonResponse({ data: { issueCreate: { success: true, issue: { id: "issue-created" } } } });
        }) as typeof fetch;

        const api = new LinearApi(token, "https://linear.invalid/graphql");
        assert.equal(await api.createIssue({ title: "Transport test", teamId: "team-1" }), "issue-created");
        assert.equal(requestCount, 1);
    }
});

test("LinearApi bootstrap paginates nested issue labels and project teams", async () => {
    const requests: GraphQlRequestBody[] = [];
    globalThis.fetch = (async (_input, init) => {
        const body = requestBody(init);
        requests.push(body);
        const operation = operationName(body.query);

        if (operation === "LazyLinearTeams") {
            assert.match(body.query, /\bvisibility\b/u);
            assert.doesNotMatch(body.query, /\bprivate\b/u);
            return jsonResponse({
                data: {
                    teams: connection([{
                        id: "team-1",
                        name: "Core",
                        key: "CORE",
                        visibility: "private",
                    }]),
                },
            });
        }
        if (operation === "LazyLinearIssues") {
            assert.match(body.query, /issues\(first: 50,/u);
            assert.match(body.query, /labels\(first: 10\)/u);
            assert.match(body.query, /labels\(first: 10\)[\s\S]*pageInfo \{ hasNextPage endCursor \}/u);
            return jsonResponse({
                data: {
                    issues: connection([{
                        id: "issue-1",
                        identifier: "TEST-1",
                        title: "Paginated labels",
                        priority: 2,
                        state: { id: "state-1", name: "Todo", type: "unstarted", color: "#aaaaaa" },
                        team: { id: "team-1", name: "Core", key: "CORE" },
                        labels: connection(
                            [{ id: "label-1", name: "First", color: "#111111" }],
                            true,
                            "issue-label-cursor",
                        ),
                    }]),
                },
            });
        }
        if (operation === "LazyLinearIssueLabelsPage") {
            assert.deepEqual(body.variables, { id: "issue-1", after: "issue-label-cursor" });
            assert.match(body.query, /labels\(first: 10,/u);
            return jsonResponse({
                data: {
                    issue: {
                        labels: connection([{ id: "label-2", name: "Second", color: "#222222" }]),
                    },
                },
            });
        }
        if (operation === "LazyLinearProjects") {
            assert.match(body.query, /projects\(first: 100,/u);
            assert.match(body.query, /teams\(first: 10\)/u);
            assert.match(body.query, /teams\(first: 10\)[\s\S]*pageInfo \{ hasNextPage endCursor \}/u);
            return jsonResponse({
                data: {
                    projects: connection([{
                        id: "project-1",
                        name: "Paginated teams",
                        description: "Short summary",
                        content: "Long description",
                        color: "#333333",
                        status: { id: "status-1", name: "Started", type: "started", color: "#444444" },
                        teams: connection(
                            [{ id: "team-1", name: "Core", key: "CORE" }],
                            true,
                            "project-team-cursor",
                        ),
                    }]),
                },
            });
        }
        if (operation === "LazyLinearProjectTeamsPage") {
            assert.deepEqual(body.variables, { id: "project-1", after: "project-team-cursor" });
            assert.match(body.query, /teams\(first: 10,/u);
            return jsonResponse({
                data: {
                    project: {
                        teams: connection([{ id: "team-2", name: "App", key: "APP" }]),
                    },
                },
            });
        }
        if (operation === "LazyLinearCustomViews") {
            assert.match(body.query, /filter: \{ modelName: \{ eq: "Issue" \} \}/u);
            assert.match(body.query, /\bmodelName\b/u);
            assert.match(body.query, /customViews\(first: 25,/u);
            assert.match(body.query, /issues\(first: 50\)/u);
            return jsonResponse({ data: { customViews: connection([]) } });
        }

        const response = emptyBootstrapResponse(operation);
        return response ?? jsonResponse({ errors: [{ message: `Unexpected test operation ${operation}` }] }, 400);
    }) as typeof fetch;

    const workspace = await new LinearApi("lin_api_bootstrap", "https://linear.invalid/graphql").bootstrap();

    assert.deepEqual(workspace.issues[0]?.labels.map((label) => label.id), ["label-1", "label-2"]);
    assert.deepEqual(workspace.projects[0]?.teams.map((team) => team.id), ["team-1", "team-2"]);
    assert.equal(workspace.teams[0]?.private, true);
    assert.equal(requests.filter((body) => operationName(body.query) === "LazyLinearIssueLabelsPage").length, 1);
    assert.equal(requests.filter((body) => operationName(body.query) === "LazyLinearProjectTeamsPage").length, 1);
});

test("LinearApi custom-view fallback preserves the required Issue model contract", async () => {
    const customViewQueries: GraphQlRequestBody[] = [];
    globalThis.fetch = (async (_input, init) => {
        const body = requestBody(init);
        const operation = operationName(body.query);
        if (operation === "LazyLinearCustomViews") {
            customViewQueries.push(body);
            assert.match(body.query, /filter: \{ modelName: \{ eq: "Issue" \} \}/u);
            assert.match(body.query, /\bmodelName\b/u);
            if (customViewQueries.length === 1) {
                return jsonResponse({
                    errors: [{ message: 'Cannot query field "owner" on type "CustomView".' }],
                });
            }
            assert.doesNotMatch(body.query, /\bowner\s*\{/u);
            assert.doesNotMatch(body.query, /\bprojectFilterData\b/u);
            return jsonResponse({
                data: {
                    customViews: connection([
                        {
                            id: "view-issue",
                            name: "Issue view",
                            modelName: "Issue",
                            filterData: {},
                            issues: connection([]),
                        },
                        {
                            id: "view-project",
                            name: "Project view",
                            modelName: "Project",
                            filterData: {},
                            issues: connection([]),
                        },
                    ]),
                },
            });
        }

        const response = emptyBootstrapResponse(operation);
        return response ?? jsonResponse({ errors: [{ message: `Unexpected test operation ${operation}` }] }, 400);
    }) as typeof fetch;

    const workspace = await new LinearApi("lin_api_views", "https://linear.invalid/graphql").bootstrap();

    assert.deepEqual(workspace.customViews.map((view) => [view.id, view.modelName]), [["view-issue", "Issue"]]);
    assert.equal(customViewQueries.length, 2);
});

test("LinearApi serializes create, update, archive, and custom-view delete mutations", async () => {
    const requests: GraphQlRequestBody[] = [];
    globalThis.fetch = (async (_input, init) => {
        const body = requestBody(init);
        requests.push(body);
        if (body.query.includes("mutation CreateIssue")) {
            return jsonResponse({ data: { issueCreate: { success: true, issue: { id: "issue-new" } } } });
        }
        if (body.query.includes("mutation UpdateIssue")) {
            return jsonResponse({ data: { issueUpdate: { success: true, issue: { id: "issue-7" } } } });
        }
        if (body.query.includes("mutation ArchiveIssue")) {
            return jsonResponse({ data: { issueArchive: { success: true } } });
        }
        if (body.query.includes("mutation DeleteCustomView")) {
            return jsonResponse({ data: { customViewDelete: { success: true } } });
        }
        return jsonResponse({ errors: [{ message: "Unexpected test operation" }] }, 400);
    }) as typeof fetch;

    const api = new LinearApi("lin_api_transport", "https://linear.invalid/graphql");
    const createInput = {
        title: "Create over GraphQL",
        teamId: "team-1",
        projectId: null,
        labelIds: ["label-1"],
    };
    assert.equal(await api.createIssue(createInput), "issue-new");
    assert.equal(await api.updateIssue("issue-7", { priority: 2, assigneeId: null }), "issue-7");
    await api.deleteIssue("issue-7");
    await api.deleteCustomView("view-3");

    assert.equal(requests.length, 4);
    assert.match(requests[0]!.query, /\$input: IssueCreateInput!/u);
    assert.match(requests[0]!.query, /issueCreate\(input: \$input\)/u);
    assert.deepEqual(requests[0]!.variables, { input: createInput });
    assert.match(requests[1]!.query, /\$input: IssueUpdateInput!, \$id: String!/u);
    assert.match(requests[1]!.query, /issueUpdate\(id: \$id, input: \$input\)/u);
    assert.deepEqual(requests[1]!.variables, { id: "issue-7", input: { priority: 2, assigneeId: null } });
    assert.match(requests[2]!.query, /issueArchive\(id: \$id\)/u);
    assert.deepEqual(requests[2]!.variables, { id: "issue-7" });
    assert.match(requests[3]!.query, /customViewDelete\(id: \$id\)/u);
    assert.deepEqual(requests[3]!.variables, { id: "view-3" });
});

test("LinearApi uses current project, team, and custom-view mutation contracts", async () => {
    const requests: GraphQlRequestBody[] = [];
    globalThis.fetch = (async (_input, init) => {
        const body = requestBody(init);
        requests.push(body);
        const responses: Record<string, unknown> = {
            CreateProject: { projectCreate: { success: true, project: { id: "project-new" } } },
            UpdateProject: { projectUpdate: { success: true, project: { id: "project-new" } } },
            DeleteProject: { projectDelete: { success: true } },
            CreateTeam: { teamCreate: { success: true, team: { id: "team-new" } } },
            UpdateTeam: { teamUpdate: { success: true, team: { id: "team-new" } } },
            DeleteTeam: { teamDelete: { success: true } },
            CreateCustomView: { customViewCreate: { success: true, customView: { id: "view-new" } } },
            UpdateCustomView: { customViewUpdate: { success: true, customView: { id: "view-new" } } },
        };
        const data = responses[operationName(body.query)];
        return data === undefined
            ? jsonResponse({ errors: [{ message: "Unexpected test operation" }] }, 400)
            : jsonResponse({ data });
    }) as typeof fetch;

    const api = new LinearApi("lin_api_core_mutations", "https://linear.invalid/graphql");
    const projectInput = {
        name: "Terminal client",
        teamIds: ["team-1", "team-2"],
        description: "Short summary",
        content: "Long description",
        statusId: "project-status-started",
    };
    const customViewInput = {
        name: "Urgent work",
        shared: true,
        filterData: { priority: { eq: 1 } },
    };

    assert.equal(await api.createProject(projectInput), "project-new");
    assert.equal(await api.updateProject("project-new", { statusId: "project-status-completed" }), "project-new");
    await api.deleteProject("project-new");
    assert.equal(await api.createTeam({ name: "Application", key: "APP", private: false }), "team-new");
    assert.equal(await api.updateTeam("team-new", { description: "Owns the app" }), "team-new");
    await api.deleteTeam("team-new");
    assert.equal(await api.createCustomView(customViewInput), "view-new");
    assert.equal(await api.updateCustomView("view-new", { shared: false }), "view-new");

    assert.deepEqual(requests.map((request) => operationName(request.query)), [
        "CreateProject",
        "UpdateProject",
        "DeleteProject",
        "CreateTeam",
        "UpdateTeam",
        "DeleteTeam",
        "CreateCustomView",
        "UpdateCustomView",
    ]);
    assert.match(requests[0]!.query, /\$input: ProjectCreateInput!/u);
    assert.deepEqual(requests[0]!.variables, { input: projectInput });
    assert.match(requests[1]!.query, /\$input: ProjectUpdateInput!/u);
    assert.match(requests[2]!.query, /projectDelete\(id: \$id\)/u);
    assert.match(requests[3]!.query, /\$input: TeamCreateInput!/u);
    assert.match(requests[4]!.query, /\$input: TeamUpdateInput!/u);
    assert.match(requests[5]!.query, /teamDelete\(id: \$id\)/u);
    assert.match(requests[6]!.query, /\$input: CustomViewCreateInput!/u);
    assert.deepEqual(requests[6]!.variables, { input: customViewInput });
    assert.match(requests[7]!.query, /\$input: CustomViewUpdateInput!/u);
});

test("LinearApi exposes GraphQL and rate-limit details on HTTP failures", async () => {
    const resetAt = 1_800_000_000_000;
    globalThis.fetch = (async () => jsonResponse(
        {
            errors: [{
                message: "Internal validation detail",
                path: ["issueCreate"],
                extensions: {
                    code: "BAD_USER_INPUT",
                    userError: true,
                    userPresentableMessage: "The issue input is invalid.",
                },
            }],
        },
        422,
        {
            "x-ratelimit-requests-limit": "2500",
            "x-ratelimit-requests-remaining": "19",
            "x-ratelimit-requests-reset": String(resetAt),
            "x-complexity": "73",
            "x-ratelimit-complexity-limit": "3000000",
            "x-ratelimit-complexity-remaining": "2999927",
        },
    )) as typeof fetch;
    const api = new LinearApi("lin_api_errors");

    await assert.rejects(
        api.createIssue({ title: "Invalid", teamId: "team-1" }),
        (error: unknown) => {
            assert.ok(error instanceof LinearApiError);
            assert.equal(error.message, "The issue input is invalid.");
            assert.equal(error.code, "BAD_USER_INPUT");
            assert.equal(error.status, 422);
            assert.equal(error.graphQlErrors.length, 1);
            assert.equal(error.rateLimit?.requestRemaining, 19);
            assert.equal(error.rateLimit?.requestResetAt?.getTime(), resetAt);
            return true;
        },
    );
    assert.deepEqual(api.lastRateLimit, {
        requestLimit: 2500,
        requestRemaining: 19,
        requestResetAt: new Date(resetAt),
        complexity: 73,
        complexityLimit: 3_000_000,
        complexityRemaining: 2_999_927,
    });
});

test("LinearApi distinguishes network, unreadable-response, and missing-data failures", async () => {
    const networkCause = new Error("socket closed");
    globalThis.fetch = (async () => {
        throw networkCause;
    }) as typeof fetch;
    await assert.rejects(
        new LinearApi("lin_api_network").deleteIssue("issue-1"),
        (error: unknown) => {
            assert.ok(error instanceof LinearApiError);
            assert.match(error.message, /Unable to reach Linear/u);
            assert.equal(error.cause, networkCause);
            return true;
        },
    );

    globalThis.fetch = (async () => new Response("bad gateway", { status: 502 })) as typeof fetch;
    await assert.rejects(
        new LinearApi("lin_api_unreadable").deleteIssue("issue-1"),
        (error: unknown) => {
            assert.ok(error instanceof LinearApiError);
            assert.equal(error.message, "Linear returned an unreadable response (502).");
            assert.equal(error.status, 502);
            return true;
        },
    );

    globalThis.fetch = (async () => jsonResponse({})) as typeof fetch;
    await assert.rejects(
        new LinearApi("lin_api_empty").deleteIssue("issue-1"),
        /Linear returned no data for the request/u,
    );
});

test("LinearApi rejects unsuccessful or identifier-less mutation payloads", async () => {
    globalThis.fetch = (async () => jsonResponse({ data: { issueCreate: { success: false } } })) as typeof fetch;
    await assert.rejects(
        new LinearApi("lin_api_failed").createIssue({ title: "Nope", teamId: "team-1" }),
        /CreateIssue did not succeed/u,
    );

    globalThis.fetch = (async () => jsonResponse({ data: { issueCreate: { success: true, issue: null } } })) as typeof fetch;
    await assert.rejects(
        new LinearApi("lin_api_missing_id").createIssue({ title: "No id", teamId: "team-1" }),
        /succeeded but Linear returned no entity identifier/u,
    );

    globalThis.fetch = (async () => jsonResponse({ data: { issueArchive: { success: false } } })) as typeof fetch;
    await assert.rejects(
        new LinearApi("lin_api_archive").deleteIssue("issue-1"),
        /ArchiveIssue did not succeed/u,
    );
});