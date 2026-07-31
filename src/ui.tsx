import React from "react";
import { Box, Text } from "ink";
import truncate from "cli-truncate";
import stringWidth from "string-width";
import type { FocusPanel, Issue, ViewMode, WorkspaceData } from "../lib/types.js";
import {
    type ContentResource,
    type GroupBy,
    type NavigationEntry,
    type ResourceGroup,
    isCustomView,
    isIssue,
    isProject,
    isTeam,
    priorityColor,
    priorityGlyph,
    projectStateColor,
    titleCase,
} from "./domain.js";

export const colors = {
    background: "#080A0C",
    panel: "#0D1013",
    panelRaised: "#14191E",
    line: "#303942",
    lineMuted: "#20272D",
    text: "#D7DDE3",
    muted: "#788590",
    faint: "#4C5862",
    cyan: "#65D1C7",
    yellow: "#E9C46A",
    orange: "#E89B62",
    red: "#E06C75",
    blue: "#6EA6D9",
    purple: "#AD8EE6",
    green: "#8CCF7E",
};

export function Panel(props: {
    index: number;
    title: string;
    focused: boolean;
    width?: number | string;
    height?: number;
    children: React.ReactNode;
}) {
    const title = `${props.index} ${props.title}`;
    const titleWidth = typeof props.width === "number"
        ? Math.max(1, props.width - 4 - (props.focused ? 6 : 0))
        : undefined;
    return (
        <Box
            width={props.width}
            height={props.height}
            flexDirection="column"
            borderStyle="single"
            borderColor={props.focused ? colors.cyan : colors.line}
            overflow="hidden"
        >
            <Box height={1} flexShrink={0} paddingX={1} justifyContent="space-between">
                <Text color={props.focused ? colors.cyan : colors.muted} bold={props.focused}>
                    {titleWidth === undefined ? title : truncate(title, titleWidth)}
                </Text>
                <Text color={colors.faint}>{props.focused ? "ACTIVE" : ""}</Text>
            </Box>
            <Box flexGrow={1} flexDirection="column" overflow="hidden">
                {props.children}
            </Box>
        </Box>
    );
}

export function Header(props: {
    workspace: WorkspaceData;
    demo: boolean;
    loading: boolean;
    title: string;
    width: number;
}) {
    const remaining = props.workspace.rateLimit?.requestRemaining;
    const compact = props.width < 64;
    const brand = compact ? "LL " : "LL lazylinear │ ";
    const right = compact
        ? `${props.demo ? "DEMO" : "LIVE"} ${props.loading ? "sync…" : "ready"}`
        : `${props.demo ? "DEMO" : "LIVE"}  ${props.loading ? "syncing…" : "synced"}${remaining === undefined ? "" : `  api ${remaining}`}`;
    const contentWidth = Math.max(1, props.width - 2);
    const middleWidth = Math.max(0, contentWidth - stringWidth(brand) - stringWidth(right) - 1);
    return (
        <Box height={1} paddingX={1} backgroundColor={colors.panelRaised}>
            <Text bold color={colors.cyan}>{compact ? "LL " : "LL"}</Text>
            {!compact && <Text bold color={colors.text}> lazylinear </Text>}
            {!compact && <Text color={colors.faint}>│ </Text>}
            {middleWidth > 0 && (
                <Text color={colors.muted}>{truncate(`${props.workspace.organization.name} / ${props.title}`, middleWidth)}</Text>
            )}
            <Box flexGrow={1} />
            <Text color={props.demo ? colors.yellow : colors.green}>{right}</Text>
        </Box>
    );
}

const sectionGlyphs: Record<string, string> = {
    Workspace: "◇",
    Views: "◫",
    Teams: "▦",
    Projects: "◆",
};

export function NavigationPanel(props: {
    entries: NavigationEntry[];
    activeIndex: number;
    focused: boolean;
    width: number;
    height: number;
}) {
    const available = Math.max(3, props.height - (props.height >= 32 ? 8 : 6));
    const showSections = props.height >= 32;
    const start = Math.max(0, Math.min(props.activeIndex - Math.floor(available / 2), props.entries.length - available));
    const visible = props.entries.slice(start, start + available);
    let previousSection: string | undefined;
    return (
        <Panel index={1} title="Navigation" focused={props.focused} width={props.width} height={props.height}>
            {start > 0 && <Text color={colors.faint}>  ↑ {start} hidden</Text>}
            {visible.map((entry, offset) => {
                const absoluteIndex = start + offset;
                const showSection = showSections && entry.section !== previousSection;
                previousSection = entry.section;
                const labelWidth = Math.max(7, props.width - 11);
                return (
                    <React.Fragment key={entry.id}>
                        {showSection && (
                            <Text color={colors.faint} bold>
                                {` ${sectionGlyphs[entry.section] ?? "·"} ${entry.section.toUpperCase()}`}
                            </Text>
                        )}
                        <Box paddingX={1} backgroundColor={absoluteIndex === props.activeIndex ? colors.panelRaised : undefined}>
                            <Text color={absoluteIndex === props.activeIndex ? colors.cyan : entry.color ?? colors.muted}>
                                {absoluteIndex === props.activeIndex ? "›" : " "} {truncate(entry.label, labelWidth)}
                            </Text>
                            <Box flexGrow={1} />
                            <Text color={colors.faint}>{entry.count ?? ""}</Text>
                        </Box>
                    </React.Fragment>
                );
            })}
            {start + visible.length < props.entries.length && (
                <Text color={colors.faint}>  ↓ {props.entries.length - start - visible.length} hidden</Text>
            )}
        </Panel>
    );
}

function issueLine(issue: Issue, width: number): React.ReactNode {
    const identifierWidth = Math.min(11, Math.max(8, issue.identifier.length + 1));
    const statusWidth = width >= 80 ? 16 : 0;
    const projectWidth = width >= 105 ? 18 : 0;
    const fixed = 3 + identifierWidth + statusWidth + projectWidth;
    const titleWidth = Math.max(12, width - fixed - 5);
    return (
        <>
            <Text color={priorityColor(issue.priority)}>{priorityGlyph(issue.priority)}</Text>
            <Text color={colors.faint}>{issue.identifier.padEnd(identifierWidth)}</Text>
            <Text color={colors.text}>{truncate(issue.title, titleWidth).padEnd(titleWidth)}</Text>
            {statusWidth > 0 && <Text color={issue.state.color}>{` ${truncate(issue.state.name, statusWidth - 1).padEnd(statusWidth - 1)}`}</Text>}
            {projectWidth > 0 && <Text color={colors.muted}>{` ${truncate(issue.project?.name ?? "—", projectWidth - 1)}`}</Text>}
        </>
    );
}

function projectLine(resource: ContentResource, width: number): React.ReactNode {
    if (!isProject(resource)) {
        return null;
    }
    const state = resource.status?.type ?? resource.state ?? "planned";
    const stateLabel = resource.status?.name ?? titleCase(state);
    const progress = Math.round((resource.progress ?? 0) * 100);
    const progressLabel = `${String(progress).padStart(3)}%`;
    const showTarget = width >= 62;
    const statusWidth = showTarget ? 12 : Math.max(7, Math.min(10, Math.floor(width * 0.27)));
    const targetWidth = showTarget ? 12 : 0;
    const fixedWidth = 2 + 1 + statusWidth + 1 + progressLabel.length + targetWidth;
    const nameWidth = Math.max(1, width - fixedWidth);
    return (
        <>
            <Text color={resource.status?.color ?? projectStateColor(state)}>● </Text>
            <Text color={colors.text}>{truncate(resource.name, nameWidth).padEnd(nameWidth)}</Text>
            <Text color={colors.muted}> {truncate(stateLabel, statusWidth).padEnd(statusWidth)}</Text>
            <Text color={colors.cyan}> {progressLabel}</Text>
            {showTarget && <Text color={colors.faint}>{`  ${truncate(resource.targetDate ?? "no target", 10)}`}</Text>}
        </>
    );
}

function teamLine(resource: ContentResource, width: number): React.ReactNode {
    if (!isTeam(resource)) {
        return null;
    }
    const nameWidth = Math.max(14, Math.min(30, width - 24));
    return (
        <>
            <Text color={resource.color ?? colors.cyan}>{`[${resource.key}]`.padEnd(10)}</Text>
            <Text color={colors.text}>{truncate(resource.name, nameWidth).padEnd(nameWidth)}</Text>
            <Text color={colors.muted}>{truncate(resource.description ?? "", Math.max(0, width - nameWidth - 15))}</Text>
        </>
    );
}

export function ListView(props: {
    items: ContentResource[];
    selectedIndex: number;
    width: number;
    height: number;
}) {
    const visibleRows = Math.max(1, props.height - 2);
    const start = Math.max(0, Math.min(props.selectedIndex - Math.floor(visibleRows / 2), props.items.length - visibleRows));
    const visible = props.items.slice(start, start + visibleRows);
    if (props.items.length === 0) {
        return <EmptyState title="Nothing here" body="Change the current view or clear the search filter." />;
    }

    return (
        <Box flexDirection="column">
            {visible.map((resource, offset) => {
                const absoluteIndex = start + offset;
                const selected = absoluteIndex === props.selectedIndex;
                return (
                    <Box
                        key={resource.id}
                        height={1}
                        paddingLeft={1}
                        paddingRight={1}
                        backgroundColor={selected ? colors.panelRaised : undefined}
                    >
                        <Text color={selected ? colors.cyan : colors.faint}>{selected ? "›" : " "}</Text>
                        {isIssue(resource)
                            ? issueLine(resource, props.width - 5)
                            : isProject(resource)
                                ? projectLine(resource, props.width - 5)
                                : teamLine(resource, props.width - 5)}
                    </Box>
                );
            })}
            <Box paddingX={1}>
                <Text color={colors.faint}>
                    {props.items.length} item{props.items.length === 1 ? "" : "s"} · {start + 1}–{Math.min(start + visible.length, props.items.length)}
                </Text>
            </Box>
        </Box>
    );
}

function boardCard(resource: ContentResource, width: number, selected: boolean): React.ReactNode {
    if (isIssue(resource)) {
        return (
            <Box flexDirection="column" paddingX={1} backgroundColor={selected ? colors.panelRaised : undefined}>
                <Text color={selected ? colors.cyan : colors.text} bold={selected}>
                    {selected ? "› " : "  "}{truncate(resource.title, width - 4)}
                </Text>
                <Text color={colors.faint}>
                    {truncate(`  ${resource.identifier}  ${resource.assignee?.displayName ?? "unassigned"}`, Math.max(1, width))}
                </Text>
            </Box>
        );
    }
    if (isProject(resource)) {
        return (
            <Box flexDirection="column" paddingX={1} backgroundColor={selected ? colors.panelRaised : undefined}>
                <Text color={selected ? colors.cyan : colors.text}>{selected ? "› " : "  "}{truncate(resource.name, width - 4)}</Text>
                <Text color={colors.faint}>{truncate(`  ${Math.round((resource.progress ?? 0) * 100)}% · ${resource.targetDate ?? "no target"}`, Math.max(1, width))}</Text>
            </Box>
        );
    }
    return null;
}

export function BoardView(props: {
    groups: ResourceGroup[];
    selectedId?: string;
    width: number;
    height: number;
}) {
    if (props.groups.length === 0) {
        return <EmptyState title="No board cards" body="This view has no resources to group." />;
    }
    const selectedGroupIndex = Math.max(0, props.groups.findIndex((group) => group.items.some((item) => item.id === props.selectedId)));
    const columnCount = props.width >= 105 ? 3 : props.width >= 68 ? 2 : 1;
    const start = Math.max(0, Math.min(selectedGroupIndex - Math.floor(columnCount / 2), props.groups.length - columnCount));
    const visibleGroups = props.groups.slice(start, start + columnCount);
    const columnWidth = Math.max(23, Math.floor((props.width - columnCount - 1) / columnCount));
    const cardRows = Math.max(1, Math.floor((props.height - 4) / 2));
    return (
        <Box flexDirection="row" height={props.height} paddingX={1} columnGap={1}>
            {start > 0 && <Text color={colors.faint}>‹</Text>}
            {visibleGroups.map((group) => {
                const selectedItemIndex = group.items.findIndex((item) => item.id === props.selectedId);
                const cardStart = Math.max(0, selectedItemIndex - Math.floor(cardRows / 2));
                const cards = group.items.slice(cardStart, cardStart + cardRows);
                return (
                    <Box
                        key={group.id}
                        width={columnWidth}
                        height={props.height}
                        flexDirection="column"
                        borderStyle="single"
                        borderColor={selectedItemIndex >= 0 ? colors.cyan : colors.lineMuted}
                    >
                        <Box paddingX={1}>
                            <Text color={group.color}>● </Text>
                            <Text color={colors.text} bold>{truncate(group.label, columnWidth - 9)}</Text>
                            <Box flexGrow={1} />
                            <Text color={colors.faint}>{group.items.length}</Text>
                        </Box>
                        {cards.map((resource) => (
                            <React.Fragment key={resource.id}>
                                {boardCard(resource, columnWidth - 2, resource.id === props.selectedId)}
                            </React.Fragment>
                        ))}
                    </Box>
                );
            })}
            {start + visibleGroups.length < props.groups.length && <Text color={colors.faint}>›</Text>}
        </Box>
    );
}

export function ContentPanel(props: {
    title: string;
    subtitle: string;
    items: ContentResource[];
    selectedIndex: number;
    focused: boolean;
    width: number;
    height: number;
    mode: ViewMode;
    groupBy: GroupBy;
    groups: ResourceGroup[];
    search: string;
    searching: boolean;
}) {
    const selected = props.items[props.selectedIndex];
    const supportsBoard = !props.items.some((item) => isTeam(item));
    const mode = supportsBoard ? props.mode : "list";
    const contextLine = props.searching
        ? `/ ${props.search}▌`
        : props.search
            ? `filter: ${props.search}`
            : mode === "board"
                ? `group: ${props.groupBy}`
                : supportsBoard
                    ? "j/k move · enter inspect"
                    : "teams use list view";
    return (
        <Panel index={2} title={props.title} focused={props.focused} width={props.width} height={props.height}>
            <Box height={2} paddingX={1} flexDirection="column">
                <Box>
                    <Text bold color={colors.text}>{truncate(props.subtitle, Math.max(10, props.width - 32))}</Text>
                    <Box flexGrow={1} />
                    <Text color={mode === "list" ? colors.cyan : colors.muted}>[LIST]</Text>
                    <Text color={colors.faint}> </Text>
                    <Text color={mode === "board" ? colors.cyan : colors.faint}>[BOARD]</Text>
                </Box>
                <Text color={props.searching ? colors.yellow : colors.faint}>
                    {truncate(contextLine, Math.max(1, props.width - 4))}
                </Text>
            </Box>
            {mode === "list" ? (
                <ListView items={props.items} selectedIndex={props.selectedIndex} width={props.width - 2} height={props.height - 5} />
            ) : (
                <BoardView groups={props.groups} selectedId={selected?.id} width={props.width - 2} height={props.height - 5} />
            )}
        </Panel>
    );
}

function Property(props: { label: string; value: string; width: number }) {
    const labelWidth = Math.min(11, Math.max(6, Math.floor(props.width * 0.34)));
    const valueWidth = Math.max(1, props.width - labelWidth);
    return (
        <Box height={1} flexShrink={0}>
            <Text color={colors.faint}>{truncate(props.label, labelWidth).padEnd(labelWidth)}</Text>
            <Text color={colors.muted}>{truncate(props.value, valueWidth)}</Text>
        </Box>
    );
}

function issueDetail(issue: Issue, width: number, height: number): React.ReactNode {
    const contentWidth = Math.max(8, width - 4);
    const descriptionWidth = Math.max(15, width - 6);
    if (height < 30) {
        const labels = issue.labels.map((label) => `#${label.name}`).join("  ");
        return (
            <Box flexDirection="column" paddingX={1} overflow="hidden">
                <Text bold color={colors.text}>{truncate(`${issue.identifier} ${issue.title}`, contentWidth)}</Text>
                <Property label="Status" value={issue.state.name} width={contentWidth} />
                <Property label="Priority" value={issue.priorityLabel ?? "No priority"} width={contentWidth} />
                <Property label="Team" value={issue.team.name} width={contentWidth} />
                <Property label="Project" value={issue.project?.name ?? "—"} width={contentWidth} />
                <Property label="Assignee" value={issue.assignee?.displayName ?? "Unassigned"} width={contentWidth} />
                <Property label="Due / Est" value={`${issue.dueDate ?? "—"} / ${issue.estimate ?? "—"}`} width={contentWidth} />
                <Text color={colors.faint}>DESCRIPTION</Text>
                <Text color={colors.muted}>{truncate(issue.description || "No description.", contentWidth)}</Text>
                {labels && <Text color={colors.purple}>{truncate(labels, contentWidth)}</Text>}
            </Box>
        );
    }
    return (
        <Box flexDirection="column" paddingX={1}>
            <Text color={colors.cyan}>{issue.identifier}</Text>
            <Text bold color={colors.text} wrap="wrap">{issue.title}</Text>
            <Text> </Text>
            <Property label="Status" value={issue.state.name} width={contentWidth} />
            <Property label="Priority" value={issue.priorityLabel ?? "No priority"} width={contentWidth} />
            <Property label="Team" value={issue.team.name} width={contentWidth} />
            <Property label="Project" value={issue.project?.name ?? "—"} width={contentWidth} />
            <Property label="Assignee" value={issue.assignee?.displayName ?? "Unassigned"} width={contentWidth} />
            <Property label="Due" value={issue.dueDate ?? "—"} width={contentWidth} />
            <Property label="Estimate" value={String(issue.estimate ?? "—")} width={contentWidth} />
            <Text> </Text>
            <Text color={colors.faint}>DESCRIPTION</Text>
            <Text color={colors.muted} wrap="wrap">{truncate(issue.description || "No description.", descriptionWidth * 8)}</Text>
            {issue.labels.length > 0 && (
                <>
                    <Text> </Text>
                    <Text color={colors.faint}>LABELS</Text>
                    <Text color={colors.purple}>{issue.labels.map((label) => `#${label.name}`).join("  ")}</Text>
                </>
            )}
        </Box>
    );
}

function projectDetail(resource: ContentResource, width: number, height: number): React.ReactNode {
    if (!isProject(resource)) {
        return null;
    }
    const progress = Math.round((resource.progress ?? 0) * 100);
    const contentWidth = Math.max(8, width - 4);
    const state = resource.status?.name ?? titleCase(resource.state ?? "planned");
    if (height < 30) {
        return (
            <Box flexDirection="column" paddingX={1} overflow="hidden">
                <Text bold color={colors.text}>{truncate(`PROJECT ${resource.name}`, contentWidth)}</Text>
                <Property label="State" value={state} width={contentWidth} />
                <Property label="Progress" value={`${progress}%`} width={contentWidth} />
                <Property label="Teams" value={resource.teams.map((team) => team.key).join(", ")} width={contentWidth} />
                <Property label="Lead" value={resource.lead?.displayName ?? "—"} width={contentWidth} />
                <Property label="Dates" value={`${resource.startDate ?? "—"} → ${resource.targetDate ?? "—"}`} width={contentWidth} />
                <Text color={colors.faint}>DESCRIPTION</Text>
                <Text color={colors.muted}>{truncate(resource.description || "No description.", contentWidth)}</Text>
            </Box>
        );
    }
    return (
        <Box flexDirection="column" paddingX={1}>
            <Text color={resource.color ?? colors.cyan}>PROJECT</Text>
            <Text bold color={colors.text} wrap="wrap">{resource.name}</Text>
            <Text color={colors.muted} wrap="wrap">{resource.summary ?? ""}</Text>
            <Text> </Text>
            <Property label="State" value={state} width={contentWidth} />
            <Property label="Progress" value={`${progress}%`} width={contentWidth} />
            <Property label="Teams" value={resource.teams.map((team) => team.key).join(", ")} width={contentWidth} />
            <Property label="Lead" value={resource.lead?.displayName ?? "—"} width={contentWidth} />
            <Property label="Start" value={resource.startDate ?? "—"} width={contentWidth} />
            <Property label="Target" value={resource.targetDate ?? "—"} width={contentWidth} />
            <Text> </Text>
            <Text color={colors.faint}>DESCRIPTION</Text>
            <Text color={colors.muted} wrap="wrap">{resource.description || "No description."}</Text>
        </Box>
    );
}

function teamDetail(resource: ContentResource, width: number, height: number): React.ReactNode {
    if (!isTeam(resource)) {
        return null;
    }
    const contentWidth = Math.max(8, width - 4);
    if (height < 30) {
        return (
            <Box flexDirection="column" paddingX={1} overflow="hidden">
                <Text bold color={colors.text}>{truncate(`TEAM ${resource.key} ${resource.name}`, contentWidth)}</Text>
                <Property label="Visibility" value={resource.private ? "Private" : "Workspace"} width={contentWidth} />
                <Property label="Updated" value={resource.updatedAt?.slice(0, 10) ?? "—"} width={contentWidth} />
                <Text color={colors.faint}>DESCRIPTION</Text>
                <Text color={colors.muted}>{truncate(resource.description || "No description.", contentWidth)}</Text>
            </Box>
        );
    }
    return (
        <Box flexDirection="column" paddingX={1}>
            <Text color={resource.color ?? colors.cyan}>TEAM  {resource.key}</Text>
            <Text bold color={colors.text} wrap="wrap">{resource.name}</Text>
            <Text> </Text>
            <Property label="Visibility" value={resource.private ? "Private" : "Workspace"} width={contentWidth} />
            <Property label="Updated" value={resource.updatedAt?.slice(0, 10) ?? "—"} width={contentWidth} />
            <Text> </Text>
            <Text color={colors.faint}>DESCRIPTION</Text>
            <Text color={colors.muted} wrap="wrap">{resource.description || "No description."}</Text>
        </Box>
    );
}

export function DetailPanel(props: {
    resource?: ContentResource;
    focused: boolean;
    width: number;
    height: number;
}) {
    return (
        <Panel index={3} title="Inspector" focused={props.focused} width={props.width} height={props.height}>
            {props.resource === undefined ? (
                <EmptyState title="No selection" body="Select an item in the content panel." />
            ) : isIssue(props.resource) ? (
                issueDetail(props.resource, props.width, props.height)
            ) : isProject(props.resource) ? (
                projectDetail(props.resource, props.width, props.height)
            ) : isTeam(props.resource) ? (
                teamDetail(props.resource, props.width, props.height)
            ) : isCustomView(props.resource) ? (
                <Box flexDirection="column" paddingX={1}>
                    <Text color={colors.cyan}>CUSTOM VIEW</Text>
                    <Text bold color={colors.text}>{truncate(props.resource.name, Math.max(8, props.width - 4))}</Text>
                    <Text color={colors.muted}>{truncate(props.resource.description ?? "", Math.max(8, props.width - 4))}</Text>
                    <Text> </Text>
                    <Property label="Visibility" value={props.resource.shared ? "Shared" : "Private"} width={Math.max(8, props.width - 4)} />
                    <Property label="Issues" value={String(props.resource.issueIds.length)} width={Math.max(8, props.width - 4)} />
                </Box>
            ) : null}
        </Panel>
    );
}

export function EmptyState(props: { title: string; body: string }) {
    return (
        <Box flexGrow={1} flexDirection="column" justifyContent="center" alignItems="center" paddingX={2}>
            <Text color={colors.cyan}>◇</Text>
            <Text bold color={colors.text}>{props.title}</Text>
            <Text color={colors.faint} wrap="wrap">{props.body}</Text>
        </Box>
    );
}

export function Footer(props: {
    focus: FocusPanel;
    mode: ViewMode;
    status: string;
    error: boolean;
    width: number;
}) {
    const shortcuts = props.focus === "navigation"
        ? "j/k move  enter open  n new  v new-view  / search  tab panel  ? help  q quit"
        : `j/k move  ${props.mode === "board" ? "h/l column  H/L move-card  " : ""}enter inspect  n new  e edit  d archive  b layout  g group  r refresh`;
    if (props.width < 72 && props.error && props.status.trim() !== "") {
        return (
            <Box height={1} paddingX={1} backgroundColor={colors.panelRaised}>
                <Text color={props.error ? colors.red : colors.muted}>{truncate(props.status, Math.max(1, props.width - 2))}</Text>
            </Box>
        );
    }
    const statusWidth = props.status.trim() === ""
        ? 0
        : props.width < 72
            ? Math.min(20, Math.max(12, Math.floor(props.width * 0.4)))
            : Math.min(Math.max(0, props.width - shortcuts.length - 5), 48);
    return (
        <Box height={1} paddingX={1} backgroundColor={colors.panelRaised}>
            <Text color={colors.yellow}>{truncate(shortcuts, Math.max(10, props.width - statusWidth - 4))}</Text>
            <Box flexGrow={1} />
            <Text color={props.error ? colors.red : colors.muted}>{truncate(props.status, statusWidth)}</Text>
        </Box>
    );
}