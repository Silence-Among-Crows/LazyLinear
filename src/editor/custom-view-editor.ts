import { ISSUE_PRIORITIES } from "../../lib/priorities.js";
import type { CustomViewCreateInput, CustomViewUpdateInput } from "../../lib/types.js";
import type { EditorDefinition, EditorTarget, EditorValidation } from "./types.js";

export interface CustomViewEditorValues {
    readonly name: string;
    readonly description: string;
    readonly shared: string;
    readonly teamId: string;
    readonly stateType: string;
    readonly priority: string;
    readonly projectId: string;
    readonly assigneeId: string;
    readonly filterJson: string;
}

type CustomViewEditorTarget = Extract<EditorTarget, { readonly kind: "customView" }>;

function buildIssueFilter(values: Readonly<CustomViewEditorValues>): Readonly<Record<string, unknown>> {
    if (values.filterJson.trim() !== "") {
        const parsed = JSON.parse(values.filterJson) as unknown;
        if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
            throw new Error("Advanced filter JSON must be an object.");
        }
        return parsed as Readonly<Record<string, unknown>>;
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

function customViewInput(values: Readonly<CustomViewEditorValues>): CustomViewCreateInput {
    return {
        name: values.name.trim(),
        description: values.description,
        shared: values.shared === "true",
        filterData: buildIssueFilter(values),
    };
}

export const customViewEditorDefinition: EditorDefinition<CustomViewEditorValues, CustomViewEditorTarget> = {
    title(context) {
        return context.target.mode === "edit" ? `Edit ${context.target.resource.name}` : "Create custom view";
    },

    initialValues(context) {
        const view = context.target.mode === "edit" ? context.target.resource : undefined;
        return {
            name: view?.name ?? "",
            description: view?.description ?? "",
            shared: view?.shared ? "true" : "false",
            teamId: "",
            stateType: "",
            priority: "",
            projectId: "",
            assigneeId: "",
            filterJson: view?.filterData ? JSON.stringify(view.filterData, null, 2) : "",
        };
    },

    fields(_values, context) {
        return [
            { key: "name", label: "Name", type: "text", required: true },
            { key: "description", label: "Description", type: "textarea" },
            { key: "shared", label: "Shared", type: "boolean" },
            {
                key: "teamId",
                label: "Team filter",
                type: "select",
                options: [{ value: "", label: "Any team" }, ...context.snapshot.teams.map((team) => ({ value: team.id, label: `${team.key} · ${team.name}` }))],
            },
            {
                key: "stateType",
                label: "State filter",
                type: "select",
                options: [
                    { value: "", label: "Any state" },
                    { value: "backlog", label: "Backlog" },
                    { value: "unstarted", label: "Unstarted" },
                    { value: "started", label: "Started" },
                    { value: "completed", label: "Completed" },
                    { value: "canceled", label: "Canceled" },
                ],
            },
            {
                key: "priority",
                label: "Priority filter",
                type: "select",
                options: [{ value: "", label: "Any priority" }, ...ISSUE_PRIORITIES.map((priority) => ({ value: String(priority.value), label: priority.label }))],
            },
            {
                key: "projectId",
                label: "Project filter",
                type: "select",
                options: [{ value: "", label: "Any project" }, ...context.snapshot.projects.map((project) => ({ value: project.id, label: project.name }))],
            },
            {
                key: "assigneeId",
                label: "Assignee filter",
                type: "select",
                options: [{ value: "", label: "Any assignee" }, ...context.snapshot.users
                    .filter((user) => user.active !== false)
                    .map((user) => ({ value: user.id, label: user.displayName }))],
            },
            { key: "filterJson", label: "Advanced filter", type: "textarea", hint: "Optional raw IssueFilter JSON. This overrides the simple filters above." },
        ];
    },

    validate(values): EditorValidation<CustomViewEditorValues> {
        if (values.name.trim() === "") {
            return { valid: false, field: "name", message: "Name is required." };
        }
        try {
            buildIssueFilter(values);
        } catch (error) {
            return { valid: false, field: "filterJson", message: error instanceof Error ? error.message : String(error) };
        }
        return { valid: true };
    },

    decode(values, context) {
        const input = customViewInput(values);
        if (context.target.mode === "create") {
            return { kind: "customView", action: "create", input };
        }
        const updateInput: CustomViewUpdateInput = input;
        return { kind: "customView", action: "update", id: context.target.resource.id, input: updateInput };
    },
};