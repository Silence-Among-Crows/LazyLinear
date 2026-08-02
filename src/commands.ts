export type CommandId =
    | "focusNavigation"
    | "focusContent"
    | "focusDetail"
    | "cycleFocus"
    | "moveDown"
    | "moveUp"
    | "moveBoardLeft"
    | "moveBoardRight"
    | "moveCardLeft"
    | "moveCardRight"
    | "open"
    | "search"
    | "toggleLayout"
    | "cycleGrouping"
    | "create"
    | "createView"
    | "edit"
    | "remove"
    | "advance"
    | "refresh"
    | "help"
    | "quit";

export type CommandContext = "global" | "navigation" | "content" | "detail";

type InputToken =
    | `input:${string}`
    | "key:tab"
    | "key:return"
    | "key:up"
    | "key:down"
    | "key:left"
    | "key:right";

export interface CommandDescriptor {
    readonly id: CommandId;
    readonly keys: string;
    readonly tokens: readonly InputToken[];
    readonly contexts: readonly CommandContext[];
    readonly viewModes?: readonly ViewMode[];
    readonly footerLabel?: string;
    readonly helpLabel: string;
}

const everyContext: readonly CommandContext[] = ["global", "navigation", "content", "detail"];
const workspaceContexts: readonly CommandContext[] = ["navigation", "content", "detail"];
const contentContexts: readonly CommandContext[] = ["content", "detail"];
const boardOnly: readonly ViewMode[] = ["board"];

export const COMMANDS: readonly CommandDescriptor[] = [
    { id: "focusNavigation", keys: "1", tokens: ["input:1"], contexts: everyContext, helpLabel: "focus navigation" },
    { id: "focusContent", keys: "2", tokens: ["input:2"], contexts: everyContext, helpLabel: "focus content" },
    { id: "focusDetail", keys: "3", tokens: ["input:3"], contexts: everyContext, helpLabel: "focus inspector" },
    { id: "moveDown", keys: "j / ↓", tokens: ["input:j", "key:down"], contexts: ["navigation", "content"], footerLabel: "j/k move", helpLabel: "move selection down" },
    { id: "moveUp", keys: "k / ↑", tokens: ["input:k", "key:up"], contexts: ["navigation", "content"], helpLabel: "move selection up" },
    { id: "moveBoardLeft", keys: "h / ←", tokens: ["input:h", "key:left"], contexts: workspaceContexts, viewModes: boardOnly, footerLabel: "h/l column", helpLabel: "move to the previous board column" },
    { id: "moveBoardRight", keys: "l / →", tokens: ["input:l", "key:right"], contexts: workspaceContexts, viewModes: boardOnly, helpLabel: "move to the next board column" },
    { id: "moveCardLeft", keys: "H", tokens: ["input:H"], contexts: ["content"], viewModes: boardOnly, footerLabel: "H/L move-card", helpLabel: "move the selected card to the previous group" },
    { id: "moveCardRight", keys: "L", tokens: ["input:L"], contexts: ["content"], viewModes: boardOnly, helpLabel: "move the selected card to the next group" },
    { id: "open", keys: "enter", tokens: ["key:return"], contexts: workspaceContexts, footerLabel: "enter inspect", helpLabel: "open selection or focus inspector" },
    { id: "create", keys: "n", tokens: ["input:n"], contexts: workspaceContexts, footerLabel: "n new", helpLabel: "create in the current context" },
    { id: "edit", keys: "e", tokens: ["input:e"], contexts: workspaceContexts, footerLabel: "e edit", helpLabel: "edit the selected resource" },
    { id: "remove", keys: "d", tokens: ["input:d"], contexts: workspaceContexts, footerLabel: "d remove", helpLabel: "archive an issue, project, or team; permanently delete a custom view" },
    { id: "createView", keys: "v", tokens: ["input:v"], contexts: workspaceContexts, footerLabel: "v new-view", helpLabel: "create a Linear custom view" },
    { id: "toggleLayout", keys: "b", tokens: ["input:b"], contexts: workspaceContexts, footerLabel: "b layout", helpLabel: "toggle list and board layout" },
    { id: "cycleGrouping", keys: "g", tokens: ["input:g"], contexts: workspaceContexts, footerLabel: "g group", helpLabel: "cycle board grouping" },
    { id: "advance", keys: "space", tokens: ["input: "], contexts: contentContexts, footerLabel: "space advance", helpLabel: "advance an issue to its next workflow state" },
    { id: "search", keys: "/", tokens: ["input:/"], contexts: workspaceContexts, footerLabel: "/ search", helpLabel: "search the current view" },
    { id: "cycleFocus", keys: "tab", tokens: ["key:tab"], contexts: workspaceContexts, footerLabel: "tab panel", helpLabel: "cycle focused panel" },
    { id: "refresh", keys: "r", tokens: ["input:r", "input:R"], contexts: workspaceContexts, footerLabel: "r refresh", helpLabel: "refresh the workspace" },
    { id: "help", keys: "?", tokens: ["input:?"], contexts: everyContext, footerLabel: "? help", helpLabel: "show this help" },
    { id: "quit", keys: "q", tokens: ["input:q"], contexts: everyContext, footerLabel: "q quit", helpLabel: "quit LazyLinear" },
];

export interface CommandKey {
    readonly tab?: boolean;
    readonly return?: boolean;
    readonly upArrow?: boolean;
    readonly downArrow?: boolean;
    readonly leftArrow?: boolean;
    readonly rightArrow?: boolean;
}

export function identifyCommand(
    input: string,
    key: CommandKey,
    context?: CommandContext,
    viewMode?: ViewMode,
): CommandId | undefined {
    const tokens: InputToken[] = [];
    if (input !== "") {
        tokens.push(`input:${input}`);
    }
    if (key.tab) {
        tokens.push("key:tab");
    }
    if (key.return) {
        tokens.push("key:return");
    }
    if (key.upArrow) {
        tokens.push("key:up");
    }
    if (key.downArrow) {
        tokens.push("key:down");
    }
    if (key.leftArrow) {
        tokens.push("key:left");
    }
    if (key.rightArrow) {
        tokens.push("key:right");
    }
    return COMMANDS.find((command) => command.tokens.some((token) => tokens.includes(token))
        && (context === undefined || command.contexts.includes(context))
        && (viewMode === undefined || command.viewModes === undefined || command.viewModes.includes(viewMode)))?.id;
}

export function footerCommandDescriptors(
    context: Exclude<CommandContext, "global">,
    viewMode: ViewMode,
): readonly CommandDescriptor[] {
    return COMMANDS.filter((command) => command.footerLabel !== undefined
        && command.contexts.includes(context)
        && (command.viewModes === undefined || command.viewModes.includes(viewMode)));
}
import type { ViewMode } from "../lib/types.js";