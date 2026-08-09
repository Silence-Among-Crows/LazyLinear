import assert from "node:assert/strict";
import test from "node:test";
import { stripVTControlCharacters } from "node:util";
import React from "react";
import { render } from "ink-testing-library";
import stringWidth from "string-width";
import { App } from "../src/app.js";

function jsonResponse(body: unknown): Response {
    return new Response(JSON.stringify(body), {
        status: 200,
        headers: { "Content-Type": "application/json" },
    });
}

function emptyConnection(): { nodes: never[]; pageInfo: { hasNextPage: false; endCursor: null } } {
    return {
        nodes: [],
        pageInfo: { hasNextPage: false, endCursor: null },
    };
}

async function flushRender(): Promise<void> {
    await new Promise<void>((resolve) => setImmediate(resolve));
    await new Promise<void>((resolve) => setImmediate(resolve));
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
}

async function press(screen: ReturnType<typeof render>, input: string): Promise<void> {
    screen.stdin.write(input);
    await flushRender();
}

function plainTextFrame(screen: ReturnType<typeof render>): string {
    const frame = screen.lastFrame() ?? "";
    return stripVTControlCharacters(frame);
}

async function waitForFrame(
    screen: ReturnType<typeof render>,
    predicate: (frame: string) => boolean,
): Promise<string> {
    let frame = plainTextFrame(screen);
    for (let attempt = 0; attempt < 30 && !predicate(frame); attempt += 1) {
        await flushRender();
        frame = plainTextFrame(screen);
    }
    return frame;
}

function overrideTerminalSize(width: number, height: number): () => void {
    const columnsDescriptor = Object.getOwnPropertyDescriptor(process.stdout, "columns");
    const rowsDescriptor = Object.getOwnPropertyDescriptor(process.stdout, "rows");
    Object.defineProperty(process.stdout, "columns", { configurable: true, value: width });
    Object.defineProperty(process.stdout, "rows", { configurable: true, value: height });
    return () => {
        if (columnsDescriptor) {
            Object.defineProperty(process.stdout, "columns", columnsDescriptor);
        } else {
            Reflect.deleteProperty(process.stdout, "columns");
        }
        if (rowsDescriptor) {
            Object.defineProperty(process.stdout, "rows", rowsDescriptor);
        } else {
            Reflect.deleteProperty(process.stdout, "rows");
        }
    };
}

function assertFrameFits(frame: string, width: number, height: number): void {
    const lines = frame.split("\n");
    assert.equal(lines.length, height);
    for (const line of lines) {
        assert.ok(stringWidth(line) <= width, `Rendered ${stringWidth(line)} columns into a ${width}-column terminal: ${line}`);
    }
    assert.doesNotMatch(frame, /\uFFFD|\[object Object\]|undefined/u);
}

test("demo TUI navigates, toggles board grouping, opens help, and unmounts", async (context) => {
    const screen = render(React.createElement(App, { demo: true }));
    let mounted = true;
    context.after(() => {
        if (mounted) {
            screen.unmount();
        }
    });

    await flushRender();

    const initial = plainTextFrame(screen);
    assert.match(initial, /Northstar Labs \/ My issues/u);
    assert.match(initial, /j\/k move · enter inspect/u);

    screen.stdin.write("j");
    await flushRender();
    const navigated = plainTextFrame(screen);
    assert.match(navigated, /Northstar Labs \/ All issues/u);
    assert.notEqual(navigated, initial);

    screen.stdin.write("2");
    await flushRender();
    const contentFocused = plainTextFrame(screen);
    assert.match(contentFocused, /enter inspect  n new  e edit  d remove/u);

    screen.stdin.write("b");
    await flushRender();
    const board = plainTextFrame(screen);
    assert.match(board, /group: status/u);
    assert.match(board, /h\/l column/u);

    screen.stdin.write("g");
    await flushRender();
    const regrouped = plainTextFrame(screen);
    assert.match(regrouped, /group: priority/u);
    assert.match(regrouped, /Urgent/u);

    screen.stdin.write("?");
    await flushRender();
    const help = plainTextFrame(screen);
    assert.match(help, /Keybindings/u);
    assert.match(help, /toggle list and board layout/u);
    assert.match(help, /enter\/esc close/u);

    assert.doesNotThrow(() => {
        screen.unmount();
        mounted = false;
    });
});

test("teams remain a real list when the prior collection was in board mode", async (context) => {
    const screen = render(React.createElement(App, { demo: true }));
    context.after(() => screen.unmount());
    await flushRender();

    await press(screen, "b");
    await press(screen, "j");
    await press(screen, "j");
    await press(screen, "j");

    const teams = plainTextFrame(screen);
    assert.match(teams, /Northstar Labs \/ All teams/u);
    assert.match(teams, /3 teams/u);
    assert.match(teams, /\[CORE\]\s+Core Platform/u);
    assert.match(teams, /\[APP\]\s+Product Experience/u);
    assert.match(teams, /\[GROW\]\s+Growth/u);
    assert.match(teams, /teams use list view/u);
    assert.doesNotMatch(teams, /No board cards|group: status/u);
});

test("Space is a no-op for the selected issue while navigation is focused", async (context) => {
    const screen = render(React.createElement(App, { demo: true }));
    context.after(() => screen.unmount());
    await flushRender();

    const before = plainTextFrame(screen);
    assert.match(before, /CORE-134/u);
    assert.match(before, /Status\s+Todo/u);

    await press(screen, " ");
    const after = plainTextFrame(screen);
    assert.match(after, /CORE-134/u);
    assert.match(after, /Status\s+Todo/u);
    assert.doesNotMatch(after, /updated issue/u);
});

test("Space refuses to advance a canceled issue", async (context) => {
    const screen = render(React.createElement(App, { demo: true }));
    context.after(() => screen.unmount());
    await flushRender();

    await press(screen, "j");
    await press(screen, "/");
    await press(screen, "APP-76");
    await press(screen, "\r");
    await press(screen, "2");

    const selected = plainTextFrame(screen);
    assert.match(selected, /APP-76/u);
    assert.match(selected, /Status\s+Canceled/u);

    await press(screen, " ");
    const unchanged = plainTextFrame(screen);
    assert.match(unchanged, /APP-76/u);
    assert.match(unchanged, /Status\s+Canceled/u);
    assert.match(unchanged, /canceled issue cannot be advanced/u);
});

test("demo board moves preserve the selected issue while regrouping it", async (context) => {
    const screen = render(React.createElement(App, { demo: true }));
    context.after(() => screen.unmount());
    await flushRender();

    await press(screen, "j");
    await press(screen, "2");
    await press(screen, "k");
    await press(screen, "k");
    await press(screen, "b");
    const before = plainTextFrame(screen);
    assert.match(before, /In Progress/u);
    assert.match(before, /› Resume event stream/u);

    await press(screen, "L");
    const moved = plainTextFrame(screen);
    assert.match(moved, /In Review/u);
    assert.match(moved, /› Resume event stream/u);
});

test("44x18 content, inspector, and editor frames remain bounded and readable", async (context) => {
    const restoreTerminalSize = overrideTerminalSize(44, 18);
    context.after(restoreTerminalSize);
    const screen = render(React.createElement(App, { demo: true }));
    context.after(() => screen.unmount());
    await flushRender();

    await press(screen, "2");
    const content = plainTextFrame(screen);
    assertFrameFits(content, 44, 18);
    assert.match(content, /LL Northstar Labs \/ My issues\s+DEMO ready/u);
    assert.match(content, /2 My issues\s+ACTIVE/u);
    assert.match(content, /›!! CORE-134 Reject stale optimi…/u);
    assert.match(content, /3 items · 1–3/u);

    await press(screen, "3");
    const inspector = plainTextFrame(screen);
    assertFrameFits(inspector, 44, 18);
    assert.match(inspector, /3 Inspector\s+ACTIVE/u);
    assert.match(inspector, /CORE-134 Reject stale optimistic writes/u);
    assert.match(inspector, /Status\s+Todo/u);
    assert.match(inspector, /Team\s+Core Platform/u);
    assert.match(inspector, /Due \/ Est\s+— \/ 3/u);
    assert.doesNotMatch(inspector, /\n│\s+stimate/u);

    await press(screen, "2");
    await press(screen, "e");
    const editor = plainTextFrame(screen);
    assertFrameFits(editor, 44, 18);
    assert.match(editor, /◆ Edit CORE-134/u);
    assert.match(editor, /Fields marked \* are required\./u);
    assert.match(editor, /› Title \*\s+…t stale optimistic writes▌/u);
    assert.match(editor, /Description\s+Use entity update time…/u);
    assert.match(editor, /Team \*\s+‹ CORE · Core Platform ›/u);
    assert.match(editor, /^\s*╚═+╝\s*$/mu);
    assert.doesNotMatch(editor, / ields|═ save · esc cancel/u);
});

test("token modal validates, saves an opted-in credential, and reports an unexpectedly rejected workspace refresh", async (context) => {
    const personalApiKey = "lin_api_modal_personal";
    const authorizationHeaders: string[] = [];
    const persistedTokens: string[] = [];
    let persistenceAttemptCount = 0;
    let returnInvalidWorkspaceContract = false;
    const linearFetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
        assert.equal(input, "https://api.linear.app/graphql");
        assert.equal(init?.method, "POST");
        authorizationHeaders.push(new Headers(init?.headers).get("Authorization") ?? "");

        if (typeof init?.body !== "string") {
            assert.fail("Expected the Linear GraphQL body to be a JSON string.");
        }
        const body = JSON.parse(init.body) as { query: string };
        const operation = /\bquery\s+([A-Za-z0-9_]+)/u.exec(body.query)?.[1];
        if (operation === "LazyLinearViewer") {
            if (returnInvalidWorkspaceContract) {
                return jsonResponse({ data: { viewer: null } });
            }
            return jsonResponse({
                data: {
                    viewer: {
                        id: "viewer-authenticated",
                        name: "Authenticated User",
                        displayName: "Authenticated User",
                        email: "authenticated@example.com",
                        organization: {
                            id: "workspace-authenticated",
                            name: "Authenticated Workspace",
                            urlKey: "authenticated",
                        },
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
            LazyLinearCustomViews: "customViews",
        };
        const field = operation ? fields[operation] : undefined;
        if (!field) {
            assert.fail(`Unexpected Linear bootstrap operation: ${operation ?? "unnamed"}`);
        }
        return jsonResponse({ data: { [field]: emptyConnection() } });
    };

    const screen = render(React.createElement(App, {
        linearFetch,
        persistLinearApiKey: async (token: string) => {
            persistenceAttemptCount += 1;
            if (persistenceAttemptCount === 1) {
                throw new Error("The credential file could not be updated.");
            }
            persistedTokens.push(token);
        },
    }));
    context.after(() => {
        screen.unmount();
    });
    await flushRender();

    const tokenPrompt = plainTextFrame(screen);
    assert.match(tokenPrompt, /Connect to Linear/u);
    assert.match(tokenPrompt, /Paste a personal API key or OAuth access token/u);

    await press(screen, personalApiKey);
    await press(screen, "\r");

    const persistencePrompt = await waitForFrame(
        screen,
        (frame) => frame.includes("Remember Linear token?"),
    );
    assert.match(persistencePrompt, /Save this token as LINEAR_API_KEY in ~\/\.lazylinear\/\.env/u);
    assert.match(persistencePrompt, /stored in plain text/u);
    assert.deepEqual(persistedTokens, []);

    await press(screen, "y");
    const failedPersistence = await waitForFrame(
        screen,
        (frame) => frame.includes("The credential file could not be updated."),
    );
    assert.match(failedPersistence, /Remember Linear token/u);
    assert.equal(persistenceAttemptCount, 1);
    assert.equal(authorizationHeaders.length, 9);
    assert.deepEqual(persistedTokens, []);

    await press(screen, "y");

    let authenticatedFrame = plainTextFrame(screen);
    for (let attempt = 0; attempt < 20 && !authenticatedFrame.includes("Authenticated Workspace"); attempt += 1) {
        await flushRender();
        authenticatedFrame = plainTextFrame(screen);
    }

    assert.match(authenticatedFrame, /Authenticated Workspace \/ My issues/u);
    assert.doesNotMatch(authenticatedFrame, /Connect to Linear/u);
    assert.equal(authorizationHeaders.length, 9);
    assert.deepEqual(authorizationHeaders, Array(9).fill(personalApiKey));
    assert.equal(persistenceAttemptCount, 2);
    assert.deepEqual(persistedTokens, [personalApiKey]);

    returnInvalidWorkspaceContract = true;
    await press(screen, "r");
    const failedRefresh = await waitForFrame(
        screen,
        (frame) => frame.includes("Unable to refresh the workspace:"),
    );
    assert.match(failedRefresh, /Unable to refresh the workspace:/u);
});

test("an invalid manually entered token is never offered for persistence", async (context) => {
    const persistedTokens: string[] = [];
    const screen = render(React.createElement(App, {
        linearFetch: async () => new Response(JSON.stringify({
            errors: [{ message: "The Linear credential was rejected." }],
        }), {
            status: 401,
            headers: { "Content-Type": "application/json" },
        }),
        persistLinearApiKey: async (token: string) => {
            persistedTokens.push(token);
        },
    }));
    context.after(() => screen.unmount());
    await flushRender();

    await press(screen, "lin_api_invalid");
    await press(screen, "\r");
    const rejected = await waitForFrame(
        screen,
        (frame) => frame.includes("The Linear credential was rejected."),
    );

    assert.match(rejected, /Connect to Linear/u);
    assert.doesNotMatch(rejected, /Remember Linear token/u);
    assert.deepEqual(persistedTokens, []);
});

test("horizontal-only terminal changes are detected when a remote PTY emits no resize event", async (context) => {
    const restoreTerminalSize = overrideTerminalSize(100, 24);
    context.after(restoreTerminalSize);
    const output = process.stdout as typeof process.stdout & { _refreshSize?: () => void };
    const refreshDescriptor = Object.getOwnPropertyDescriptor(output, "_refreshSize");
    let backingWidth = 100;
    Object.defineProperty(output, "_refreshSize", {
        configurable: true,
        value: () => {
            Object.defineProperty(output, "columns", { configurable: true, value: backingWidth });
        },
    });
    context.after(() => {
        if (refreshDescriptor) {
            Object.defineProperty(output, "_refreshSize", refreshDescriptor);
        } else {
            Reflect.deleteProperty(output, "_refreshSize");
        }
    });
    const screen = render(React.createElement(App, { demo: true }));
    context.after(() => screen.unmount());
    await flushRender();

    const wide = plainTextFrame(screen);
    assertFrameFits(wide, 100, 24);
    assert.match(wide, /1 Navigation/u);
    assert.match(wide, /2 My issues/u);
    assert.match(wide, /3 Inspector/u);

    backingWidth = 70;
    await new Promise<void>((resolve) => setTimeout(resolve, 280));
    await flushRender();

    const twoPanel = plainTextFrame(screen);
    assertFrameFits(twoPanel, 70, 24);
    assert.match(twoPanel, /1 Navigation/u);
    assert.match(twoPanel, /2 My issues/u);
    assert.doesNotMatch(twoPanel, /3 Inspector/u);

    backingWidth = 60;
    await new Promise<void>((resolve) => setTimeout(resolve, 280));
    await flushRender();

    const narrow = plainTextFrame(screen);
    assertFrameFits(narrow, 60, 24);
    assert.match(narrow, /1 Navigation/u);
    assert.doesNotMatch(narrow, /2 My issues|3 Inspector/u);
});

test("board columns remain navigable while the navigation panel has focus", async (context) => {
    const screen = render(React.createElement(App, { demo: true }));
    context.after(() => screen.unmount());
    await flushRender();

    await press(screen, "j");
    await press(screen, "b");
    await press(screen, "h");
    assert.match(plainTextFrame(screen), /› Reject stale optimistic writes/u);

    await press(screen, "l");
    const moved = plainTextFrame(screen);
    assert.match(moved, /› Resume event stream after a dropped connection/u);
    assert.doesNotMatch(moved, /› Reject stale optimistic writes/u);
});

test("demo journey creates, edits, moves, and archives one issue through the workspace session", async (context) => {
    const screen = render(React.createElement(App, { demo: true }));
    context.after(() => screen.unmount());
    await waitForFrame(screen, (frame) => frame.includes("Northstar Labs / My issues"));

    await press(screen, "2");
    await press(screen, "n");
    assert.match(plainTextFrame(screen), /Create issue/u);
    await press(screen, "Architectural flow");
    await press(screen, "\x13");
    let frame = await waitForFrame(screen, (candidate) => candidate.includes("Architectural flow") && !candidate.includes("Create issue"));
    assert.match(frame, /Architectural flow/u);

    await press(screen, "e");
    await press(screen, " v2");
    await press(screen, "\x13");
    frame = await waitForFrame(screen, (candidate) => candidate.includes("Architectural flow v2") && !candidate.includes("Edit CORE"));
    assert.match(frame, /Architectural flow v2/u);

    await press(screen, "b");
    await press(screen, "L");
    frame = await waitForFrame(screen, (candidate) => candidate.includes("Architectural flow v2") && candidate.includes("updated issue"));
    assert.match(frame, /Architectural flow v2/u);

    await press(screen, "d");
    assert.match(plainTextFrame(screen), /Confirm this destructive action/u);
    await press(screen, "y");
    frame = await waitForFrame(screen, (candidate) => candidate.includes("archived issue") && !candidate.includes("Architectural flow v2"));
    assert.doesNotMatch(frame, /Architectural flow v2/u);
});