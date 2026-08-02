import React, {
    useCallback,
    useEffect,
    useMemo,
    useReducer,
    useRef,
    useState,
    useSyncExternalStore,
} from "react";
import { Box, useApp, useInput } from "ink";
import { LinearWorkspaceAdapter } from "../lib/linear.js";
import type { LinearFetch } from "../lib/linear-graphql-transport.js";
import type {
    ViewMode,
    WorkspaceResourceReference,
    WorkspaceSnapshot,
} from "../lib/types.js";
import { identifyCommand } from "./commands.js";
import { DemoWorkspaceAdapter } from "./demo-workspace-adapter.js";
import {
    type ContentResource,
    type GroupBy,
    type NavigationTarget,
    buildAdvanceIssueChange,
    buildMoveAcrossGroupChange,
    clampIndex,
    createWorkspaceProjection,
    filterResources,
    groupResources,
    isCustomView,
    isIssue,
} from "./domain.js";
import type { EditorContext, EditorKind, EditorTarget } from "./editor/types.js";
import {
    initialInteractionState,
    interactionReducer,
    type WorkspaceResource,
} from "./interaction-state.js";
import { ConfirmModal, EditorModal, HelpModal, TokenModal } from "./modals.js";
import {
    ContentPanel,
    DetailPanel,
    Footer,
    Header,
    NavigationPanel,
    colors,
} from "./ui.js";
import {
    ObservableWorkspaceSession,
    type WorkspaceSession,
    type WorkspaceState,
} from "./workspace-session.js";

interface TerminalSize {
    readonly width: number;
    readonly height: number;
}

interface RefreshableTerminalOutput {
    readonly _refreshSize?: () => void;
}

const TERMINAL_SIZE_POLL_INTERVAL_MS = 200;

export interface AppProps {
    readonly initialToken?: string;
    readonly demo?: boolean;
    readonly linearFetch?: LinearFetch;
}

function terminalSize(): TerminalSize {
    return {
        width: Math.max(44, process.stdout.columns ?? 120),
        height: Math.max(18, process.stdout.rows ?? 40),
    };
}

function useTerminalSize(): TerminalSize {
    const [size, setSize] = useState(terminalSize);
    useEffect(() => {
        const output = process.stdout as typeof process.stdout & RefreshableTerminalOutput;
        let observed = terminalSize();
        function handleResize(): void {
            const next = terminalSize();
            observed = next;
            setSize((current) => current.width === next.width && current.height === next.height ? current : next);
        }
        function pollTerminalSize(): void {
            try {
                output._refreshSize?.();
            } catch {
                // Some remote TTYs expose this hook without a queryable backing handle.
            }
            const next = terminalSize();
            if (next.width !== observed.width || next.height !== observed.height) {
                output.emit("resize");
            }
        }
        const poll = setInterval(pollTerminalSize, TERMINAL_SIZE_POLL_INTERVAL_MS);
        poll.unref();
        output.on("resize", handleResize);
        return () => {
            clearInterval(poll);
            output.off("resize", handleResize);
        };
    }, []);
    return size;
}

function snapshotFromState(state: WorkspaceState): WorkspaceSnapshot | undefined {
    return state.phase === "initial" ? undefined : state.snapshot;
}

function navigationTargetsMatch(left: NavigationTarget, right: NavigationTarget): boolean {
    if (left.kind !== right.kind) {
        return false;
    }
    if (left.kind === "teamIssues" && right.kind === "teamIssues") {
        return left.teamId === right.teamId;
    }
    if (left.kind === "projectIssues" && right.kind === "projectIssues") {
        return left.projectId === right.projectId;
    }
    if (left.kind === "customView" && right.kind === "customView") {
        return left.customViewId === right.customViewId;
    }
    return true;
}

function resourceReference(resource: WorkspaceResource): WorkspaceResourceReference {
    switch (resource.kind) {
        case "issue":
            return { kind: "issue", id: resource.id };
        case "project":
            return { kind: "project", id: resource.id };
        case "team":
            return { kind: "team", id: resource.id };
        case "customView":
            return { kind: "customView", id: resource.id };
    }
}

function editorTargetForResource(resource: ContentResource): EditorTarget {
    switch (resource.kind) {
        case "issue":
            return { mode: "edit", kind: "issue", resource };
        case "project":
            return { mode: "edit", kind: "project", resource };
        case "team":
            return { mode: "edit", kind: "team", resource };
        case "customView":
            return { mode: "edit", kind: "customView", resource };
    }
}

function createEditorTarget(kind: EditorKind, context: EditorContext): EditorTarget {
    switch (kind) {
        case "issue":
            return { mode: "create", kind: "issue", context };
        case "project":
            return { mode: "create", kind: "project", context };
        case "team":
            return { mode: "create", kind: "team", context };
        case "customView":
            return { mode: "create", kind: "customView", context };
    }
}

function resourceTitle(resource: WorkspaceResource): string {
    return resource.kind === "issue" ? `${resource.identifier} ${resource.title}` : resource.name;
}

function WorkspaceScreen(props: {
    readonly session: WorkspaceSession;
    readonly size: TerminalSize;
}) {
    const { exit } = useApp();
    const subscribe = useCallback(
        (listener: () => void) => props.session.subscribe(listener),
        [props.session],
    );
    const workspaceState = useSyncExternalStore(subscribe, () => props.session.state, () => props.session.state);
    const availableSnapshot = snapshotFromState(workspaceState);
    if (!availableSnapshot) {
        throw new Error("WorkspaceScreen requires a successfully loaded session.");
    }
    const snapshot: WorkspaceSnapshot = availableSnapshot;

    const [interaction, dispatch] = useReducer(interactionReducer, initialInteractionState);
    const [operationError, setOperationError] = useState("");
    const projection = useMemo(() => createWorkspaceProjection(snapshot), [snapshot]);
    const navigation = projection.navigation;
    const rememberedNavigationIndex = navigation.findIndex((entry) => navigationTargetsMatch(entry.target, interaction.navigation));
    const safeNavigationIndex = rememberedNavigationIndex >= 0 ? rememberedNavigationIndex : 0;
    const activeNavigation = navigation[safeNavigationIndex]!;
    const effectiveViewMode: ViewMode = activeNavigation.target.kind === "teams" ? "list" : interaction.viewMode;
    const effectiveGroupBy: GroupBy = activeNavigation.contentKind === "project" ? "status" : interaction.groupBy;
    const unfilteredContent = useMemo(
        () => projection.contentFor(activeNavigation),
        [projection, activeNavigation],
    );
    const content = useMemo(
        () => filterResources(unfilteredContent, interaction.search),
        [unfilteredContent, interaction.search],
    );
    const rememberedContentIndex = interaction.selectedResource
        ? content.findIndex((resource) => resource.id === interaction.selectedResource?.id
            && resource.kind === interaction.selectedResource.kind)
        : -1;
    const safeContentIndex = rememberedContentIndex >= 0 ? rememberedContentIndex : 0;
    const selectedResource = content[safeContentIndex];
    const groups = useMemo(
        () => groupResources(content, effectiveGroupBy),
        [content, effectiveGroupBy],
    );
    const changing = workspaceState.phase === "loading" || workspaceState.phase === "changing";
    const stale = workspaceState.phase === "stale";
    const providerFailure = workspaceState.phase === "stale"
        ? `Change committed; refresh required before more writes. Do not retry. ${workspaceState.failure.message}`
        : workspaceState.phase === "failed"
            ? workspaceState.failure.message
            : "";
    const visibleFailure = stale
        ? providerFailure
        : operationError || providerFailure;

    function runWorkspaceOperation(description: string, operation: () => Promise<void>): void {
        setOperationError("");
        void (async () => {
            try {
                await operation();
                setOperationError("");
            } catch (error) {
                const detail = error instanceof Error && error.message.trim().length > 0
                    ? error.message
                    : "An unexpected error occurred.";
                setOperationError(`Unable to ${description}: ${detail}`);
            }
        })();
    }

    useEffect(() => {
        dispatch({
            type: "workspaceReconciled",
            snapshot,
            visibleResources: content.map(resourceReference),
        });
    }, [
        snapshot,
        activeNavigation.id,
        interaction.search,
        interaction.selectedResource?.kind,
        interaction.selectedResource?.id,
        content,
    ]);

    useEffect(() => {
        if (workspaceState.phase === "ready" || workspaceState.phase === "stale") {
            if (workspaceState.outcome) {
                dispatch({ type: "workspaceOutcomeApplied", outcome: workspaceState.outcome });
            }
        }
    }, [workspaceState]);

    function selectNavigation(nextIndex: number): void {
        const target = navigation[clampIndex(nextIndex, navigation.length)];
        if (target) {
            dispatch({ type: "navigationSelected", target: target.target });
        }
    }

    function moveContent(delta: number): void {
        if (effectiveViewMode === "list" || !selectedResource) {
            const target = content[clampIndex(safeContentIndex + delta, content.length)];
            dispatch({ type: "resourceSelected", resource: target ? resourceReference(target) : undefined });
            return;
        }
        const group = groups.find((candidate) => candidate.items.some((item) => item.id === selectedResource.id));
        if (!group) {
            return;
        }
        const withinGroup = group.items.findIndex((item) => item.id === selectedResource.id);
        const target = group.items[clampIndex(withinGroup + delta, group.items.length)];
        if (target) {
            dispatch({ type: "resourceSelected", resource: resourceReference(target) });
        }
    }

    function moveBoardColumn(delta: number): void {
        if (effectiveViewMode !== "board" || !selectedResource || groups.length === 0) {
            return;
        }
        const groupIndex = groups.findIndex((candidate) => candidate.items.some((item) => item.id === selectedResource.id));
        const target = groups[clampIndex(groupIndex + delta, groups.length)]?.items[0];
        if (target) {
            dispatch({ type: "resourceSelected", resource: resourceReference(target) });
        }
    }

    function focusedResource(): ContentResource | undefined {
        return interaction.focus === "navigation"
            ? projection.resourceFor(activeNavigation)
            : selectedResource;
    }

    function openCreate(requestedKind?: EditorKind): void {
        if (stale) {
            dispatch({ type: "noticeChanged", notice: "refresh is required before another workspace change" });
            return;
        }
        const navigationTarget = activeNavigation.target;
        const context: EditorContext = navigationTarget.kind === "teamIssues"
            ? { teamId: navigationTarget.teamId }
            : navigationTarget.kind === "projectIssues"
                ? {
                    projectId: navigationTarget.projectId,
                    teamId: snapshot.projects.find((project) => project.id === navigationTarget.projectId)?.teamIds[0],
                }
                : navigationTarget.kind === "myIssues"
                    ? { assigneeId: snapshot.viewer.id }
                    : {};
        const kind = requestedKind
            ?? (activeNavigation.contentKind === "project"
                ? "project"
                : activeNavigation.contentKind === "team"
                    ? "team"
                    : "issue");
        dispatch({ type: "modalOpened", modal: { type: "editor", target: createEditorTarget(kind, context) } });
    }

    function openEdit(): void {
        if (stale) {
            dispatch({ type: "noticeChanged", notice: "refresh is required before another workspace change" });
            return;
        }
        const resource = focusedResource();
        if (!resource) {
            dispatch({ type: "noticeChanged", notice: "nothing editable is selected" });
            return;
        }
        dispatch({ type: "modalOpened", modal: { type: "editor", target: editorTargetForResource(resource) } });
    }

    function openRemove(): void {
        if (stale) {
            dispatch({ type: "noticeChanged", notice: "refresh is required before another workspace change" });
            return;
        }
        const resource = focusedResource();
        if (!resource) {
            dispatch({ type: "noticeChanged", notice: "nothing removable is selected" });
            return;
        }
        dispatch({
            type: "modalOpened",
            modal: {
                type: "confirm",
                resource,
                title: `${isCustomView(resource) ? "Delete" : "Archive"} ${resource.kind === "issue" ? resource.identifier : resource.name}`,
                body: isCustomView(resource)
                    ? `${resourceTitle(resource)} will be permanently deleted from Linear. This operation does not use Linear's recoverable archive.`
                    : `${resourceTitle(resource)} will be archived in Linear. This is not a hard delete and can be restored from Linear's archive.`,
            },
        });
    }

    async function advanceIssue(): Promise<void> {
        if (!selectedResource || !isIssue(selectedResource) || stale) {
            return;
        }
        const result = buildAdvanceIssueChange(snapshot, selectedResource);
        if (!result.ok) {
            dispatch({ type: "noticeChanged", notice: result.message });
            return;
        }
        await props.session.saveResource(result.change);
    }

    async function moveResourceAcrossGroup(delta: number): Promise<void> {
        if (!selectedResource || effectiveViewMode !== "board" || stale) {
            return;
        }
        const sourceIndex = groups.findIndex((group) => group.items.some((item) => item.id === selectedResource.id));
        const targetGroup = groups[clampIndex(sourceIndex + delta, groups.length)];
        if (!targetGroup || targetGroup.items.some((item) => item.id === selectedResource.id)) {
            return;
        }
        const result = buildMoveAcrossGroupChange(snapshot, selectedResource, effectiveGroupBy, targetGroup);
        if (!result.ok) {
            dispatch({ type: "noticeChanged", notice: result.message });
            return;
        }
        await props.session.saveResource(result.change);
    }

    useInput((input, key) => {
        if (changing || interaction.modal) {
            return;
        }
        if (interaction.searching) {
            if (key.escape || key.return) {
                dispatch({ type: "searchFinished" });
            } else if (key.backspace || key.delete) {
                dispatch({ type: "searchChanged", search: interaction.search.slice(0, -1) });
            } else if (key.ctrl && input.toLocaleLowerCase() === "u") {
                dispatch({ type: "searchChanged", search: "" });
            } else if (!key.ctrl && !key.meta && input) {
                dispatch({ type: "searchChanged", search: `${interaction.search}${input}` });
            }
            return;
        }

        const command = identifyCommand(input, key, interaction.focus, effectiveViewMode);
        if (command === "quit") {
            exit();
        } else if (command === "help") {
            dispatch({ type: "modalOpened", modal: { type: "help" } });
        } else if (command === "focusNavigation") {
            dispatch({ type: "focusSelected", focus: "navigation" });
        } else if (command === "focusContent") {
            dispatch({ type: "focusSelected", focus: "content" });
        } else if (command === "focusDetail") {
            dispatch({ type: "focusSelected", focus: "detail" });
        } else if (command === "cycleFocus") {
            dispatch({ type: "focusCycled" });
        } else if (command === "search") {
            dispatch({ type: "searchStarted" });
        } else if (command === "refresh") {
            runWorkspaceOperation("refresh the workspace", () => props.session.refresh());
        } else if (command === "toggleLayout") {
            if (activeNavigation.target.kind === "teams") {
                dispatch({ type: "noticeChanged", notice: "teams are list-only; issue and project collections support boards" });
            } else {
                dispatch({ type: "viewModeToggled" });
            }
        } else if (command === "cycleGrouping") {
            if (activeNavigation.contentKind === "project") {
                dispatch({ type: "noticeChanged", notice: "project boards group by project status" });
            } else if (activeNavigation.contentKind === "team") {
                dispatch({ type: "noticeChanged", notice: "teams are list-only" });
            } else {
                const order: readonly GroupBy[] = ["status", "priority", "project", "assignee", "team"];
                dispatch({ type: "groupingSelected", groupBy: order[(order.indexOf(interaction.groupBy) + 1) % order.length]! });
            }
        } else if (command === "create") {
            openCreate();
        } else if (command === "createView") {
            openCreate("customView");
        } else if (command === "edit") {
            openEdit();
        } else if (command === "remove") {
            openRemove();
        } else if (command === "advance" && interaction.focus !== "navigation") {
            runWorkspaceOperation("advance the issue", advanceIssue);
        } else if (command === "moveCardLeft" && interaction.focus === "content") {
            runWorkspaceOperation("move the resource across the board", () => moveResourceAcrossGroup(-1));
        } else if (command === "moveCardRight" && interaction.focus === "content") {
            runWorkspaceOperation("move the resource across the board", () => moveResourceAcrossGroup(1));
        } else if (command === "open") {
            dispatch({ type: "focusSelected", focus: interaction.focus === "navigation" ? "content" : "detail" });
        } else if (key.escape) {
            dispatch({ type: "focusSelected", focus: interaction.focus === "detail" ? "content" : interaction.focus });
        } else if (command === "moveDown") {
            if (interaction.focus === "navigation") {
                selectNavigation(safeNavigationIndex + 1);
            } else if (interaction.focus === "content") {
                moveContent(1);
            }
        } else if (command === "moveUp") {
            if (interaction.focus === "navigation") {
                selectNavigation(safeNavigationIndex - 1);
            } else if (interaction.focus === "content") {
                moveContent(-1);
            }
        } else if (command === "moveBoardLeft") {
            moveBoardColumn(-1);
        } else if (command === "moveBoardRight") {
            moveBoardColumn(1);
        }
    }, { isActive: interaction.modal === null });

    if (interaction.modal?.type === "help") {
        return <HelpModal width={props.size.width} height={props.size.height} onClose={() => dispatch({ type: "modalClosed" })} />;
    }
    if (interaction.modal?.type === "editor") {
        const editorKind = interaction.modal.target.kind;
        return (
            <EditorModal
                target={interaction.modal.target}
                snapshot={snapshot}
                width={props.size.width}
                height={props.size.height}
                saving={workspaceState.phase === "changing"}
                externalError={visibleFailure}
                onCancel={() => dispatch({ type: "modalClosed" })}
                onSubmit={(change) => runWorkspaceOperation(
                    `save the ${editorKind}`,
                    () => props.session.saveResource(change),
                )}
            />
        );
    }
    if (interaction.modal?.type === "confirm") {
        const target = resourceReference(interaction.modal.resource);
        return (
            <ConfirmModal
                title={interaction.modal.title}
                body={interaction.modal.body}
                width={props.size.width}
                height={props.size.height}
                saving={workspaceState.phase === "changing"}
                externalError={visibleFailure}
                onCancel={() => dispatch({ type: "modalClosed" })}
                onConfirm={() => runWorkspaceOperation(
                    `${target.kind === "customView" ? "delete" : "archive"} the ${target.kind}`,
                    () => props.session.removeResource(target),
                )}
            />
        );
    }

    const bodyHeight = props.size.height - 2;
    const title = activeNavigation.label;
    const subtitle = activeNavigation.contentKind === "issue"
        ? `${content.length} issues${interaction.search ? ` matching “${interaction.search}”` : ""}`
        : activeNavigation.contentKind === "project"
            ? `${content.length} projects`
            : `${content.length} teams`;

    let body: React.ReactNode;
    if (props.size.width >= 100) {
        const navigationWidth = Math.min(29, Math.max(24, Math.floor(props.size.width * 0.22)));
        const detailWidth = Math.min(38, Math.max(30, Math.floor(props.size.width * 0.27)));
        const contentWidth = props.size.width - navigationWidth - detailWidth;
        body = (
            <Box height={bodyHeight}>
                <NavigationPanel entries={navigation} activeIndex={safeNavigationIndex} focused={interaction.focus === "navigation"} width={navigationWidth} height={bodyHeight} />
                <ContentPanel title={title} subtitle={subtitle} items={content} selectedIndex={safeContentIndex} focused={interaction.focus === "content"} width={contentWidth} height={bodyHeight} mode={effectiveViewMode} groupBy={effectiveGroupBy} groups={groups} search={interaction.search} searching={interaction.searching} />
                <DetailPanel resource={selectedResource} focused={interaction.focus === "detail"} width={detailWidth} height={bodyHeight} />
            </Box>
        );
    } else if (props.size.width >= 66) {
        const navigationWidth = 24;
        const rightWidth = props.size.width - navigationWidth;
        body = (
            <Box height={bodyHeight}>
                <NavigationPanel entries={navigation} activeIndex={safeNavigationIndex} focused={interaction.focus === "navigation"} width={navigationWidth} height={bodyHeight} />
                {interaction.focus === "detail"
                    ? <DetailPanel resource={selectedResource} focused width={rightWidth} height={bodyHeight} />
                    : <ContentPanel title={title} subtitle={subtitle} items={content} selectedIndex={safeContentIndex} focused={interaction.focus === "content"} width={rightWidth} height={bodyHeight} mode={effectiveViewMode} groupBy={effectiveGroupBy} groups={groups} search={interaction.search} searching={interaction.searching} />}
            </Box>
        );
    } else if (interaction.focus === "navigation") {
        body = <NavigationPanel entries={navigation} activeIndex={safeNavigationIndex} focused width={props.size.width} height={bodyHeight} />;
    } else if (interaction.focus === "detail") {
        body = <DetailPanel resource={selectedResource} focused width={props.size.width} height={bodyHeight} />;
    } else {
        body = <ContentPanel title={title} subtitle={subtitle} items={content} selectedIndex={safeContentIndex} focused width={props.size.width} height={bodyHeight} mode={effectiveViewMode} groupBy={effectiveGroupBy} groups={groups} search={interaction.search} searching={interaction.searching} />;
    }

    const status = visibleFailure
        || (workspaceState.phase === "loading"
            ? "refreshing workspace"
            : workspaceState.phase === "changing"
                ? "saving workspace change"
                : interaction.notice || `synced ${new Date(snapshot.fetchedAt).toLocaleTimeString()}`);
    return (
        <Box width={props.size.width} height={props.size.height} flexDirection="column" backgroundColor={colors.background}>
            <Header workspace={snapshot} environment={workspaceState.environment} loading={changing} title={title} width={props.size.width} />
            {body}
            <Footer focus={interaction.focus} mode={effectiveViewMode} status={status} error={Boolean(visibleFailure)} width={props.size.width} />
        </Box>
    );
}

export function App(props: AppProps) {
    const { exit } = useApp();
    const size = useTerminalSize();
    const [session, setSession] = useState<WorkspaceSession>();
    const [connecting, setConnecting] = useState(false);
    const [connectionError, setConnectionError] = useState("");
    const initialConnectionStarted = useRef(false);

    const connect = useCallback(async (adapter: DemoWorkspaceAdapter | LinearWorkspaceAdapter): Promise<void> => {
        setConnecting(true);
        setConnectionError("");
        const candidate = new ObservableWorkspaceSession(adapter);
        try {
            await candidate.refresh();
            if (candidate.state.phase === "ready") {
                setSession(candidate);
                return;
            }
            const failure = candidate.state.phase === "failed" ? candidate.state.failure.message : "The workspace did not become ready.";
            setConnectionError(failure);
        } catch (error) {
            setConnectionError(error instanceof Error ? error.message : String(error));
        } finally {
            setConnecting(false);
        }
    }, []);

    useEffect(() => {
        if (initialConnectionStarted.current) {
            return;
        }
        initialConnectionStarted.current = true;
        if (props.demo) {
            void connect(new DemoWorkspaceAdapter());
        } else if (props.initialToken) {
            void connect(new LinearWorkspaceAdapter(props.initialToken, undefined, props.linearFetch));
        }
    }, [connect, props.demo, props.initialToken, props.linearFetch]);

    if (session) {
        return <WorkspaceScreen session={session} size={size} />;
    }
    return (
        <TokenModal
            width={size.width}
            height={size.height}
            error={connectionError}
            loading={connecting}
            onSubmit={(token) => void connect(new LinearWorkspaceAdapter(token, undefined, props.linearFetch))}
            onDemo={() => void connect(new DemoWorkspaceAdapter())}
            onQuit={exit}
        />
    );
}