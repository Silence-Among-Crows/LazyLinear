import type {
    CustomView,
    FocusPanel,
    Issue,
    Project,
    Team,
    ViewMode,
    WorkspaceResourceReference,
    WorkspaceSnapshot,
} from "../lib/types.js";
import type { GroupBy, NavigationTarget } from "./domain.js";
import type { EditorTarget } from "./editor/types.js";
import type { WorkspaceCommittedOutcome } from "./workspace-session.js";

export type WorkspaceResource = Issue | Project | Team | CustomView;

export type ModalState =
    | { readonly type: "help" }
    | { readonly type: "editor"; readonly target: EditorTarget }
    | {
        readonly type: "confirm";
        readonly resource: WorkspaceResource;
        readonly title: string;
        readonly body: string;
    };

export interface InteractionState {
    readonly focus: FocusPanel;
    readonly navigation: NavigationTarget;
    readonly selectedResource?: WorkspaceResourceReference;
    readonly viewMode: ViewMode;
    readonly groupBy: GroupBy;
    readonly search: string;
    readonly searching: boolean;
    readonly modal: ModalState | null;
    readonly handledOutcomeId: number;
    readonly notice: string;
}

export type InteractionAction =
    | { readonly type: "focusSelected"; readonly focus: FocusPanel }
    | { readonly type: "focusCycled" }
    | { readonly type: "navigationSelected"; readonly target: NavigationTarget }
    | { readonly type: "resourceSelected"; readonly resource?: WorkspaceResourceReference }
    | { readonly type: "viewModeToggled" }
    | { readonly type: "groupingSelected"; readonly groupBy: GroupBy }
    | { readonly type: "searchStarted" }
    | { readonly type: "searchChanged"; readonly search: string }
    | { readonly type: "searchFinished" }
    | { readonly type: "modalOpened"; readonly modal: ModalState }
    | { readonly type: "modalClosed" }
    | { readonly type: "noticeChanged"; readonly notice: string }
    | {
        readonly type: "workspaceReconciled";
        readonly snapshot: WorkspaceSnapshot;
        readonly visibleResources: readonly WorkspaceResourceReference[];
    }
    | { readonly type: "workspaceOutcomeApplied"; readonly outcome: WorkspaceCommittedOutcome };

export const initialInteractionState: InteractionState = {
    focus: "navigation",
    navigation: { kind: "myIssues" },
    viewMode: "list",
    groupBy: "status",
    search: "",
    searching: false,
    modal: null,
    handledOutcomeId: 0,
    notice: "",
};

function sameResource(
    left: WorkspaceResourceReference | undefined,
    right: WorkspaceResourceReference | undefined,
): boolean {
    return left?.kind === right?.kind && left?.id === right?.id;
}

function navigationExists(snapshot: WorkspaceSnapshot, target: NavigationTarget): boolean {
    if (target.kind === "teamIssues") {
        return snapshot.teams.some((team) => team.id === target.teamId);
    }
    if (target.kind === "projectIssues") {
        return snapshot.projects.some((project) => project.id === target.projectId);
    }
    if (target.kind === "customView") {
        return snapshot.customViews.some((view) => view.id === target.customViewId);
    }
    return true;
}

export function interactionReducer(state: InteractionState, action: InteractionAction): InteractionState {
    switch (action.type) {
        case "focusSelected":
            return { ...state, focus: action.focus };
        case "focusCycled":
            return {
                ...state,
                focus: state.focus === "navigation" ? "content" : state.focus === "content" ? "detail" : "navigation",
            };
        case "navigationSelected":
            return {
                ...state,
                navigation: action.target,
                selectedResource: undefined,
                search: "",
            };
        case "resourceSelected":
            return { ...state, selectedResource: action.resource };
        case "viewModeToggled":
            return { ...state, viewMode: state.viewMode === "list" ? "board" : "list" };
        case "groupingSelected":
            return { ...state, groupBy: action.groupBy };
        case "searchStarted":
            return { ...state, searching: true };
        case "searchChanged":
            return { ...state, search: action.search, selectedResource: undefined };
        case "searchFinished":
            return { ...state, searching: false };
        case "modalOpened":
            return { ...state, modal: action.modal };
        case "modalClosed":
            return { ...state, modal: null };
        case "noticeChanged":
            return { ...state, notice: action.notice };
        case "workspaceReconciled": {
            const navigation = navigationExists(action.snapshot, state.navigation)
                ? state.navigation
                : { kind: "myIssues" } as const;
            const selectedResource = action.visibleResources.some((resource) => sameResource(resource, state.selectedResource))
                ? state.selectedResource
                : action.visibleResources[0];
            if (navigation === state.navigation && sameResource(selectedResource, state.selectedResource)) {
                return state;
            }
            return { ...state, navigation, selectedResource };
        }
        case "workspaceOutcomeApplied": {
            if (action.outcome.id <= state.handledOutcomeId) {
                return state;
            }
            const { receipt } = action.outcome;
            const selectedResource = receipt.action === "created" || receipt.action === "updated"
                ? receipt.resource
                : sameResource(receipt.resource, state.selectedResource)
                    ? undefined
                    : state.selectedResource;
            return {
                ...state,
                selectedResource,
                modal: null,
                handledOutcomeId: action.outcome.id,
                notice: receipt.action === "created" || receipt.action === "updated"
                    ? `${receipt.action} ${receipt.resource.kind}`
                    : receipt.action === "deleted"
                        ? "deleted custom view"
                        : `archived ${receipt.resource.kind}`,
            };
        }
    }
}