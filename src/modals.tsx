import React, { useMemo, useState } from "react";
import { Box, Text, useInput } from "ink";
import truncate from "cli-truncate";
import stringWidth from "string-width";
import type {
    CustomView,
    CustomViewInput,
    Issue,
    IssueInput,
    Project,
    ProjectInput,
    Team,
    TeamInput,
    WorkspaceData,
} from "../lib/types.js";
import type { ContentResource } from "./domain.js";
import { isCustomView, isIssue, isProject, isTeam, titleCase } from "./domain.js";
import { colors } from "./ui.js";

export type EditorKind = "issue" | "project" | "team" | "customView";

export interface EditorContext {
    teamId?: string;
    projectId?: string;
    assigneeId?: string;
}

export type EditorResult =
    | { kind: "issue"; input: IssueInput }
    | { kind: "project"; input: ProjectInput }
    | { kind: "team"; input: TeamInput }
    | { kind: "customView"; input: CustomViewInput };

interface Option {
    value: string;
    label: string;
}

interface FieldDefinition {
    key: string;
    label: string;
    type: "text" | "textarea" | "select" | "boolean";
    required?: boolean;
    hint?: string;
    options?: Option[];
}

interface EditorShape {
    title: string;
    fields: FieldDefinition[];
    initial: Record<string, string>;
}

function option(value: string, label: string): Option {
    return { value, label };
}

function issueShape(workspace: WorkspaceData, issue?: Issue, context?: EditorContext): EditorShape {
    const contextualTeamId = issue === undefined && workspace.teams.some((team) => team.id === context?.teamId)
        ? context?.teamId
        : undefined;
    const contextualProjectId = issue === undefined && workspace.projects.some((project) => project.id === context?.projectId)
        ? context?.projectId
        : undefined;
    const contextualAssigneeId = issue === undefined && workspace.users.some((user) => user.id === context?.assigneeId)
        ? context?.assigneeId
        : undefined;
    const teamId = issue?.team.id ?? contextualTeamId ?? workspace.teams[0]?.id ?? "";
    const teamStates = workspace.workflowStates.filter((state) => state.team?.id === teamId);
    return {
        title: issue ? `Edit ${issue.identifier}` : "Create issue",
        fields: [
            { key: "title", label: "Title", type: "text", required: true },
            { key: "description", label: "Description", type: "textarea", hint: "Markdown is supported by Linear." },
            { key: "teamId", label: "Team", type: "select", required: true, options: workspace.teams.map((team) => option(team.id, `${team.key} · ${team.name}`)) },
            { key: "stateId", label: "Status", type: "select", options: workspace.workflowStates.map((state) => option(state.id, `${state.team?.key ?? "?"} · ${state.name}`)) },
            { key: "priority", label: "Priority", type: "select", options: [option("0", "No priority"), option("1", "Urgent"), option("2", "High"), option("3", "Medium"), option("4", "Low")] },
            { key: "projectId", label: "Project", type: "select", options: [option("", "No project"), ...workspace.projects.map((project) => option(project.id, project.name))] },
            { key: "assigneeId", label: "Assignee", type: "select", options: [option("", "Unassigned"), ...workspace.users.filter((user) => user.active !== false).map((user) => option(user.id, user.displayName))] },
            { key: "labelIds", label: "Labels", type: "text", hint: "Comma-separated label names." },
            { key: "dueDate", label: "Due date", type: "text", hint: "YYYY-MM-DD or blank." },
            { key: "estimate", label: "Estimate", type: "text", hint: "Numeric estimate or blank." },
        ],
        initial: {
            title: issue?.title ?? "",
            description: issue?.description ?? "",
            teamId,
            stateId: issue?.state.id ?? teamStates.find((state) => state.type === "unstarted")?.id ?? teamStates[0]?.id ?? "",
            priority: String(issue?.priority ?? 0),
            projectId: issue?.project?.id ?? contextualProjectId ?? "",
            assigneeId: issue?.assignee?.id ?? contextualAssigneeId ?? "",
            labelIds: issue?.labels.map((label) => label.name).join(", ") ?? "",
            dueDate: issue?.dueDate ?? "",
            estimate: issue?.estimate === undefined || issue.estimate === null ? "" : String(issue.estimate),
        },
    };
}

function projectShape(workspace: WorkspaceData, project?: Project): EditorShape {
    return {
        title: project ? `Edit ${project.name}` : "Create project",
        fields: [
            { key: "name", label: "Name", type: "text", required: true },
            { key: "summary", label: "Summary", type: "text", hint: "Short project summary." },
            { key: "description", label: "Description", type: "textarea" },
            { key: "teamIds", label: "Teams", type: "text", required: true, hint: "Comma-separated team keys, names, or IDs." },
            { key: "statusId", label: "Status", type: "select", options: workspace.projectStatuses.map((status) => option(status.id, status.name)) },
            { key: "leadId", label: "Lead", type: "select", options: [option("", "No lead"), ...workspace.users.filter((user) => user.active !== false).map((user) => option(user.id, user.displayName))] },
            { key: "color", label: "Color", type: "text", hint: "Hex color, for example #5E6AD2." },
            { key: "startDate", label: "Start date", type: "text", hint: "YYYY-MM-DD or blank." },
            { key: "targetDate", label: "Target date", type: "text", hint: "YYYY-MM-DD or blank." },
        ],
        initial: {
            name: project?.name ?? "",
            summary: project?.summary ?? "",
            description: project?.description ?? "",
            teamIds: project?.teams.map((team) => team.key).join(", ") ?? workspace.teams[0]?.key ?? "",
            statusId: project?.status?.id ?? workspace.projectStatuses[0]?.id ?? "",
            leadId: project?.lead?.id ?? "",
            color: project?.color ?? "#5E6AD2",
            startDate: project?.startDate ?? "",
            targetDate: project?.targetDate ?? "",
        },
    };
}

function teamShape(team?: Team): EditorShape {
    return {
        title: team ? `Edit ${team.name}` : "Create team",
        fields: [
            { key: "name", label: "Name", type: "text", required: true },
            { key: "key", label: "Key", type: "text", required: true, hint: "Uppercase issue identifier prefix." },
            { key: "description", label: "Description", type: "textarea" },
            { key: "color", label: "Color", type: "text", hint: "Hex color, for example #65D1C7." },
            { key: "private", label: "Private", type: "boolean", hint: "Private teams require workspace permission." },
        ],
        initial: {
            name: team?.name ?? "",
            key: team?.key ?? "",
            description: team?.description ?? "",
            color: team?.color ?? "#65D1C7",
            private: team?.private ? "true" : "false",
        },
    };
}

function customViewShape(workspace: WorkspaceData, view?: CustomView): EditorShape {
    return {
        title: view ? `Edit ${view.name}` : "Create custom view",
        fields: [
            { key: "name", label: "Name", type: "text", required: true },
            { key: "description", label: "Description", type: "textarea" },
            { key: "shared", label: "Shared", type: "boolean" },
            { key: "teamId", label: "Team filter", type: "select", options: [option("", "Any team"), ...workspace.teams.map((team) => option(team.id, `${team.key} · ${team.name}`))] },
            { key: "stateType", label: "State filter", type: "select", options: [option("", "Any state"), option("backlog", "Backlog"), option("unstarted", "Unstarted"), option("started", "Started"), option("completed", "Completed"), option("canceled", "Canceled")] },
            { key: "priority", label: "Priority filter", type: "select", options: [option("", "Any priority"), option("1", "Urgent"), option("2", "High"), option("3", "Medium"), option("4", "Low"), option("0", "No priority")] },
            { key: "projectId", label: "Project filter", type: "select", options: [option("", "Any project"), ...workspace.projects.map((project) => option(project.id, project.name))] },
            { key: "assigneeId", label: "Assignee filter", type: "select", options: [option("", "Any assignee"), ...workspace.users.filter((user) => user.active !== false).map((user) => option(user.id, user.displayName))] },
            { key: "filterJson", label: "Advanced filter", type: "textarea", hint: "Optional raw IssueFilter JSON. This overrides the simple filters above." },
        ],
        initial: {
            name: view?.name ?? "",
            description: view?.description ?? "",
            shared: view?.shared ? "true" : "false",
            teamId: "",
            stateType: "",
            priority: "",
            projectId: "",
            assigneeId: "",
            filterJson: view?.filterData ? JSON.stringify(view.filterData, null, 2) : "",
        },
    };
}

function buildShape(kind: EditorKind, workspace: WorkspaceData, entity?: ContentResource, context?: EditorContext): EditorShape {
    if (kind === "issue") {
        return issueShape(workspace, entity !== undefined && isIssue(entity) ? entity : undefined, context);
    }
    if (kind === "project") {
        return projectShape(workspace, entity !== undefined && isProject(entity) ? entity : undefined);
    }
    if (kind === "team") {
        return teamShape(entity !== undefined && isTeam(entity) ? entity : undefined);
    }
    return customViewShape(workspace, entity !== undefined && isCustomView(entity) ? entity : undefined);
}

function cursorOnAdjacentLine(value: string, cursor: number, delta: -1 | 1): number {
    const currentLineStart = cursor === 0 ? 0 : value.lastIndexOf("\n", cursor - 1) + 1;
    const column = cursor - currentLineStart;
    if (delta < 0) {
        if (currentLineStart === 0) {
            return cursor;
        }
        const previousLineEnd = currentLineStart - 1;
        const previousLineStart = previousLineEnd === 0 ? 0 : value.lastIndexOf("\n", previousLineEnd - 1) + 1;
        return previousLineStart + Math.min(column, previousLineEnd - previousLineStart);
    }

    const currentLineEnd = value.indexOf("\n", cursor);
    if (currentLineEnd < 0) {
        return cursor;
    }
    const nextLineStart = currentLineEnd + 1;
    const followingBreak = value.indexOf("\n", nextLineStart);
    const nextLineEnd = followingBreak < 0 ? value.length : followingBreak;
    return nextLineStart + Math.min(column, nextLineEnd - nextLineStart);
}

function cursorAtLineBoundary(value: string, cursor: number, end: boolean): number {
    if (!end) {
        return cursor === 0 ? 0 : value.lastIndexOf("\n", cursor - 1) + 1;
    }
    const nextBreak = value.indexOf("\n", cursor);
    return nextBreak < 0 ? value.length : nextBreak;
}

function cursorBeforeCharacter(value: string, cursor: number): number {
    if (cursor <= 0) {
        return 0;
    }
    const character = Array.from(value.slice(0, cursor)).at(-1);
    return Math.max(0, cursor - (character?.length ?? 1));
}

function cursorAfterCharacter(value: string, cursor: number): number {
    if (cursor >= value.length) {
        return value.length;
    }
    const character = Array.from(value.slice(cursor))[0];
    return Math.min(value.length, cursor + (character?.length ?? 1));
}

function flattenedEditorText(value: string, textarea: boolean): string {
    return textarea ? value.replace(/\r?\n/gu, " ↵ ") : value;
}

function editorTextAroundCursor(value: string, cursor: number, width: number, textarea: boolean): string {
    const beforeCursor = flattenedEditorText(value.slice(0, cursor), textarea);
    const afterCursor = flattenedEditorText(value.slice(cursor), textarea);
    const available = Math.max(0, width - 1);
    const beforeWidth = stringWidth(beforeCursor);
    const afterWidth = stringWidth(afterCursor);
    let beforeBudget = Math.min(beforeWidth, Math.ceil(available / 2));
    let afterBudget = Math.min(afterWidth, available - beforeBudget);
    beforeBudget = Math.min(beforeWidth, available - afterBudget);
    afterBudget = Math.min(afterWidth, available - beforeBudget);
    const visibleBefore = beforeBudget <= 0
        ? ""
        : beforeWidth <= beforeBudget
            ? beforeCursor
            : truncate(beforeCursor, beforeBudget, { position: "start" });
    const visibleAfter = afterBudget <= 0
        ? ""
        : afterWidth <= afterBudget
            ? afterCursor
            : truncate(afterCursor, afterBudget);
    return `${visibleBefore}▌${visibleAfter}`;
}

function buildCustomViewFilter(values: Record<string, string>): Record<string, unknown> {
    const filterJson = values.filterJson ?? "";
    if (filterJson.trim() !== "") {
        const parsed = JSON.parse(filterJson) as unknown;
        if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
            throw new Error("Advanced filter JSON must be an object.");
        }
        return parsed as Record<string, unknown>;
    }

    const filters: Record<string, unknown>[] = [];
    if (values.teamId) {
        filters.push({ team: { id: { eq: values.teamId } } });
    }
    if (values.stateType) {
        filters.push({ state: { type: { eq: values.stateType } } });
    }
    if (values.priority !== "") {
        filters.push({ priority: { eq: Number(values.priority) } });
    }
    if (values.projectId) {
        filters.push({ project: { id: { eq: values.projectId } } });
    }
    if (values.assigneeId) {
        filters.push({ assignee: { id: { eq: values.assigneeId } } });
    }
    if (filters.length === 0) {
        return {};
    }
    return filters.length === 1 ? filters[0]! : { and: filters };
}

function buildResult(kind: EditorKind, values: Record<string, string>, workspace: WorkspaceData): EditorResult {
    const value = (key: string) => values[key] ?? "";
    if (kind === "issue") {
        const requestedLabels = value("labelIds").split(",").map((name) => name.trim()).filter(Boolean);
        const labelIds: string[] = [];
        for (const requestedLabel of requestedLabels) {
            const identifierMatch = workspace.labels.find((label) => label.id.toLocaleLowerCase() === requestedLabel.toLocaleLowerCase());
            if (identifierMatch) {
                labelIds.push(identifierMatch.id);
                continue;
            }
            const nameMatches = workspace.labels.filter((label) => label.name.toLocaleLowerCase() === requestedLabel.toLocaleLowerCase());
            if (nameMatches.length === 0) {
                throw new Error(`Unknown label “${requestedLabel}”. Use a visible label name or ID.`);
            }
            if (nameMatches.length > 1) {
                throw new Error(`Label “${requestedLabel}” is ambiguous. Use its ID.`);
            }
            labelIds.push(nameMatches[0]!.id);
        }
        const estimate = value("estimate").trim() === "" ? null : Number(value("estimate"));
        if (estimate !== null && !Number.isFinite(estimate)) {
            throw new Error("Estimate must be numeric or blank.");
        }
        const selectedTeamId = value("teamId");
        const selectedState = workspace.workflowStates.find((state) => state.id === value("stateId"));
        const stateId = selectedState?.team?.id === selectedTeamId
            ? selectedState.id
            : workspace.workflowStates.find((state) => state.team?.id === selectedTeamId && state.type === "unstarted")?.id
                ?? workspace.workflowStates.find((state) => state.team?.id === selectedTeamId)?.id;
        return {
            kind,
            input: {
                title: value("title").trim(),
                description: value("description"),
                teamId: selectedTeamId,
                stateId,
                priority: Number(value("priority")),
                projectId: value("projectId") || null,
                assigneeId: value("assigneeId") || null,
                labelIds: [...new Set(labelIds)],
                dueDate: value("dueDate").trim() || null,
                estimate,
            },
        };
    }
    if (kind === "project") {
        const requestedTeams = value("teamIds").split(",").map((team) => team.trim()).filter(Boolean);
        const teamIds: string[] = [];
        for (const requestedTeam of requestedTeams) {
            const lowered = requestedTeam.toLocaleLowerCase();
            const matches = workspace.teams.filter((team) => team.id.toLocaleLowerCase() === lowered
                || team.key.toLocaleLowerCase() === lowered
                || team.name.toLocaleLowerCase() === lowered);
            if (matches.length === 0) {
                throw new Error(`Unknown team “${requestedTeam}”. Use a visible team key, name, or ID.`);
            }
            if (matches.length > 1) {
                throw new Error(`Team “${requestedTeam}” is ambiguous. Use its ID.`);
            }
            teamIds.push(matches[0]!.id);
        }
        if (teamIds.length === 0) {
            throw new Error("At least one valid team key, name, or ID is required.");
        }
        return {
            kind,
            input: {
                name: value("name").trim(),
                description: value("summary").trim(),
                content: value("description"),
                teamIds: [...new Set(teamIds)],
                statusId: value("statusId") || undefined,
                leadId: value("leadId") || null,
                color: value("color").trim() || undefined,
                startDate: value("startDate").trim() || null,
                targetDate: value("targetDate").trim() || null,
            },
        };
    }
    if (kind === "team") {
        return {
            kind,
            input: {
                name: value("name").trim(),
                key: value("key").trim().toUpperCase(),
                description: value("description"),
                color: value("color").trim() || undefined,
                private: value("private") === "true",
            },
        };
    }
    return {
        kind,
        input: {
            name: value("name").trim(),
            description: value("description"),
            shared: value("shared") === "true",
            filterData: buildCustomViewFilter(values),
        },
    };
}

export function ModalShell(props: { title: string; width: number; height: number; children: React.ReactNode; footer?: string }) {
    const modalWidth = Math.min(82, Math.max(42, props.width - 8));
    const modalHeight = Math.min(props.height - 4, 28);
    const textWidth = Math.max(1, modalWidth - 4);
    return (
        <Box width={props.width} height={props.height} justifyContent="center" alignItems="center">
            <Box width={modalWidth} height={modalHeight} flexDirection="column" borderStyle="double" borderColor={colors.cyan}>
                <Box height={1} flexShrink={0} paddingX={1}>
                    <Text bold color={colors.cyan}>{truncate(`◆ ${props.title}`, textWidth)}</Text>
                </Box>
                <Box flexGrow={1} flexDirection="column" paddingX={1} overflow="hidden">
                    {props.children}
                </Box>
                <Box height={1} flexShrink={0} paddingX={1}>
                    <Text color={colors.yellow}>{truncate(props.footer ?? "esc cancel", textWidth)}</Text>
                </Box>
            </Box>
        </Box>
    );
}

export function EditorModal(props: {
    kind: EditorKind;
    workspace: WorkspaceData;
    entity?: ContentResource;
    context?: EditorContext;
    width: number;
    height: number;
    saving?: boolean;
    externalError?: string;
    onCancel: () => void;
    onSubmit: (result: EditorResult) => void;
}) {
    const shape = useMemo(
        () => buildShape(props.kind, props.workspace, props.entity, props.context),
        [props.kind, props.workspace, props.entity, props.context?.teamId, props.context?.projectId, props.context?.assigneeId],
    );
    const [values, setValues] = useState<Record<string, string>>(shape.initial);
    const [cursorPositions, setCursorPositions] = useState<Record<string, number>>(() => Object.fromEntries(
        Object.entries(shape.initial).map(([key, value]) => [key, value.length]),
    ));
    const [activeIndex, setActiveIndex] = useState(0);
    const [error, setError] = useState("");
    const fields = useMemo(() => shape.fields.map((field) => {
        if (props.kind !== "issue" || field.key !== "stateId") {
            return field;
        }
        const teamId = values.teamId ?? "";
        return {
            ...field,
            options: props.workspace.workflowStates
                .filter((state) => state.team?.id === teamId)
                .map((state) => option(state.id, state.name)),
        };
    }), [props.kind, props.workspace.workflowStates, shape.fields, values.teamId]);
    const activeField = fields[activeIndex]!;
    const activeValue = values[activeField.key] ?? "";
    const activeCursor = Math.max(0, Math.min(cursorPositions[activeField.key] ?? activeValue.length, activeValue.length));
    const visibleError = error || props.externalError || "";

    function updateActive(value: string): void {
        setValues((current) => {
            if (props.kind === "issue" && activeField.key === "teamId") {
                const defaultState = props.workspace.workflowStates.find((state) => state.team?.id === value && state.type === "unstarted")
                    ?? props.workspace.workflowStates.find((state) => state.team?.id === value);
                return { ...current, teamId: value, stateId: defaultState?.id ?? "" };
            }
            return { ...current, [activeField.key]: value };
        });
        setError("");
    }

    function updateActiveText(value: string, cursor: number): void {
        setValues((current) => ({ ...current, [activeField.key]: value }));
        setCursorPositions((current) => ({ ...current, [activeField.key]: Math.max(0, Math.min(cursor, value.length)) }));
        setError("");
    }

    function moveActiveCursor(cursor: number): void {
        setCursorPositions((current) => ({
            ...current,
            [activeField.key]: Math.max(0, Math.min(cursor, activeValue.length)),
        }));
    }

    function moveField(delta: number): void {
        setActiveIndex((current) => (current + delta + fields.length) % fields.length);
    }

    function cycleOption(delta: number): void {
        const options = activeField.options ?? [];
        if (options.length === 0) {
            return;
        }
        const currentIndex = Math.max(0, options.findIndex((candidate) => candidate.value === values[activeField.key]));
        const next = options[(currentIndex + delta + options.length) % options.length]!;
        updateActive(next.value);
    }

    function submit(): void {
        const missing = fields.find((field) => field.required && !values[field.key]?.trim());
        if (missing) {
            setError(`${missing.label} is required.`);
            setActiveIndex(fields.indexOf(missing));
            return;
        }
        try {
            props.onSubmit(buildResult(props.kind, values, props.workspace));
        } catch (submitError) {
            setError(submitError instanceof Error ? submitError.message : String(submitError));
        }
    }

    useInput((input, key) => {
        if (key.escape) {
            props.onCancel();
            return;
        }
        if (key.ctrl && input.toLocaleLowerCase() === "s") {
            submit();
            return;
        }
        if (key.tab) {
            moveField(key.shift ? -1 : 1);
            return;
        }
        if (activeField.type === "select") {
            if (key.upArrow || key.downArrow) {
                moveField(key.upArrow ? -1 : 1);
            } else if (key.leftArrow || input === "h") {
                cycleOption(-1);
            } else if (key.rightArrow || input === "l" || input === " ") {
                cycleOption(1);
            } else if (key.return) {
                moveField(1);
            }
            return;
        }
        if (activeField.type === "boolean") {
            if (key.upArrow || key.downArrow) {
                moveField(key.upArrow ? -1 : 1);
            } else if (input === " " || key.leftArrow || key.rightArrow || key.return) {
                updateActive(values[activeField.key] === "true" ? "false" : "true");
            }
            return;
        }
        if (key.leftArrow) {
            moveActiveCursor(cursorBeforeCharacter(activeValue, activeCursor));
            return;
        }
        if (key.rightArrow) {
            moveActiveCursor(cursorAfterCharacter(activeValue, activeCursor));
            return;
        }
        if (key.home) {
            moveActiveCursor(activeField.type === "textarea" ? cursorAtLineBoundary(activeValue, activeCursor, false) : 0);
            return;
        }
        if (key.end) {
            moveActiveCursor(activeField.type === "textarea" ? cursorAtLineBoundary(activeValue, activeCursor, true) : activeValue.length);
            return;
        }
        if (key.upArrow || key.downArrow) {
            if (activeField.type === "textarea") {
                moveActiveCursor(cursorOnAdjacentLine(activeValue, activeCursor, key.upArrow ? -1 : 1));
            } else {
                moveField(key.upArrow ? -1 : 1);
            }
            return;
        }
        if (key.ctrl && input.toLocaleLowerCase() === "d") {
            if (activeCursor < activeValue.length) {
                const nextCursor = cursorAfterCharacter(activeValue, activeCursor);
                updateActiveText(`${activeValue.slice(0, activeCursor)}${activeValue.slice(nextCursor)}`, activeCursor);
            }
            return;
        }
        if (key.backspace || key.delete) {
            if (activeCursor > 0) {
                const previousCursor = cursorBeforeCharacter(activeValue, activeCursor);
                updateActiveText(`${activeValue.slice(0, previousCursor)}${activeValue.slice(activeCursor)}`, previousCursor);
            }
            return;
        }
        if (key.return) {
            if (activeField.type === "textarea") {
                updateActiveText(`${activeValue.slice(0, activeCursor)}\n${activeValue.slice(activeCursor)}`, activeCursor + 1);
            } else {
                moveField(1);
            }
            return;
        }
        if (!key.ctrl && !key.meta && input) {
            const inserted = activeField.type === "textarea"
                ? input.replace(/\r\n?/gu, "\n")
                : input.replace(/\r?\n/gu, " ");
            updateActiveText(`${activeValue.slice(0, activeCursor)}${inserted}${activeValue.slice(activeCursor)}`, activeCursor + inserted.length);
        }
    }, { isActive: !props.saving });

    const modalHeight = Math.min(props.height - 4, 28);
    const modalWidth = Math.min(82, Math.max(42, props.width - 8));
    const contentWidth = Math.max(1, modalWidth - 4);
    const reservedRows = 2 + (activeField.hint ? 1 : 0) + (visibleError ? 1 : 0);
    const visibleCount = Math.max(1, Math.min(fields.length, modalHeight - 4 - reservedRows));
    const start = Math.max(0, Math.min(activeIndex - Math.floor(visibleCount / 2), fields.length - visibleCount));
    const visibleFields = fields.slice(start, start + visibleCount);
    return (
        <ModalShell
            title={shape.title}
            width={props.width}
            height={props.height}
            footer={props.saving ? "saving…" : "tab field · arrows edit/choose · ctrl+s save · esc cancel"}
        >
            <Text color={colors.faint}>Fields marked * are required.</Text>
            <Text> </Text>
            {visibleFields.map((field, offset) => {
                const index = start + offset;
                const active = index === activeIndex;
                const rawValue = values[field.key] ?? "";
                const selectedOption = field.options?.find((candidate) => candidate.value === rawValue);
                const label = `${active ? "› " : "  "}${field.label}${field.required ? " *" : ""}`;
                const valueWidth = Math.max(1, contentWidth - stringWidth(label) - 2);
                const displayValue = field.type === "boolean"
                    ? rawValue === "true" ? "[x] yes" : "[ ] no"
                    : field.type === "select"
                        ? `‹ ${selectedOption?.label ?? "—"} ›`
                        : active
                            ? editorTextAroundCursor(rawValue, Math.max(0, Math.min(cursorPositions[field.key] ?? rawValue.length, rawValue.length)), valueWidth, field.type === "textarea")
                            : flattenedEditorText(rawValue, field.type === "textarea");
                const visibleValue = displayValue || (active ? "▌" : "—");
                return (
                    <Box key={field.key} flexDirection="column" flexShrink={0} backgroundColor={active ? colors.panelRaised : undefined}>
                        <Box height={1} flexShrink={0}>
                            <Text color={active ? colors.cyan : colors.muted}>{label}</Text>
                            <Text color={active ? colors.text : colors.faint}>  {truncate(visibleValue, valueWidth)}</Text>
                        </Box>
                        {active && field.hint && <Text color={colors.faint}>{truncate(`    ${field.hint}`, contentWidth)}</Text>}
                    </Box>
                );
            })}
            <Box flexGrow={1} />
            {visibleError && <Text color={colors.red}>{truncate(`! ${visibleError}`, contentWidth)}</Text>}
        </ModalShell>
    );
}

export function HelpModal(props: { width: number; height: number; onClose: () => void }) {
    const [start, setStart] = useState(0);
    const rows = [
        ["1 / 2 / 3", "focus navigation, content, or inspector"],
        ["tab", "cycle focused panel"],
        ["j / k", "move selection down or up"],
        ["h / l", "move between board columns"],
        ["H / L", "move selected card to the previous / next column"],
        ["enter", "open selection / focus inspector"],
        ["/", "search current view"],
        ["b", "toggle list and board layout"],
        ["g", "cycle board grouping"],
        ["n", "create in the current context"],
        ["e", "edit selected resource"],
        ["d", "archive selected resource"],
        ["space", "advance issue to next workflow state"],
        ["r", "refresh from Linear"],
        ["?", "show this help"],
        ["q", "quit LazyLinear"],
    ];
    const modalWidth = Math.min(82, Math.max(42, props.width - 8));
    const contentWidth = Math.max(1, modalWidth - 4);
    const keyWidth = Math.min(12, Math.max(5, Math.floor(contentWidth * 0.32)));
    const descriptionWidth = Math.max(1, contentWidth - keyWidth);
    const visibleCount = Math.max(4, Math.min(rows.length, Math.min(props.height - 4, 28) - 5));
    useInput((input, key) => {
        if (key.escape || input === "q" || key.return) {
            props.onClose();
        } else if (input === "j" || key.downArrow || key.pageDown) {
            setStart((current) => Math.min(rows.length - visibleCount, current + visibleCount));
        } else if (input === "k" || key.upArrow || key.pageUp) {
            setStart((current) => Math.max(0, current - visibleCount));
        }
    });
    return (
        <ModalShell title="Keybindings" width={props.width} height={props.height} footer="j/k page · enter/esc close">
            {rows.slice(start, start + visibleCount).map(([keys, description]) => (
                <Box key={keys} height={1} flexShrink={0}>
                    <Text color={colors.yellow}>{truncate(keys!, keyWidth).padEnd(keyWidth)}</Text>
                    <Text color={colors.muted}>{truncate(description!, descriptionWidth)}</Text>
                </Box>
            ))}
            <Box flexGrow={1} />
            <Text color={colors.faint}>{start + 1}–{Math.min(start + visibleCount, rows.length)} of {rows.length}</Text>
        </ModalShell>
    );
}

export function ConfirmModal(props: {
    title: string;
    body: string;
    width: number;
    height: number;
    saving?: boolean;
    externalError?: string;
    onConfirm: () => void;
    onCancel: () => void;
}) {
    useInput((input, key) => {
        if (input.toLocaleLowerCase() === "y" || key.return) {
            props.onConfirm();
        } else if (input.toLocaleLowerCase() === "n" || key.escape) {
            props.onCancel();
        }
    }, { isActive: !props.saving });
    const messageWidth = Math.max(12, Math.min(78, props.width - 12));
    return (
        <ModalShell
            title={props.title}
            width={props.width}
            height={props.height}
            footer={props.saving ? "working…" : "y / enter confirm · n / esc cancel"}
        >
            <Box flexGrow={1} flexDirection="column" justifyContent="center" paddingX={2}>
                <Text color={colors.red} bold>Confirm this destructive action?</Text>
                <Text color={colors.muted} wrap="wrap">{props.body}</Text>
                {props.saving && <Text color={colors.yellow}>Working…</Text>}
                {props.externalError && <Text color={colors.red}>{truncate(`! ${props.externalError}`, messageWidth)}</Text>}
            </Box>
        </ModalShell>
    );
}

export function TokenModal(props: {
    width: number;
    height: number;
    error?: string;
    loading: boolean;
    onSubmit: (token: string) => void;
    onDemo: () => void;
    onQuit: () => void;
}) {
    const [token, setToken] = useState("");
    const compact = props.width < 60 || props.height < 22;
    const maskWidth = Math.max(8, Math.min(48, props.width - 17));
    const messageWidth = Math.max(12, props.width - 12);
    useInput((input, key) => {
        if (key.escape) {
            props.onQuit();
            return;
        }
        if (key.ctrl && input.toLocaleLowerCase() === "d") {
            props.onDemo();
            return;
        }
        if (key.return && token.trim()) {
            props.onSubmit(token.trim());
            return;
        }
        if (key.backspace || key.delete) {
            setToken((current) => current.slice(0, -1));
            return;
        }
        if (!key.ctrl && !key.meta && input) {
            setToken((current) => `${current}${input}`);
        }
    }, { isActive: !props.loading });
    return (
        <ModalShell
            title="Connect to Linear"
            width={props.width}
            height={props.height}
            footer={compact ? "enter connect · ^d demo · esc quit" : "enter connect · ctrl+d demo workspace · esc quit"}
        >
            <Box flexGrow={1} flexDirection="column" justifyContent="center" paddingX={2}>
                <Text color={colors.text} bold>{compact ? "Paste a Linear token." : "Paste a personal API key or OAuth access token."}</Text>
                <Text color={colors.faint}>{compact ? "Kept in memory only." : "The token stays in this process and is never written to disk."}</Text>
                <Text> </Text>
                <Box width="100%" height={4} flexShrink={0}>
                    <Box width="100%" height={3} flexShrink={0} borderStyle="single" borderColor={colors.cyan} paddingX={1}>
                        <Text color={colors.text}>{token ? "•".repeat(Math.min(token.length, maskWidth)) : "lin_api_…"}</Text>
                        {!props.loading && <Text color={colors.cyan}>▌</Text>}
                    </Box>
                </Box>
                <Text color={colors.faint}>{compact ? "Settings → Security & access" : "Create a key in Linear → Settings → Security & access."}</Text>
                {props.loading && <Text color={colors.yellow}>Connecting to Linear…</Text>}
                {props.error && <Text color={colors.red}>{truncate(`! ${props.error}`, messageWidth)}</Text>}
            </Box>
        </ModalShell>
    );
}