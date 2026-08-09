import React, { useMemo, useState } from "react";
import { Box, Text, useInput } from "ink";
import truncate from "cli-truncate";
import stringWidth from "string-width";
import type { WorkspaceSave, WorkspaceSnapshot } from "../lib/types.js";
import { COMMANDS } from "./commands.js";
import { customViewEditorDefinition, type CustomViewEditorValues } from "./editor/custom-view-editor.js";
import { issueEditorDefinition, type IssueEditorValues } from "./editor/issue-editor.js";
import { projectEditorDefinition, type ProjectEditorValues } from "./editor/project-editor.js";
import { teamEditorDefinition, type TeamEditorValues } from "./editor/team-editor.js";
import type {
    EditorDefinition,
    EditorDefinitionContext,
    EditorField,
    EditorTarget,
} from "./editor/types.js";
import { colors } from "./ui.js";

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

function ModalShell(props: {
    readonly title: string;
    readonly width: number;
    readonly height: number;
    readonly children: React.ReactNode;
    readonly footer?: string;
}) {
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

interface TypedEditorProps<TValues extends object, TTarget extends EditorTarget> {
    readonly definition: EditorDefinition<TValues, TTarget>;
    readonly context: EditorDefinitionContext<TTarget>;
    readonly width: number;
    readonly height: number;
    readonly saving: boolean;
    readonly externalError: string;
    readonly onCancel: () => void;
    readonly onSubmit: (change: WorkspaceSave) => void;
}

function valueAt<TValues extends object>(values: Readonly<TValues>, field: EditorField<TValues>): string {
    return String(values[field.key] ?? "");
}

function TypedEditor<TValues extends object, TTarget extends EditorTarget>(props: TypedEditorProps<TValues, TTarget>) {
    const [values, setValues] = useState<TValues>(() => props.definition.initialValues(props.context));
    const [cursorPositions, setCursorPositions] = useState<Partial<Record<Extract<keyof TValues, string>, number>>>(() => {
        const initial = props.definition.initialValues(props.context);
        return Object.fromEntries(props.definition.fields(initial, props.context)
            .map((field) => [field.key, valueAt(initial, field).length])) as Partial<Record<Extract<keyof TValues, string>, number>>;
    });
    const [activeIndex, setActiveIndex] = useState(0);
    const [error, setError] = useState("");
    const fields = useMemo(
        () => props.definition.fields(values, props.context),
        [props.definition, props.context, values],
    );
    const activeField = fields[activeIndex] ?? fields[0]!;
    const activeValue = valueAt(values, activeField);
    const activeCursor = Math.max(0, Math.min(cursorPositions[activeField.key] ?? activeValue.length, activeValue.length));
    const visibleError = error || props.externalError;

    function updateActive(value: string): void {
        setValues((current) => props.definition.applyChange
            ? props.definition.applyChange(current, activeField.key, value, props.context)
            : { ...current, [activeField.key]: value });
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
        const currentIndex = Math.max(0, options.findIndex((candidate) => candidate.value === activeValue));
        updateActive(options[(currentIndex + delta + options.length) % options.length]!.value);
    }

    function submit(): void {
        const validation = props.definition.validate(values, props.context);
        if (!validation.valid) {
            setError(validation.message);
            const invalidIndex = fields.findIndex((field) => field.key === validation.field);
            if (invalidIndex >= 0) {
                setActiveIndex(invalidIndex);
            }
            return;
        }
        props.onSubmit(props.definition.decode(values, props.context));
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
                updateActive(activeValue === "true" ? "false" : "true");
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
    return (
        <ModalShell
            title={props.definition.title(props.context)}
            width={props.width}
            height={props.height}
            footer={props.saving ? "saving…" : "tab field · arrows edit/choose · ctrl+s save · esc cancel"}
        >
            <Text color={colors.faint}>Fields marked * are required.</Text>
            <Text> </Text>
            {fields.slice(start, start + visibleCount).map((field, offset) => {
                const index = start + offset;
                const active = index === activeIndex;
                const rawValue = valueAt(values, field);
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
                return (
                    <Box key={field.key} flexDirection="column" flexShrink={0} backgroundColor={active ? colors.panelRaised : undefined}>
                        <Box height={1} flexShrink={0}>
                            <Text color={active ? colors.cyan : colors.muted}>{label}</Text>
                            <Text color={active ? colors.text : colors.faint}>  {truncate(displayValue || (active ? "▌" : "—"), valueWidth)}</Text>
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

export function EditorModal(props: {
    readonly target: EditorTarget;
    readonly snapshot: WorkspaceSnapshot;
    readonly width: number;
    readonly height: number;
    readonly saving?: boolean;
    readonly externalError?: string;
    readonly onCancel: () => void;
    readonly onSubmit: (change: WorkspaceSave) => void;
}) {
    const common = {
        width: props.width,
        height: props.height,
        saving: props.saving ?? false,
        externalError: props.externalError ?? "",
        onCancel: props.onCancel,
        onSubmit: props.onSubmit,
    };
    if (props.target.kind === "issue") {
        return <TypedEditor<IssueEditorValues, typeof props.target> {...common} definition={issueEditorDefinition} context={{ snapshot: props.snapshot, target: props.target }} />;
    }
    if (props.target.kind === "project") {
        return <TypedEditor<ProjectEditorValues, typeof props.target> {...common} definition={projectEditorDefinition} context={{ snapshot: props.snapshot, target: props.target }} />;
    }
    if (props.target.kind === "team") {
        return <TypedEditor<TeamEditorValues, typeof props.target> {...common} definition={teamEditorDefinition} context={{ snapshot: props.snapshot, target: props.target }} />;
    }
    return <TypedEditor<CustomViewEditorValues, typeof props.target> {...common} definition={customViewEditorDefinition} context={{ snapshot: props.snapshot, target: props.target }} />;
}

export function HelpModal(props: { readonly width: number; readonly height: number; readonly onClose: () => void }) {
    const [start, setStart] = useState(0);
    const modalWidth = Math.min(82, Math.max(42, props.width - 8));
    const contentWidth = Math.max(1, modalWidth - 4);
    const keyWidth = Math.min(12, Math.max(5, Math.floor(contentWidth * 0.32)));
    const descriptionWidth = Math.max(1, contentWidth - keyWidth);
    const visibleCount = Math.max(4, Math.min(COMMANDS.length, Math.min(props.height - 4, 28) - 5));
    useInput((input, key) => {
        if (key.escape || input === "q" || key.return) {
            props.onClose();
        } else if (input === "j" || key.downArrow || key.pageDown) {
            setStart((current) => Math.min(COMMANDS.length - visibleCount, current + visibleCount));
        } else if (input === "k" || key.upArrow || key.pageUp) {
            setStart((current) => Math.max(0, current - visibleCount));
        }
    });
    return (
        <ModalShell title="Keybindings" width={props.width} height={props.height} footer="j/k page · enter/esc close">
            {COMMANDS.slice(start, start + visibleCount).map((command) => (
                <Box key={command.id} height={1} flexShrink={0}>
                    <Text color={colors.yellow}>{truncate(command.keys, keyWidth).padEnd(keyWidth)}</Text>
                    <Text color={colors.muted}>{truncate(command.helpLabel, descriptionWidth)}</Text>
                </Box>
            ))}
            <Box flexGrow={1} />
            <Text color={colors.faint}>{start + 1}–{Math.min(start + visibleCount, COMMANDS.length)} of {COMMANDS.length}</Text>
        </ModalShell>
    );
}

export function ConfirmModal(props: {
    readonly title: string;
    readonly body: string;
    readonly width: number;
    readonly height: number;
    readonly saving?: boolean;
    readonly externalError?: string;
    readonly onConfirm: () => void;
    readonly onCancel: () => void;
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
        <ModalShell title={props.title} width={props.width} height={props.height} footer={props.saving ? "working…" : "y / enter confirm · n / esc cancel"}>
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
    readonly width: number;
    readonly height: number;
    readonly error?: string;
    readonly loading: boolean;
    readonly onSubmit: (token: string) => void;
    readonly onDemo: () => void;
    readonly onQuit: () => void;
}) {
    const [token, setToken] = useState("");
    const compact = props.width < 60 || props.height < 22;
    const maskWidth = Math.max(8, Math.min(48, props.width - 17));
    const messageWidth = Math.max(12, props.width - 12);
    useInput((input, key) => {
        if (key.escape) {
            props.onQuit();
        } else if (key.ctrl && input.toLocaleLowerCase() === "d") {
            props.onDemo();
        } else if (key.return && token.trim()) {
            props.onSubmit(token.trim());
        } else if (key.backspace || key.delete) {
            setToken((current) => current.slice(0, -1));
        } else if (!key.ctrl && !key.meta && input) {
            setToken((current) => `${current}${input}`);
        }
    }, { isActive: !props.loading });
    return (
        <ModalShell title="Connect to Linear" width={props.width} height={props.height} footer={compact ? "enter connect · ^d demo · esc quit" : "enter connect · ctrl+d demo workspace · esc quit"}>
            <Box flexGrow={1} flexDirection="column" justifyContent="center" paddingX={2}>
                <Text color={colors.text} bold>{compact ? "Paste a Linear token." : "Paste a personal API key or OAuth access token."}</Text>
                <Text color={colors.faint}>{compact ? "Choose whether to save after validation." : "After validation, you can choose whether to save it for future launches."}</Text>
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

export function TokenPersistenceModal(props: {
    readonly width: number;
    readonly height: number;
    readonly saving: boolean;
    readonly error?: string;
    readonly onSave: () => void;
    readonly onSkip: () => void;
}) {
    const compact = props.width < 60 || props.height < 22;
    const messageWidth = Math.max(12, props.width - 12);
    useInput((input, key) => {
        if (input.toLocaleLowerCase() === "y") {
            props.onSave();
        } else if (input.toLocaleLowerCase() === "n" || key.escape) {
            props.onSkip();
        }
    }, { isActive: !props.saving });
    return (
        <ModalShell
            title="Remember Linear token?"
            width={props.width}
            height={props.height}
            footer={props.saving ? "saving…" : "y save · n / esc skip"}
        >
            <Box flexGrow={1} flexDirection="column" justifyContent="center" paddingX={2}>
                <Text color={colors.text} bold>{compact ? "Save to ~/.lazylinear/.env?" : "Save this token as LINEAR_API_KEY in ~/.lazylinear/.env?"}</Text>
                <Text color={colors.muted} wrap="wrap">Future LazyLinear launches will connect without asking for the token again.</Text>
                <Text> </Text>
                <Text color={colors.yellow} wrap="wrap">The value is stored in plain text inside your user profile and can be read by other processes running as you.</Text>
                {props.saving && <Text color={colors.yellow}>Saving LINEAR_API_KEY…</Text>}
                {props.error && <Text color={colors.red}>{truncate(`! ${props.error}`, messageWidth)}</Text>}
            </Box>
        </ModalShell>
    );
}