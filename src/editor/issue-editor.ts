import { ISSUE_PRIORITIES, type IssuePriority } from "../../lib/priorities.js";
import type { IssueCreateInput, IssueUpdateInput } from "../../lib/types.js";
import type {
    EditorDefinition,
    EditorDefinitionContext,
    EditorTarget,
    EditorValidation,
} from "./types.js";

export interface IssueEditorValues {
    readonly title: string;
    readonly description: string;
    readonly teamId: string;
    readonly stateId: string;
    readonly priority: string;
    readonly projectId: string;
    readonly assigneeId: string;
    readonly labelIds: string;
    readonly dueDate: string;
    readonly estimate: string;
}

type IssueEditorTarget = Extract<EditorTarget, { readonly kind: "issue" }>;
type IssueEditorContext = EditorDefinitionContext<IssueEditorTarget>;

function resolveVisibleLabelIds(values: Readonly<IssueEditorValues>, context: IssueEditorContext): readonly string[] {
    const requestedLabels = values.labelIds.split(",").map((name) => name.trim()).filter(Boolean);
    const labelIds: string[] = [];
    for (const requestedLabel of requestedLabels) {
        const lowered = requestedLabel.toLocaleLowerCase();
        const identifierMatch = context.snapshot.labels.find((label) => label.id.toLocaleLowerCase() === lowered);
        if (identifierMatch) {
            labelIds.push(identifierMatch.id);
            continue;
        }
        const nameMatches = context.snapshot.labels.filter((label) => label.name.toLocaleLowerCase() === lowered);
        if (nameMatches.length === 0) {
            throw new Error(`Unknown label “${requestedLabel}”. Use a visible label name or ID.`);
        }
        if (nameMatches.length > 1) {
            throw new Error(`Label “${requestedLabel}” is ambiguous. Use its ID.`);
        }
        labelIds.push(nameMatches[0]!.id);
    }
    return [...new Set(labelIds)];
}

function issueInput(values: Readonly<IssueEditorValues>, context: IssueEditorContext): IssueCreateInput {
    return {
        title: values.title.trim(),
        description: values.description,
        teamId: values.teamId,
        stateId: values.stateId,
        priority: Number(values.priority) as IssuePriority,
        projectId: values.projectId || null,
        assigneeId: values.assigneeId || null,
        labelIds: resolveVisibleLabelIds(values, context),
        dueDate: values.dueDate.trim() || null,
        estimate: values.estimate.trim() === "" ? null : Number(values.estimate),
    };
}

export const issueEditorDefinition: EditorDefinition<IssueEditorValues, IssueEditorTarget> = {
    title(context) {
        return context.target.mode === "edit" ? `Edit ${context.target.resource.identifier}` : "Create issue";
    },

    initialValues(context) {
        const issue = context.target.mode === "edit" ? context.target.resource : undefined;
        const requestedTeamId = context.target.mode === "create" ? context.target.context.teamId : undefined;
        const requestedProjectId = context.target.mode === "create" ? context.target.context.projectId : undefined;
        const requestedAssigneeId = context.target.mode === "create" ? context.target.context.assigneeId : undefined;
        const teamId = issue?.teamId
            ?? context.snapshot.teams.find((team) => team.id === requestedTeamId)?.id
            ?? context.snapshot.teams[0]?.id
            ?? "";
        const teamStates = context.snapshot.workflowStates.filter((state) => state.teamId === teamId);
        return {
            title: issue?.title ?? "",
            description: issue?.description ?? "",
            teamId,
            stateId: issue?.stateId
                ?? teamStates.find((state) => state.type === "unstarted")?.id
                ?? teamStates[0]?.id
                ?? "",
            priority: String(issue?.priority ?? 0),
            projectId: issue?.projectId
                ?? context.snapshot.projects.find((project) => project.id === requestedProjectId)?.id
                ?? "",
            assigneeId: issue?.assigneeId
                ?? context.snapshot.users.find((user) => user.id === requestedAssigneeId)?.id
                ?? "",
            labelIds: issue?.labelIds.flatMap((labelId) => {
                const label = context.snapshot.labels.find((candidate) => candidate.id === labelId);
                if (!label) {
                    return [];
                }
                const duplicateName = context.snapshot.labels.some((candidate) => candidate.id !== label.id
                    && candidate.name.toLocaleLowerCase() === label.name.toLocaleLowerCase());
                return [duplicateName ? label.id : label.name];
            }).join(", ") ?? "",
            dueDate: issue?.dueDate ?? "",
            estimate: issue?.estimate === undefined || issue.estimate === null ? "" : String(issue.estimate),
        };
    },

    fields(values, context) {
        return [
            { key: "title", label: "Title", type: "text", required: true },
            { key: "description", label: "Description", type: "textarea", hint: "Markdown is supported by Linear." },
            {
                key: "teamId",
                label: "Team",
                type: "select",
                required: true,
                options: context.snapshot.teams.map((team) => ({ value: team.id, label: `${team.key} · ${team.name}` })),
            },
            {
                key: "stateId",
                label: "Status",
                type: "select",
                required: true,
                options: context.snapshot.workflowStates
                    .filter((state) => state.teamId === values.teamId)
                    .map((state) => ({ value: state.id, label: state.name })),
            },
            {
                key: "priority",
                label: "Priority",
                type: "select",
                options: [...ISSUE_PRIORITIES].sort((left, right) => left.value - right.value)
                    .map((priority) => ({ value: String(priority.value), label: priority.label })),
            },
            {
                key: "projectId",
                label: "Project",
                type: "select",
                options: [{ value: "", label: "No project" }, ...context.snapshot.projects.map((project) => ({ value: project.id, label: project.name }))],
            },
            {
                key: "assigneeId",
                label: "Assignee",
                type: "select",
                options: [{ value: "", label: "Unassigned" }, ...context.snapshot.users
                    .filter((user) => user.active !== false)
                    .map((user) => ({ value: user.id, label: user.displayName }))],
            },
            { key: "labelIds", label: "Labels", type: "text", hint: "Comma-separated label names." },
            { key: "dueDate", label: "Due date", type: "text", hint: "YYYY-MM-DD or blank." },
            { key: "estimate", label: "Estimate", type: "text", hint: "Numeric estimate or blank." },
        ];
    },

    applyChange(values, key, value, context) {
        if (key !== "teamId") {
            return { ...values, [key]: value };
        }
        const defaultState = context.snapshot.workflowStates.find((state) => state.teamId === value && state.type === "unstarted")
            ?? context.snapshot.workflowStates.find((state) => state.teamId === value);
        return { ...values, teamId: value, stateId: defaultState?.id ?? "" };
    },

    validate(values, context): EditorValidation<IssueEditorValues> {
        if (values.title.trim() === "") {
            return { valid: false, field: "title", message: "Title is required." };
        }
        if (!context.snapshot.teams.some((team) => team.id === values.teamId)) {
            return { valid: false, field: "teamId", message: "A visible team is required." };
        }
        if (!context.snapshot.workflowStates.some((state) => state.id === values.stateId && state.teamId === values.teamId)) {
            return { valid: false, field: "stateId", message: "Status must belong to the selected team." };
        }
        if (!ISSUE_PRIORITIES.some((priority) => String(priority.value) === values.priority)) {
            return { valid: false, field: "priority", message: "Priority is invalid." };
        }
        if (values.projectId !== "" && !context.snapshot.projects.some((project) => project.id === values.projectId)) {
            return { valid: false, field: "projectId", message: "Project is invalid." };
        }
        if (values.assigneeId !== "" && !context.snapshot.users.some((user) => user.id === values.assigneeId)) {
            return { valid: false, field: "assigneeId", message: "Assignee is invalid." };
        }
        if (values.estimate.trim() !== "" && !Number.isFinite(Number(values.estimate))) {
            return { valid: false, field: "estimate", message: "Estimate must be numeric or blank." };
        }
        try {
            resolveVisibleLabelIds(values, context);
        } catch (error) {
            return { valid: false, field: "labelIds", message: error instanceof Error ? error.message : String(error) };
        }
        return { valid: true };
    },

    decode(values, context) {
        const input = issueInput(values, context);
        if (context.target.mode === "create") {
            return { kind: "issue", action: "create", input };
        }
        const updateInput: IssueUpdateInput = input;
        return { kind: "issue", action: "update", id: context.target.resource.id, input: updateInput };
    },
};