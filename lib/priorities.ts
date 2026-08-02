export type IssuePriority = 0 | 1 | 2 | 3 | 4;

export interface IssuePriorityDescriptor {
    readonly value: IssuePriority;
    readonly label: string;
    readonly color: string;
}

export const ISSUE_PRIORITIES: readonly IssuePriorityDescriptor[] = [
    { value: 1, label: "Urgent", color: "#E06C75" },
    { value: 2, label: "High", color: "#E89B62" },
    { value: 3, label: "Medium", color: "#E9C46A" },
    { value: 4, label: "Low", color: "#6EA6D9" },
    { value: 0, label: "No priority", color: "#6B7480" },
];