import type {
    CustomView,
    Issue,
    Project,
    Team,
    WorkspaceSave,
    WorkspaceSnapshot,
} from "../../lib/types.js";

export type EditorKind = "issue" | "project" | "team" | "customView";

export interface EditorContext {
    readonly teamId?: string;
    readonly projectId?: string;
    readonly assigneeId?: string;
}

export type EditorTarget =
    | { readonly mode: "create"; readonly kind: "issue"; readonly context: EditorContext }
    | { readonly mode: "edit"; readonly kind: "issue"; readonly resource: Issue }
    | { readonly mode: "create"; readonly kind: "project"; readonly context: EditorContext }
    | { readonly mode: "edit"; readonly kind: "project"; readonly resource: Project }
    | { readonly mode: "create"; readonly kind: "team"; readonly context: EditorContext }
    | { readonly mode: "edit"; readonly kind: "team"; readonly resource: Team }
    | { readonly mode: "create"; readonly kind: "customView"; readonly context: EditorContext }
    | { readonly mode: "edit"; readonly kind: "customView"; readonly resource: CustomView };

export interface EditorOption {
    readonly value: string;
    readonly label: string;
}

export interface EditorField<TValues extends object> {
    readonly key: Extract<keyof TValues, string>;
    readonly label: string;
    readonly type: "text" | "textarea" | "select" | "boolean";
    readonly required?: boolean;
    readonly hint?: string;
    readonly options?: readonly EditorOption[];
}

export interface EditorDefinitionContext<TTarget extends EditorTarget> {
    readonly snapshot: WorkspaceSnapshot;
    readonly target: TTarget;
}

export type EditorValidation<TValues extends object> =
    | { readonly valid: true }
    | {
        readonly valid: false;
        readonly field: Extract<keyof TValues, string>;
        readonly message: string;
    };

export interface EditorDefinition<TValues extends object, TTarget extends EditorTarget> {
    readonly title: (context: EditorDefinitionContext<TTarget>) => string;

    initialValues(context: EditorDefinitionContext<TTarget>): TValues;

    fields(
        values: Readonly<TValues>,
        context: EditorDefinitionContext<TTarget>,
    ): readonly EditorField<TValues>[];

    applyChange?(
        values: Readonly<TValues>,
        key: Extract<keyof TValues, string>,
        value: string,
        context: EditorDefinitionContext<TTarget>,
    ): TValues;

    validate(
        values: Readonly<TValues>,
        context: EditorDefinitionContext<TTarget>,
    ): EditorValidation<TValues>;

    decode(
        values: Readonly<TValues>,
        context: EditorDefinitionContext<TTarget>,
    ): WorkspaceSave;
}