import type { TeamCreateInput, TeamUpdateInput } from "../../lib/types.js";
import type { EditorDefinition, EditorTarget, EditorValidation } from "./types.js";

export interface TeamEditorValues {
    readonly name: string;
    readonly key: string;
    readonly description: string;
    readonly color: string;
    readonly visibility: string;
}

type TeamEditorTarget = Extract<EditorTarget, { readonly kind: "team" }>;

function teamInput(values: Readonly<TeamEditorValues>): TeamCreateInput {
    return {
        name: values.name.trim(),
        key: values.key.trim().toUpperCase(),
        description: values.description,
        color: values.color.trim() || undefined,
        visibility: values.visibility === "private" ? "private" : "workspace",
    };
}

export const teamEditorDefinition: EditorDefinition<TeamEditorValues, TeamEditorTarget> = {
    title(context) {
        return context.target.mode === "edit" ? `Edit ${context.target.resource.name}` : "Create team";
    },

    initialValues(context) {
        const team = context.target.mode === "edit" ? context.target.resource : undefined;
        return {
            name: team?.name ?? "",
            key: team?.key ?? "",
            description: team?.description ?? "",
            color: team?.color ?? "#65D1C7",
            visibility: team?.visibility ?? "workspace",
        };
    },

    fields() {
        return [
            { key: "name", label: "Name", type: "text", required: true },
            { key: "key", label: "Key", type: "text", required: true, hint: "Uppercase issue identifier prefix." },
            { key: "description", label: "Description", type: "textarea" },
            { key: "color", label: "Color", type: "text", hint: "Hex color, for example #65D1C7." },
            {
                key: "visibility",
                label: "Visibility",
                type: "select",
                options: [
                    { value: "workspace", label: "Workspace" },
                    { value: "private", label: "Private" },
                ],
                hint: "Private teams require workspace permission.",
            },
        ];
    },

    validate(values): EditorValidation<TeamEditorValues> {
        if (values.name.trim() === "") {
            return { valid: false, field: "name", message: "Name is required." };
        }
        if (values.key.trim() === "") {
            return { valid: false, field: "key", message: "Key is required." };
        }
        if (values.visibility !== "workspace" && values.visibility !== "private") {
            return { valid: false, field: "visibility", message: "Visibility is invalid." };
        }
        return { valid: true };
    },

    decode(values, context) {
        const input = teamInput(values);
        if (context.target.mode === "create") {
            return { kind: "team", action: "create", input };
        }
        const updateInput: TeamUpdateInput = input;
        return { kind: "team", action: "update", id: context.target.resource.id, input: updateInput };
    },
};