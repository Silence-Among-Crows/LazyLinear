import type { ProjectCreateInput, ProjectUpdateInput } from "../../lib/types.js";
import type {
    EditorDefinition,
    EditorDefinitionContext,
    EditorTarget,
    EditorValidation,
} from "./types.js";

export interface ProjectEditorValues {
    readonly name: string;
    readonly summary: string;
    readonly description: string;
    readonly teamIds: string;
    readonly statusId: string;
    readonly leadId: string;
    readonly color: string;
    readonly startDate: string;
    readonly targetDate: string;
}

type ProjectEditorTarget = Extract<EditorTarget, { readonly kind: "project" }>;
type ProjectEditorContext = EditorDefinitionContext<ProjectEditorTarget>;

function resolveVisibleTeamIds(values: Readonly<ProjectEditorValues>, context: ProjectEditorContext): readonly string[] {
    const requestedTeams = values.teamIds.split(",").map((team) => team.trim()).filter(Boolean);
    const teamIds: string[] = [];
    for (const requestedTeam of requestedTeams) {
        const lowered = requestedTeam.toLocaleLowerCase();
        const matches = context.snapshot.teams.filter((team) => team.id.toLocaleLowerCase() === lowered
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
    return [...new Set(teamIds)];
}

function projectInput(values: Readonly<ProjectEditorValues>, context: ProjectEditorContext): ProjectCreateInput {
    return {
        name: values.name.trim(),
        summary: values.summary.trim(),
        description: values.description,
        teamIds: resolveVisibleTeamIds(values, context),
        statusId: values.statusId || undefined,
        leadId: values.leadId || null,
        color: values.color.trim() || undefined,
        startDate: values.startDate.trim() || null,
        targetDate: values.targetDate.trim() || null,
    };
}

export const projectEditorDefinition: EditorDefinition<ProjectEditorValues, ProjectEditorTarget> = {
    title(context) {
        return context.target.mode === "edit" ? `Edit ${context.target.resource.name}` : "Create project";
    },

    initialValues(context) {
        const project = context.target.mode === "edit" ? context.target.resource : undefined;
        return {
            name: project?.name ?? "",
            summary: project?.summary ?? "",
            description: project?.description ?? "",
            teamIds: project?.teamIds.flatMap((teamId) => {
                const team = context.snapshot.teams.find((candidate) => candidate.id === teamId);
                return team ? [team.key] : [];
            }).join(", ") ?? context.snapshot.teams[0]?.key ?? "",
            statusId: project?.statusId ?? context.snapshot.projectStatuses[0]?.id ?? "",
            leadId: project?.leadId ?? "",
            color: project?.color ?? "#5E6AD2",
            startDate: project?.startDate ?? "",
            targetDate: project?.targetDate ?? "",
        };
    },

    fields(_values, context) {
        return [
            { key: "name", label: "Name", type: "text", required: true },
            { key: "summary", label: "Summary", type: "text", hint: "Short project summary." },
            { key: "description", label: "Description", type: "textarea" },
            { key: "teamIds", label: "Teams", type: "text", required: true, hint: "Comma-separated team keys, names, or IDs." },
            {
                key: "statusId",
                label: "Status",
                type: "select",
                options: context.snapshot.projectStatuses.map((status) => ({ value: status.id, label: status.name })),
            },
            {
                key: "leadId",
                label: "Lead",
                type: "select",
                options: [{ value: "", label: "No lead" }, ...context.snapshot.users
                    .filter((user) => user.active !== false)
                    .map((user) => ({ value: user.id, label: user.displayName }))],
            },
            { key: "color", label: "Color", type: "text", hint: "Hex color, for example #5E6AD2." },
            { key: "startDate", label: "Start date", type: "text", hint: "YYYY-MM-DD or blank." },
            { key: "targetDate", label: "Target date", type: "text", hint: "YYYY-MM-DD or blank." },
        ];
    },

    validate(values, context): EditorValidation<ProjectEditorValues> {
        if (values.name.trim() === "") {
            return { valid: false, field: "name", message: "Name is required." };
        }
        try {
            resolveVisibleTeamIds(values, context);
        } catch (error) {
            return { valid: false, field: "teamIds", message: error instanceof Error ? error.message : String(error) };
        }
        if (values.statusId !== "" && !context.snapshot.projectStatuses.some((status) => status.id === values.statusId)) {
            return { valid: false, field: "statusId", message: "Project status is invalid." };
        }
        if (values.leadId !== "" && !context.snapshot.users.some((user) => user.id === values.leadId)) {
            return { valid: false, field: "leadId", message: "Project lead is invalid." };
        }
        return { valid: true };
    },

    decode(values, context) {
        const input = projectInput(values, context);
        if (context.target.mode === "create") {
            return { kind: "project", action: "create", input };
        }
        const updateInput: ProjectUpdateInput = input;
        return { kind: "project", action: "update", id: context.target.resource.id, input: updateInput };
    },
};