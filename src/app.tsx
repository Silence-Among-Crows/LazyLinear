import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Box, Text, useApp, useInput } from "ink";
import { createDemoWorkspace } from "../lib/demo-data.js";
import { LinearApi, LinearApiError } from "../lib/linear.js";
import type {
    CustomView,
    FocusPanel,
    Issue,
    Project,
    Team,
    ViewMode,
    WorkspaceData,
} from "../lib/types.js";
import { applyDemoMutation, type DemoMutation } from "./demo-store.js";
import {
    type ContentResource,
    type GroupBy,
    type NavigationEntry,
    buildNavigation,
    clampIndex,
    contentForNavigation,
    filterResources,
    groupResources,
    isCustomView,
    isIssue,
    isProject,
    isTeam,
    resourceKindForNavigation,
} from "./domain.js";
import {
    ConfirmModal,
    EditorModal,
    HelpModal,
    TokenModal,
    type EditorContext,
    type EditorKind,
    type EditorResult,
} from "./modals.js";
import {
    ContentPanel,
    DetailPanel,
    Footer,
    Header,
    NavigationPanel,
    colors,
} from "./ui.js";

interface TerminalSize {
    width: number;
    height: number;
}

interface RefreshableTerminalOutput {
    _refreshSize?: () => void;
}

const TERMINAL_SIZE_POLL_INTERVAL_MS = 200;

type ModalState =
    | { type: "help" }
    | { type: "editor"; kind: EditorKind; entity?: ContentResource; context?: EditorContext }
    | { type: "confirm"; kind: EditorKind; entity: ContentResource; title: string; body: string };

export interface AppProps {
    initialToken?: string;
    demo?: boolean;
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
                // Some remote TTY implementations expose the private refresh hook but cannot query their backing handle.
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

function errorMessage(error: unknown): string {
    if (error instanceof LinearApiError) {
        if (error.status === 401 || error.code === "AUTHENTICATION_ERROR") {
            return "Linear rejected the token. Check that it is current and has the required workspace access.";
        }
        if (error.status === 429 || error.code === "RATELIMITED") {
            return "Linear rate limit reached. Wait until the reset window, then refresh.";
        }
        return error.message;
    }
    return error instanceof Error ? error.message : String(error);
}

function editorKindForResource(resource: ContentResource): EditorKind {
    if (isIssue(resource)) {
        return "issue";
    }
    if (isProject(resource)) {
        return "project";
    }
    if (isTeam(resource)) {
        return "team";
    }
    return "customView";
}

function resourceTitle(resource: ContentResource): string {
    if (isIssue(resource)) {
        return `${resource.identifier} ${resource.title}`;
    }
    return resource.name;
}

function resourceForNavigation(workspace: WorkspaceData, entry: NavigationEntry): ContentResource | undefined {
    if (entry.kind === "customView") {
        return workspace.customViews.find((view) => view.id === entry.resourceId);
    }
    if (entry.kind === "teamIssues") {
        return workspace.teams.find((team) => team.id === entry.resourceId);
    }
    if (entry.kind === "projectIssues") {
        return workspace.projects.find((project) => project.id === entry.resourceId);
    }
    return undefined;
}

function createKindForNavigation(entry: NavigationEntry): EditorKind {
    if (entry.kind === "projects") {
        return "project";
    }
    if (entry.kind === "teams") {
        return "team";
    }
    return "issue";
}

export function App(props: AppProps) {
    const { exit } = useApp();
    const size = useTerminalSize();
    const [demo, setDemo] = useState(props.demo ?? false);
    const [token, setToken] = useState(props.initialToken);
    const [workspace, setWorkspace] = useState<WorkspaceData | undefined>(() => props.demo ? createDemoWorkspace() : undefined);
    const [loading, setLoading] = useState(Boolean(props.initialToken && !props.demo));
    const [status, setStatus] = useState(props.demo ? "demo workspace ready" : "");
    const [error, setError] = useState("");
    const [focus, setFocus] = useState<FocusPanel>("navigation");
    const [selectedNavigationId, setSelectedNavigationId] = useState("my-issues");
    const [selectedResourceId, setSelectedResourceId] = useState<string>();
    const [viewMode, setViewMode] = useState<ViewMode>("list");
    const [groupBy, setGroupBy] = useState<GroupBy>("status");
    const [search, setSearch] = useState("");
    const [searching, setSearching] = useState(false);
    const [modal, setModal] = useState<ModalState | null>(null);

    const api = useMemo(() => token ? new LinearApi(token) : undefined, [token]);

    const refresh = useCallback(async (showLoading = true): Promise<void> => {
        if (demo) {
            setWorkspace((current) => current ?? createDemoWorkspace());
            setStatus(`demo refreshed ${new Date().toLocaleTimeString()}`);
            setError("");
            return;
        }
        if (!api) {
            return;
        }
        if (showLoading) {
            setLoading(true);
        }
        setError("");
        try {
            const data = await api.bootstrap();
            setWorkspace(data);
            setStatus(`synced ${new Date(data.fetchedAt).toLocaleTimeString()}`);
        } catch (refreshError) {
            const message = errorMessage(refreshError);
            setError(message);
            setStatus("sync failed");
            if (workspace === undefined) {
                setToken(undefined);
            }
        } finally {
            setLoading(false);
        }
    }, [api, demo, workspace]);

    useEffect(() => {
        if (!demo && api && workspace === undefined) {
            void refresh();
        }
    }, [api, demo, refresh, workspace]);

    const navigation = useMemo(() => workspace ? buildNavigation(workspace) : [], [workspace]);
    const rememberedNavigationIndex = navigation.findIndex((entry) => entry.id === selectedNavigationId);
    const safeNavigationIndex = rememberedNavigationIndex >= 0 ? rememberedNavigationIndex : 0;
    const activeNavigation = navigation[safeNavigationIndex];
    const resourceKind = activeNavigation ? resourceKindForNavigation(activeNavigation) : "issues";
    const effectiveViewMode: ViewMode = activeNavigation?.kind === "teams" ? "list" : viewMode;
    const effectiveGroupBy: GroupBy = resourceKind === "projects" ? "status" : groupBy;
    const unfilteredContent = useMemo(() => {
        if (!workspace || !activeNavigation) {
            return [];
        }
        return contentForNavigation(workspace, activeNavigation);
    }, [workspace, activeNavigation]);
    const content = useMemo(() => filterResources(unfilteredContent, search), [unfilteredContent, search]);
    const rememberedContentIndex = selectedResourceId
        ? content.findIndex((resource) => resource.id === selectedResourceId)
        : -1;
    const safeContentIndex = rememberedContentIndex >= 0 ? rememberedContentIndex : 0;
    const selectedResource = content[safeContentIndex];
    const groups = useMemo(() => groupResources(content, effectiveGroupBy), [content, effectiveGroupBy]);

    useEffect(() => {
        if (activeNavigation?.id !== selectedNavigationId) {
            setSelectedNavigationId(activeNavigation?.id ?? "my-issues");
        }
    }, [activeNavigation, selectedNavigationId]);

    useEffect(() => {
        if (selectedResource?.id !== selectedResourceId) {
            setSelectedResourceId(selectedResource?.id);
        }
    }, [selectedResource, selectedResourceId]);

    function selectNavigation(nextIndex: number): void {
        const target = navigation[clampIndex(nextIndex, navigation.length)];
        setSelectedNavigationId(target?.id ?? "my-issues");
        setSelectedResourceId(undefined);
        setSearch("");
    }

    function moveContent(delta: number): void {
        if (effectiveViewMode === "list" || !selectedResource) {
            const target = content[clampIndex(safeContentIndex + delta, content.length)];
            setSelectedResourceId(target?.id);
            return;
        }
        const group = groups.find((candidate) => candidate.items.some((item) => item.id === selectedResource.id));
        if (!group) {
            return;
        }
        const withinGroup = group.items.findIndex((item) => item.id === selectedResource.id);
        const target = group.items[clampIndex(withinGroup + delta, group.items.length)];
        if (target) {
            setSelectedResourceId(target.id);
        }
    }

    function moveBoardColumn(delta: number): void {
        if (effectiveViewMode !== "board" || !selectedResource || groups.length === 0) {
            return;
        }
        const groupIndex = groups.findIndex((candidate) => candidate.items.some((item) => item.id === selectedResource.id));
        const targetGroup = groups[clampIndex(groupIndex + delta, groups.length)];
        const target = targetGroup?.items[0];
        if (target) {
            setSelectedResourceId(target.id);
        }
    }

    function focusedResource(): ContentResource | undefined {
        if (!workspace || !activeNavigation) {
            return undefined;
        }
        if (focus === "navigation") {
            return resourceForNavigation(workspace, activeNavigation);
        }
        return selectedResource;
    }

    function openCreate(kind?: EditorKind): void {
        if (!activeNavigation || !workspace) {
            return;
        }
        const context: EditorContext = {};
        if (activeNavigation.kind === "teamIssues") {
            context.teamId = activeNavigation.resourceId;
        } else if (activeNavigation.kind === "projectIssues") {
            const project = workspace.projects.find((candidate) => candidate.id === activeNavigation.resourceId);
            context.projectId = project?.id;
            context.teamId = project?.teams[0]?.id;
        } else if (activeNavigation.kind === "myIssues") {
            context.assigneeId = workspace.viewer.id;
        }
        setError("");
        setModal({ type: "editor", kind: kind ?? createKindForNavigation(activeNavigation), context });
    }

    function openEdit(): void {
        const resource = focusedResource();
        if (!resource) {
            setStatus("nothing editable is selected");
            return;
        }
        setError("");
        setModal({ type: "editor", kind: editorKindForResource(resource), entity: resource });
    }

    function openArchive(): void {
        const resource = focusedResource();
        if (!resource) {
            setStatus("nothing archivable is selected");
            return;
        }
        setError("");
        setModal({
            type: "confirm",
            kind: editorKindForResource(resource),
            entity: resource,
            title: `${isCustomView(resource) ? "Delete" : "Archive"} ${isIssue(resource) ? resource.identifier : resource.name}`,
            body: isCustomView(resource)
                ? `${resourceTitle(resource)} will be permanently deleted from Linear. This operation does not use Linear's recoverable archive.`
                : `${resourceTitle(resource)} will be archived in Linear. This is not a hard delete and can be restored from Linear's archive.`,
        });
    }

    async function applyMutation(editor: EditorResult, entity?: ContentResource): Promise<void> {
        if (!workspace) {
            return;
        }
        setLoading(true);
        setError("");
        if (demo) {
            try {
                let mutation: DemoMutation;
                if (editor.kind === "issue") {
                    mutation = entity && isIssue(entity)
                        ? { kind: "issue", action: "update", id: entity.id, input: editor.input }
                        : { kind: "issue", action: "create", input: editor.input };
                } else if (editor.kind === "project") {
                    mutation = entity && isProject(entity)
                        ? { kind: "project", action: "update", id: entity.id, input: editor.input }
                        : { kind: "project", action: "create", input: editor.input };
                } else if (editor.kind === "team") {
                    mutation = entity && isTeam(entity)
                        ? { kind: "team", action: "update", id: entity.id, input: editor.input }
                        : { kind: "team", action: "create", input: editor.input };
                } else {
                    mutation = entity && isCustomView(entity)
                        ? { kind: "customView", action: "update", id: entity.id, input: editor.input }
                        : { kind: "customView", action: "create", input: editor.input };
                }
                const nextWorkspace = applyDemoMutation(workspace, mutation);
                const createdResource = entity
                    ?? (editor.kind === "issue"
                        ? nextWorkspace.issues.find((candidate) => !workspace.issues.some((previous) => previous.id === candidate.id))
                        : editor.kind === "project"
                            ? nextWorkspace.projects.find((candidate) => !workspace.projects.some((previous) => previous.id === candidate.id))
                            : editor.kind === "team"
                                ? nextWorkspace.teams.find((candidate) => !workspace.teams.some((previous) => previous.id === candidate.id))
                                : nextWorkspace.customViews.find((candidate) => !workspace.customViews.some((previous) => previous.id === candidate.id)));
                setWorkspace(nextWorkspace);
                setModal(null);
                setSelectedResourceId(createdResource?.id);
                setStatus(`${entity ? "updated" : "created"} ${editor.kind}`);
            } catch (mutationError) {
                setError(errorMessage(mutationError));
                setStatus("mutation failed; editor preserved");
            } finally {
                setLoading(false);
            }
            return;
        }
        if (!api) {
            setError("No Linear API client is available. Re-enter your token and try again.");
            setStatus("mutation failed; editor preserved");
            setLoading(false);
            return;
        }

        let savedId: string;
        try {
            if (editor.kind === "issue") {
                if (entity && isIssue(entity)) {
                    savedId = await api.updateIssue(entity.id, editor.input);
                } else {
                    savedId = await api.createIssue(editor.input);
                }
            } else if (editor.kind === "project") {
                if (entity && isProject(entity)) {
                    savedId = await api.updateProject(entity.id, editor.input);
                } else {
                    savedId = await api.createProject(editor.input);
                }
            } else if (editor.kind === "team") {
                if (entity && isTeam(entity)) {
                    savedId = await api.updateTeam(entity.id, editor.input);
                } else {
                    savedId = await api.createTeam(editor.input);
                }
            } else if (entity && isCustomView(entity)) {
                savedId = await api.updateCustomView(entity.id, editor.input);
            } else {
                savedId = await api.createCustomView(editor.input);
            }
        } catch (mutationError) {
            setError(errorMessage(mutationError));
            setStatus("mutation failed; editor preserved");
            setLoading(false);
            return;
        }

        setStatus(`${entity ? "updated" : "created"} ${editor.kind}; refreshing`);
        try {
            const nextWorkspace = await api.bootstrap();
            setWorkspace(nextWorkspace);
            setSelectedResourceId(savedId);
            setModal(null);
            setStatus(`${entity ? "updated" : "created"} ${editor.kind}`);
        } catch (refreshError) {
            setSelectedResourceId(entity?.id);
            setModal(null);
            setError(`The ${editor.kind} was saved in Linear, but refreshing failed: ${errorMessage(refreshError)}`);
            setStatus("saved in Linear; refresh failed");
        } finally {
            setLoading(false);
        }
    }

    async function archiveResource(kind: EditorKind, entity: ContentResource): Promise<void> {
        if (!workspace) {
            return;
        }
        setLoading(true);
        setError("");
        if (demo) {
            try {
                const mutation: DemoMutation = kind === "issue"
                    ? { kind: "issue", action: "archive", id: entity.id }
                    : kind === "project"
                        ? { kind: "project", action: "archive", id: entity.id }
                        : kind === "team"
                            ? { kind: "team", action: "archive", id: entity.id }
                            : { kind: "customView", action: "archive", id: entity.id };
                setWorkspace(applyDemoMutation(workspace, mutation));
                setModal(null);
                setSelectedResourceId(undefined);
                setStatus(kind === "customView" ? "deleted custom view" : `archived ${kind}`);
            } catch (archiveError) {
                setError(errorMessage(archiveError));
                setStatus(kind === "customView" ? "delete failed" : "archive failed");
            } finally {
                setLoading(false);
            }
            return;
        }
        if (!api) {
            setError("No Linear API client is available. Re-enter your token and try again.");
            setStatus(kind === "customView" ? "delete failed" : "archive failed");
            setLoading(false);
            return;
        }

        try {
            if (kind === "issue") {
                await api.deleteIssue(entity.id);
            } else if (kind === "project") {
                await api.deleteProject(entity.id);
            } else if (kind === "team") {
                await api.deleteTeam(entity.id);
            } else {
                await api.deleteCustomView(entity.id);
            }
        } catch (archiveError) {
            setError(errorMessage(archiveError));
            setStatus(kind === "customView" ? "delete failed" : "archive failed");
            setLoading(false);
            return;
        }

        setModal(null);
        setSelectedResourceId(undefined);
        setStatus(kind === "customView" ? "deleted custom view; refreshing" : `archived ${kind}; refreshing`);
        try {
            setWorkspace(await api.bootstrap());
            setStatus(kind === "customView" ? "deleted custom view" : `archived ${kind}`);
        } catch (refreshError) {
            const action = kind === "customView" ? "deletion" : "archive";
            setError(`The ${action} succeeded in Linear, but refreshing failed: ${errorMessage(refreshError)}`);
            setStatus(`${action} succeeded; refresh failed`);
        } finally {
            setLoading(false);
        }
    }

    async function advanceIssue(): Promise<void> {
        if (!workspace || !selectedResource || !isIssue(selectedResource)) {
            return;
        }
        const states = workspace.workflowStates
            .filter((state) => state.team?.id === selectedResource.team.id && state.type !== "canceled")
            .sort((left, right) => (left.position ?? 0) - (right.position ?? 0));
        const currentIndex = states.findIndex((state) => state.id === selectedResource.state.id);
        if (selectedResource.state.type === "canceled" || currentIndex < 0) {
            setStatus("a canceled issue cannot be advanced; choose a status explicitly with edit or board move");
            return;
        }
        const nextState = states[Math.min(currentIndex + 1, states.length - 1)];
        if (!nextState || nextState.id === selectedResource.state.id) {
            setStatus("issue is already in its final workflow state");
            return;
        }
        await applyMutation({
            kind: "issue",
            input: {
                title: selectedResource.title,
                teamId: selectedResource.team.id,
                stateId: nextState.id,
            },
        }, selectedResource);
    }

    async function moveResourceAcrossGroup(delta: number): Promise<void> {
        if (!workspace || !selectedResource || effectiveViewMode !== "board") {
            return;
        }
        const sourceIndex = groups.findIndex((group) => group.items.some((item) => item.id === selectedResource.id));
        const targetGroup = groups[clampIndex(sourceIndex + delta, groups.length)];
        if (!targetGroup || targetGroup.items.some((item) => item.id === selectedResource.id)) {
            return;
        }
        if (isProject(selectedResource)) {
            await applyMutation({
                kind: "project",
                input: {
                    name: selectedResource.name,
                    teamIds: selectedResource.teams.map((team) => team.id),
                    statusId: targetGroup.id,
                },
            }, selectedResource);
            return;
        }
        if (!isIssue(selectedResource)) {
            return;
        }
        const input = {
            title: selectedResource.title,
            teamId: selectedResource.team.id,
            stateId: selectedResource.state.id,
        };
        if (groupBy === "status") {
            const targetExample = targetGroup.items.find(isIssue);
            const targetState = workspace.workflowStates.find((state) => state.team?.id === selectedResource.team.id && state.name === targetExample?.state.name)
                ?? workspace.workflowStates.find((state) => state.team?.id === selectedResource.team.id && state.type === targetExample?.state.type);
            if (!targetState) {
                setStatus(`the ${selectedResource.team.key} workflow has no state matching ${targetGroup.label}`);
                return;
            }
            input.stateId = targetState.id;
        } else if (groupBy === "priority") {
            await applyMutation({ kind: "issue", input: { ...input, priority: Number(targetGroup.id) } }, selectedResource);
            return;
        } else if (groupBy === "project") {
            await applyMutation({ kind: "issue", input: { ...input, projectId: targetGroup.id === "none" ? null : targetGroup.id } }, selectedResource);
            return;
        } else if (groupBy === "assignee") {
            await applyMutation({ kind: "issue", input: { ...input, assigneeId: targetGroup.id === "none" ? null : targetGroup.id } }, selectedResource);
            return;
        } else if (groupBy === "team") {
            const targetState = workspace.workflowStates.find((state) => state.team?.id === targetGroup.id && state.type === selectedResource.state.type)
                ?? workspace.workflowStates.find((state) => state.team?.id === targetGroup.id && state.type === "unstarted")
                ?? workspace.workflowStates.find((state) => state.team?.id === targetGroup.id);
            await applyMutation({
                kind: "issue",
                input: {
                    ...input,
                    teamId: targetGroup.id,
                    stateId: targetState?.id,
                },
            }, selectedResource);
            return;
        }
        await applyMutation({ kind: "issue", input }, selectedResource);
    }

    useInput((input, key) => {
        if (!workspace || modal || loading) {
            return;
        }
        if (searching) {
            if (key.escape || key.return) {
                setSearching(false);
            } else if (key.backspace || key.delete) {
                setSearch((current) => current.slice(0, -1));
            } else if (key.ctrl && input.toLocaleLowerCase() === "u") {
                setSearch("");
            } else if (!key.ctrl && !key.meta && input) {
                setSearch((current) => `${current}${input}`);
                setSelectedResourceId(undefined);
            }
            return;
        }
        if (input === "q") {
            exit();
        } else if (input === "?") {
            setModal({ type: "help" });
        } else if (input === "1") {
            setFocus("navigation");
        } else if (input === "2") {
            setFocus("content");
        } else if (input === "3") {
            setFocus("detail");
        } else if (key.tab) {
            setFocus((current) => current === "navigation" ? "content" : current === "content" ? "detail" : "navigation");
        } else if (input === "/") {
            setSearching(true);
        } else if (input === "r" || input === "R") {
            void refresh();
        } else if (input === "b") {
            if (activeNavigation?.kind === "teams") {
                setStatus("teams are list-only; issue and project collections support boards");
            } else {
                setViewMode((current) => current === "list" ? "board" : "list");
            }
        } else if (input === "g") {
            if (resourceKind === "projects") {
                setStatus("project boards group by project status");
            } else if (resourceKind === "teams") {
                setStatus("teams are list-only");
            } else {
                const order: GroupBy[] = ["status", "priority", "project", "assignee", "team"];
                setGroupBy((current) => order[(order.indexOf(current) + 1) % order.length]!);
            }
        } else if (input === "n") {
            openCreate();
        } else if (input === "v") {
            openCreate("customView");
        } else if (input === "e") {
            openEdit();
        } else if (input === "d") {
            openArchive();
        } else if (input === " ") {
            if (focus !== "navigation") {
                void advanceIssue();
            }
        } else if (input === "H") {
            if (focus === "content") {
                void moveResourceAcrossGroup(-1);
            }
        } else if (input === "L") {
            if (focus === "content") {
                void moveResourceAcrossGroup(1);
            }
        } else if (key.return) {
            setFocus((current) => current === "navigation" ? "content" : "detail");
        } else if (key.escape) {
            setFocus((current) => current === "detail" ? "content" : current);
        } else if (input === "j" || key.downArrow) {
            if (focus === "navigation") {
                selectNavigation(safeNavigationIndex + 1);
            } else if (focus === "content") {
                moveContent(1);
            }
        } else if (input === "k" || key.upArrow) {
            if (focus === "navigation") {
                selectNavigation(safeNavigationIndex - 1);
            } else if (focus === "content") {
                moveContent(-1);
            }
        } else if (input === "h" || key.leftArrow) {
            moveBoardColumn(-1);
        } else if (input === "l" || key.rightArrow) {
            moveBoardColumn(1);
        }
    }, { isActive: workspace !== undefined && modal === null });

    if (!workspace) {
        return (
            <TokenModal
                width={size.width}
                height={size.height}
                error={error}
                loading={loading}
                onSubmit={(nextToken) => {
                    setError("");
                    setLoading(true);
                    setToken(nextToken);
                }}
                onDemo={() => {
                    setDemo(true);
                    setToken(undefined);
                    setWorkspace(createDemoWorkspace());
                    setLoading(false);
                    setError("");
                    setStatus("demo workspace ready");
                }}
                onQuit={exit}
            />
        );
    }

    if (modal?.type === "help") {
        return <HelpModal width={size.width} height={size.height} onClose={() => setModal(null)} />;
    }
    if (modal?.type === "editor") {
        return (
            <EditorModal
                kind={modal.kind}
                workspace={workspace}
                entity={modal.entity}
                context={modal.context}
                width={size.width}
                height={size.height}
                saving={loading}
                externalError={error}
                onCancel={() => setModal(null)}
                onSubmit={(result) => void applyMutation(result, modal.entity)}
            />
        );
    }
    if (modal?.type === "confirm") {
        return (
            <ConfirmModal
                title={modal.title}
                body={modal.body}
                width={size.width}
                height={size.height}
                saving={loading}
                externalError={error}
                onCancel={() => setModal(null)}
                onConfirm={() => void archiveResource(modal.kind, modal.entity)}
            />
        );
    }

    const bodyHeight = size.height - 2;
    const title = activeNavigation?.label ?? "Workspace";
    const subtitle = resourceKind === "issues"
        ? `${content.length} issues${search ? ` matching “${search}”` : ""}`
        : resourceKind === "projects"
            ? `${content.length} projects`
            : `${content.length} teams`;

    let body: React.ReactNode;
    if (size.width >= 100) {
        const navigationWidth = Math.min(29, Math.max(24, Math.floor(size.width * 0.22)));
        const detailWidth = Math.min(38, Math.max(30, Math.floor(size.width * 0.27)));
        const contentWidth = size.width - navigationWidth - detailWidth;
        body = (
            <Box height={bodyHeight}>
                <NavigationPanel entries={navigation} activeIndex={safeNavigationIndex} focused={focus === "navigation"} width={navigationWidth} height={bodyHeight} />
                <ContentPanel title={title} subtitle={subtitle} items={content} selectedIndex={safeContentIndex} focused={focus === "content"} width={contentWidth} height={bodyHeight} mode={effectiveViewMode} groupBy={effectiveGroupBy} groups={groups} search={search} searching={searching} />
                <DetailPanel resource={selectedResource} focused={focus === "detail"} width={detailWidth} height={bodyHeight} />
            </Box>
        );
    } else if (size.width >= 66) {
        const navigationWidth = 24;
        const rightWidth = size.width - navigationWidth;
        body = (
            <Box height={bodyHeight}>
                <NavigationPanel entries={navigation} activeIndex={safeNavigationIndex} focused={focus === "navigation"} width={navigationWidth} height={bodyHeight} />
                {focus === "detail" ? (
                    <DetailPanel resource={selectedResource} focused width={rightWidth} height={bodyHeight} />
                ) : (
                    <ContentPanel title={title} subtitle={subtitle} items={content} selectedIndex={safeContentIndex} focused={focus === "content"} width={rightWidth} height={bodyHeight} mode={effectiveViewMode} groupBy={effectiveGroupBy} groups={groups} search={search} searching={searching} />
                )}
            </Box>
        );
    } else if (focus === "navigation") {
        body = <NavigationPanel entries={navigation} activeIndex={safeNavigationIndex} focused width={size.width} height={bodyHeight} />;
    } else if (focus === "detail") {
        body = <DetailPanel resource={selectedResource} focused width={size.width} height={bodyHeight} />;
    } else {
        body = <ContentPanel title={title} subtitle={subtitle} items={content} selectedIndex={safeContentIndex} focused width={size.width} height={bodyHeight} mode={effectiveViewMode} groupBy={effectiveGroupBy} groups={groups} search={search} searching={searching} />;
    }

    return (
        <Box width={size.width} height={size.height} flexDirection="column" backgroundColor={colors.background}>
            <Header workspace={workspace} demo={demo} loading={loading} title={title} width={size.width} />
            {body}
            <Footer focus={focus} mode={effectiveViewMode} status={error || status} error={Boolean(error)} width={size.width} />
        </Box>
    );
}