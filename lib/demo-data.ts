import type {
    CustomView,
    Issue,
    IssueLabel,
    LinearUser,
    Project,
    ProjectStatus,
    Team,
    WorkflowState,
    WorkspaceData,
} from "./types.js";

const teams: Team[] = [
    {
        id: "team-core",
        name: "Core Platform",
        key: "CORE",
        description: "Runtime, API, data model, and reliability work.",
        color: "#5E6AD2",
        icon: "Cpu",
        private: false,
    },
    {
        id: "team-app",
        name: "Product Experience",
        key: "APP",
        description: "Desktop, web, interaction design, and accessibility.",
        color: "#26B5CE",
        icon: "Command",
        private: false,
    },
    {
        id: "team-growth",
        name: "Growth",
        key: "GROW",
        description: "Activation, lifecycle, and customer-facing launches.",
        color: "#D99A45",
        icon: "TrendingUp",
        private: false,
    },
];

const users: LinearUser[] = [
    { id: "user-xavier", name: "Xavier", displayName: "Xavier", email: "xavier@example.com", active: true },
    { id: "user-maya", name: "Maya Chen", displayName: "Maya", email: "maya@example.com", active: true },
    { id: "user-omar", name: "Omar Diallo", displayName: "Omar", email: "omar@example.com", active: true },
    { id: "user-priya", name: "Priya Shah", displayName: "Priya", email: "priya@example.com", active: true },
    { id: "user-eli", name: "Eli Brooks", displayName: "Eli", email: "eli@example.com", active: true },
];

const labels: IssueLabel[] = [
    { id: "label-bug", name: "Bug", color: "#E5484D", description: "Something is not behaving as intended." },
    { id: "label-feature", name: "Feature", color: "#5E6AD2", description: "New product capability." },
    { id: "label-security", name: "Security", color: "#D6409F", description: "Security-sensitive work." },
    { id: "label-performance", name: "Performance", color: "#F2C94C", description: "Latency, throughput, or resource use." },
    { id: "label-design", name: "Design", color: "#26B5CE", description: "Interaction or visual design work." },
    { id: "label-customer", name: "Customer", color: "#4CB782", description: "Driven by direct customer feedback." },
];

const projectStatuses: ProjectStatus[] = [
    { id: "project-status-planned", name: "Planned", type: "planned", color: "#6EA6D9" },
    { id: "project-status-started", name: "In progress", type: "started", color: "#E9C46A" },
    { id: "project-status-paused", name: "Paused", type: "paused", color: "#AD8EE6" },
    { id: "project-status-completed", name: "Completed", type: "completed", color: "#8CCF7E" },
    { id: "project-status-canceled", name: "Canceled", type: "canceled", color: "#6B7480" },
];

const stateTemplates = [
    { suffix: "backlog", name: "Backlog", type: "backlog", color: "#6B7480", position: 0 },
    { suffix: "todo", name: "Todo", type: "unstarted", color: "#8B93A1", position: 1 },
    { suffix: "progress", name: "In Progress", type: "started", color: "#F2C94C", position: 2 },
    { suffix: "review", name: "In Review", type: "started", color: "#5E6AD2", position: 3 },
    { suffix: "done", name: "Done", type: "completed", color: "#4CB782", position: 4 },
    { suffix: "canceled", name: "Canceled", type: "canceled", color: "#8B93A1", position: 5 },
] as const;

const workflowStates: WorkflowState[] = teams.flatMap((team) => stateTemplates.map((template) => ({
    id: `${team.id}-${template.suffix}`,
    name: template.name,
    type: template.type,
    color: template.color,
    position: template.position,
    team: { id: team.id, name: team.name, key: team.key },
})));

const projects: Project[] = [
    {
        id: "project-sync",
        name: "Realtime sync engine",
        summary: "Fast, observable delta sync across clients.",
        description: "Replace coarse polling with a resumable event stream and deterministic reconciliation.",
        color: "#5E6AD2",
        icon: "RefreshCcw",
        state: "started",
        status: projectStatuses[1],
        progress: 0.63,
        startDate: "2026-07-01",
        targetDate: "2026-09-12",
        teams: [teams[0]!],
        lead: users[2],
    },
    {
        id: "project-terminal",
        name: "Keyboard-first workspace",
        summary: "Every core action without leaving the keyboard.",
        description: "Navigation, command palette, bulk actions, and focus semantics for high-volume operators.",
        color: "#26B5CE",
        icon: "Keyboard",
        state: "started",
        status: projectStatuses[1],
        progress: 0.46,
        startDate: "2026-07-18",
        targetDate: "2026-10-03",
        teams: [teams[1]!, teams[0]!],
        lead: users[1],
    },
    {
        id: "project-api",
        name: "Public API v2",
        summary: "A smaller, safer integration surface.",
        description: "Ship typed pagination, webhooks, and a coherent OAuth permission model.",
        color: "#D6409F",
        icon: "Braces",
        state: "planned",
        status: projectStatuses[0],
        progress: 0.18,
        startDate: "2026-08-15",
        targetDate: "2026-11-28",
        teams: [teams[0]!],
        lead: users[3],
    },
    {
        id: "project-onboarding",
        name: "First-run activation",
        summary: "Get a new workspace to its first completed cycle quickly.",
        description: "A focused setup path with sample data, import, and contextual guidance.",
        color: "#D99A45",
        icon: "Sparkles",
        state: "started",
        status: projectStatuses[1],
        progress: 0.74,
        startDate: "2026-06-22",
        targetDate: "2026-08-22",
        teams: [teams[2]!, teams[1]!],
        lead: users[4],
    },
    {
        id: "project-reliability",
        name: "Reliability baseline",
        summary: "Make failures visible, bounded, and recoverable.",
        description: "Service objectives, incident tooling, and failure-mode cleanup for critical paths.",
        color: "#4CB782",
        icon: "ShieldCheck",
        state: "completed",
        status: projectStatuses[3],
        progress: 1,
        startDate: "2026-04-10",
        targetDate: "2026-07-15",
        teams: [teams[0]!],
        lead: users[0],
    },
];

interface IssueSeed {
    key: string;
    title: string;
    description: string;
    team: number;
    state: string;
    priority: number;
    project?: number;
    assignee?: number;
    labels?: number[];
    dueDate?: string;
}

const issueSeeds: IssueSeed[] = [
    { key: "CORE-128", title: "Resume event stream after a dropped connection", description: "Persist the last acknowledged cursor and resume without replaying already-applied mutations.", team: 0, state: "progress", priority: 1, project: 0, assignee: 2, labels: [1, 3], dueDate: "2026-08-04" },
    { key: "CORE-131", title: "Bound GraphQL connection fan-out", description: "Cap nested connection breadth and expose complexity information in client diagnostics.", team: 0, state: "review", priority: 2, project: 2, assignee: 3, labels: [3] },
    { key: "CORE-134", title: "Reject stale optimistic writes", description: "Use entity update timestamps to make conflicting mutations explicit instead of silently overwriting.", team: 0, state: "todo", priority: 2, project: 0, assignee: 0, labels: [0, 2] },
    { key: "CORE-136", title: "Trace webhook delivery attempts", description: "Record delivery latency, status, retry count, and terminal failure reason.", team: 0, state: "backlog", priority: 3, project: 2, assignee: 2, labels: [1] },
    { key: "CORE-139", title: "Database pool spikes during import", description: "Large imports exhaust the shared pool and starve interactive requests.", team: 0, state: "progress", priority: 1, project: 4, assignee: 3, labels: [0, 3, 5], dueDate: "2026-08-02" },
    { key: "CORE-141", title: "Rotate signing keys without downtime", description: "Accept the active and previous key during a bounded rotation window.", team: 0, state: "todo", priority: 2, project: 2, assignee: 0, labels: [2] },
    { key: "CORE-143", title: "Remove legacy polling endpoint", description: "Delete the deprecated endpoint after all supported clients use delta sync.", team: 0, state: "backlog", priority: 4, project: 0, labels: [1] },
    { key: "CORE-122", title: "Return structured retry metadata", description: "Clients need a machine-readable retry timestamp and endpoint bucket name.", team: 0, state: "done", priority: 2, project: 4, assignee: 2, labels: [1] },
    { key: "APP-87", title: "Preserve selection when switching board and list", description: "The same issue should remain selected across presentation modes and regrouping.", team: 1, state: "progress", priority: 1, project: 1, assignee: 1, labels: [0, 4], dueDate: "2026-08-01" },
    { key: "APP-91", title: "Command palette should expose contextual actions", description: "Rank actions for the focused panel before global commands.", team: 1, state: "review", priority: 2, project: 1, assignee: 1, labels: [1, 4] },
    { key: "APP-94", title: "Announce board column changes to screen readers", description: "Moving a card must announce the issue, source column, and destination column.", team: 1, state: "todo", priority: 2, project: 1, assignee: 4, labels: [4] },
    { key: "APP-96", title: "Narrow terminal layout clips the inspector", description: "At widths below 90 columns the inspector should become a focused full-screen panel.", team: 1, state: "progress", priority: 2, project: 1, assignee: 1, labels: [0, 4] },
    { key: "APP-99", title: "Add multi-select actions to issue lists", description: "Range selection should support assignment, labels, state, and project changes.", team: 1, state: "backlog", priority: 3, project: 1, labels: [1] },
    { key: "APP-101", title: "Render markdown descriptions in detail view", description: "Support headings, lists, links, code spans, and fenced blocks without breaking terminal layout.", team: 1, state: "todo", priority: 3, project: 1, assignee: 4, labels: [1, 4] },
    { key: "APP-83", title: "Unify focused panel border treatment", description: "All interactive panels should use the same cyan focus affordance and number hint.", team: 1, state: "done", priority: 3, project: 1, assignee: 1, labels: [4] },
    { key: "APP-76", title: "Cancel stale search requests", description: "Fast typing can let an older result replace the latest query.", team: 1, state: "canceled", priority: 4, assignee: 4, labels: [0] },
    { key: "GROW-52", title: "Measure time to first completed issue", description: "Capture the path from workspace creation to the first issue moved to Done.", team: 2, state: "progress", priority: 2, project: 3, assignee: 4, labels: [1, 5] },
    { key: "GROW-55", title: "Import preview should flag unsupported fields", description: "Show exactly which source fields will be skipped before the import starts.", team: 2, state: "review", priority: 1, project: 3, assignee: 4, labels: [0, 5], dueDate: "2026-08-03" },
    { key: "GROW-58", title: "Create lifecycle view templates", description: "Offer useful saved views for trial, activated, retained, and at-risk accounts.", team: 2, state: "todo", priority: 3, project: 3, assignee: 0, labels: [1] },
    { key: "GROW-61", title: "Explain permission requirements before OAuth", description: "Show why each scope is needed before redirecting to authorization.", team: 2, state: "todo", priority: 2, project: 3, assignee: 3, labels: [2, 4] },
    { key: "GROW-64", title: "Trial reminder messages ignore local timezone", description: "Some reminders arrive a day early for workspaces east of UTC.", team: 2, state: "backlog", priority: 3, assignee: 4, labels: [0, 5] },
    { key: "GROW-67", title: "Publish keyboard workflow launch guide", description: "Document the navigation model and show real end-to-end workflows.", team: 2, state: "backlog", priority: 4, project: 1, assignee: 1, labels: [5] },
    { key: "GROW-48", title: "Ship sample workspace generator", description: "Generate coherent projects, teams, and issues that can be safely deleted later.", team: 2, state: "done", priority: 2, project: 3, assignee: 4, labels: [1] },
    { key: "GROW-45", title: "Remove duplicate activation event", description: "The client and webhook worker both emit the same activation event.", team: 2, state: "done", priority: 1, project: 4, assignee: 2, labels: [0, 3] },
];

const priorityLabels = ["No priority", "Urgent", "High", "Medium", "Low"];

const issues: Issue[] = issueSeeds.map((seed, index) => {
    const team = teams[seed.team]!;
    const state = workflowStates.find((candidate) => candidate.id === `${team.id}-${seed.state}`)!;
    return {
        id: `issue-${index + 1}`,
        identifier: seed.key,
        title: seed.title,
        description: seed.description,
        priority: seed.priority,
        priorityLabel: priorityLabels[seed.priority],
        estimate: seed.priority === 1 ? 5 : seed.priority === 2 ? 3 : 2,
        dueDate: seed.dueDate ?? null,
        createdAt: new Date(Date.UTC(2026, 6, 2 + index)).toISOString(),
        updatedAt: new Date(Date.UTC(2026, 6, 31, 10, 24 - index)).toISOString(),
        url: `https://linear.app/demo/issue/${seed.key}`,
        state,
        team: { id: team.id, name: team.name, key: team.key },
        project: seed.project === undefined ? null : projects[seed.project],
        assignee: seed.assignee === undefined ? null : users[seed.assignee],
        creator: users[(index + 1) % users.length],
        labels: (seed.labels ?? []).map((labelIndex) => labels[labelIndex]!),
        parent: null,
    };
});

const customViews: CustomView[] = [
    {
        id: "view-urgent",
        name: "Urgent + active",
        description: "Urgent issues that have not reached a terminal state.",
        shared: true,
        modelName: "Issue",
        filterData: {
            and: [
                { priority: { eq: 1 } },
                { state: { type: { nin: ["completed", "canceled"] } } },
            ],
        },
        owner: users[0],
        creator: users[0],
        issueIds: issues.filter((issue) => issue.priority === 1 && !["completed", "canceled"].includes(issue.state.type)).map((issue) => issue.id),
    },
    {
        id: "view-mine",
        name: "My open issues",
        description: "Everything assigned to Xavier that is still active.",
        shared: false,
        modelName: "Issue",
        filterData: {
            and: [
                { assignee: { id: { eq: "user-xavier" } } },
                { state: { type: { nin: ["completed", "canceled"] } } },
            ],
        },
        owner: users[0],
        creator: users[0],
        issueIds: issues.filter((issue) => issue.assignee?.id === "user-xavier" && !["completed", "canceled"].includes(issue.state.type)).map((issue) => issue.id),
    },
    {
        id: "view-review",
        name: "Waiting for review",
        description: "Cross-team work currently in review.",
        shared: true,
        modelName: "Issue",
        filterData: { state: { name: { eq: "In Review" } } },
        owner: users[1],
        creator: users[1],
        issueIds: issues.filter((issue) => issue.state.name === "In Review").map((issue) => issue.id),
    },
    {
        id: "view-customer",
        name: "Customer-reported",
        description: "Open work carrying the Customer label.",
        shared: true,
        modelName: "Issue",
        filterData: { labels: { some: { name: { eq: "Customer" } } } },
        owner: users[4],
        creator: users[4],
        issueIds: issues.filter((issue) => issue.labels.some((label) => label.name === "Customer")).map((issue) => issue.id),
    },
];

const demoWorkspace: WorkspaceData = {
    viewer: {
        ...users[0]!,
        organization: { id: "organization-demo", name: "Northstar Labs", urlKey: "northstar-demo" },
    },
    organization: { id: "organization-demo", name: "Northstar Labs", urlKey: "northstar-demo" },
    teams,
    projects,
    issues,
    workflowStates,
    users,
    labels,
    projectStatuses,
    customViews,
    fetchedAt: new Date().toISOString(),
    rateLimit: {
        requestLimit: 2500,
        requestRemaining: 2479,
        complexityLimit: 3_000_000,
        complexityRemaining: 2_981_420,
    },
};

export function createDemoWorkspace(): WorkspaceData {
    return structuredClone(demoWorkspace);
}