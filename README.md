# LazyLinear

LazyLinear is a keyboard-first terminal client for [Linear](https://linear.app), built around the interaction model that makes [lazygit](https://github.com/jesseduffield/lazygit) fast: persistent numbered panels, one focused context, `j`/`k` navigation, context-sensitive actions, an inspector, modal editors, searchable lists, and a bottom-line key guide.

It is a real TUI, not a terminal-themed web application. The production path talks directly to Linear's public GraphQL API and the built-in demo path exercises the same UI and mutation flow without touching a workspace.

## Run it

Requires Node.js 20 or newer.

```powershell
npm install
npm run build
npm link
lazylinear
```

LazyLinear accepts a personal API key interactively, through `LINEAR_API_KEY`, or through `--api-key`. The masked interactive prompt is the safest option because a command-line token can appear in shell history or process listings. The interactive token stays in process memory and is never written to disk.

This is credential-based connection, not a built-in “Sign in with Linear” browser flow. LazyLinear accepts an already-issued OAuth access token through `--token` or the prompt and sends it as a bearer token, but it does not currently initiate OAuth, store or rotate refresh tokens, select a workspace during authorization, or provide logout/revocation. A distributable browser login requires a registered Linear OAuth application and its public client ID.

```powershell
$env:LINEAR_API_KEY = "lin_api_..."
lazylinear
```

Use the populated local workspace to try everything without credentials:

```powershell
lazylinear --demo
```

For development, `npm run dev` launches demo mode. `npm run check` runs the typecheck, tests, and production build.

The layout listens for normal TTY resize events and also checks the backing terminal size every 200 ms so remote horizontal-only changes do not have to wait for a later vertical resize. The supported minimum is 44 columns by 18 rows. If a remote client never propagates its new dimensions to the backing PTY, the application cannot discover a size the process has not been given.

## What is implemented

The navigation panel exposes My issues, all issues, root-accessible issue custom views, every visible team, every visible project, and top-level project/team collections. Linear excludes project- and initiative-scoped views from the root `customViews` query, so LazyLinear does not misrepresent those facet-scoped records as empty issue views. The content panel switches between a compact list and a horizontally navigable board; issue boards can group by status, priority, project, assignee, or team, while project boards use project status. The inspector shows the selected issue, project, or team's working details.

Create and edit dialogs cover the core fields for issues, projects, teams, and issue custom views. Issue and project archival plus team deletion use Linear's recoverable workflows. Linear exposes custom-view removal as `customViewDelete`, so that action is explicitly labeled as permanent deletion in its confirmation. Pressing space on an issue advances it through its team's ordered workflow states. A failed write leaves its editor or confirmation intact. After a successful write, refresh failures are reported as refresh failures instead of inviting a duplicate mutation.

Custom views are real Linear `CustomView` records. Simple team, workflow-type, priority, project, and assignee filters are composed into `IssueFilter`; the editor also accepts raw `IssueFilter` JSON for the rest of Linear's schema. View membership is loaded from `customView.issues` rather than reimplementing Linear's filter semantics client-side.

Demo mode evaluates a documented subset of the same issue-filter shape: recursive `and`/`or`, priority, state ID/name/type, team/project/assignee ID, and label ID/name with `some`, using `eq`, `neq`, `in`, and `nin` where applicable. Unsupported fields, comparators, malformed filters, and non-empty project filters are rejected before a custom view is saved rather than silently matching every issue.

## Keys

| Key | Action |
| --- | --- |
| `1`, `2`, `3` | Focus navigation, content, or inspector |
| `Tab` | Cycle panel focus |
| `j` / `k`, arrows | Move selection |
| `h` / `l`, arrows | Move between board columns |
| `H` / `L` | Move the selected card to the previous / next board column |
| `Enter` | Open the selected context or inspector |
| `/` | Search the current view; `Ctrl+U` clears |
| `b` | Toggle list / board |
| `g` | Cycle board grouping |
| `n` | Create an issue, project, or team for the current context |
| `v` | Create a Linear custom view |
| `e` | Edit the selected content or focused sidebar resource |
| `d` | Archive an issue, project, or team; permanently delete a custom view after confirmation |
| `Space` | Advance the selected issue to its next workflow state |
| `r` | Refresh from Linear |
| `?` | Open full keybinding help |
| `q` | Quit |

Editors use `Tab` to move fields, left/right to move within text or change a select value, up/down to move between non-multiline fields, `Ctrl+S` to save, and `Esc` to cancel.

## API design

Linear exposes the same GraphQL endpoint used by its own clients at `https://api.linear.app/graphql`. LazyLinear uses personal-key auth (`Authorization: lin_api_…`) and accepts externally issued OAuth bearer tokens, checks GraphQL's `errors` array even on HTTP 200 responses, reads request and complexity rate-limit headers, and keeps API errors visible in the bottom status line.

The API supports query and mutation operations for issues, projects, teams, and root-accessible issue custom views. Linear's MCP server is not used as the application data plane: MCP exposes a curated agent tool surface, while the GraphQL API exposes the typed connections, pagination, filters, and mutation results needed by an interactive client.

Linear does not version the GraphQL API. Query documents are intentionally narrow, and the custom-view loader falls back when optional newer fields are unavailable. Schema drift still needs to be handled like any other integration change; `npm run check` covers the client-side contract, while a live token is required to validate a workspace's current permissions and schema.

Useful primary references:

- [Linear GraphQL API](https://linear.app/developers/graphql)
- [Linear authentication](https://linear.app/developers/oauth-2-0-authentication)
- [Linear pagination](https://linear.app/developers/pagination)
- [Linear filtering](https://linear.app/developers/filtering)
- [Linear rate limiting](https://linear.app/developers/rate-limiting)
- [Linear custom views](https://linear.app/docs/custom-views)
- [lazygit keybindings](https://github.com/jesseduffield/lazygit/blob/master/docs/keybindings/Keybindings_en.md)
- [lazygit configuration and panel model](https://github.com/jesseduffield/lazygit/blob/master/docs/Config.md)

## Permission and product boundaries

Team creation and updates can require elevated workspace permission. LazyLinear sends the public mutation and reports Linear's permission error; it does not hide or bypass it. Project and team archival can affect a large amount of workspace structure, so both require confirmation.

List versus board layout and the selected grouping are presentation state for the running terminal session. They are not written to Linear account settings, matching the product boundary of avoiding user/workspace settings. The custom view's filters, name, description, visibility, and membership are Linear-backed.

LazyLinear deliberately does not implement account settings, workspace settings, billing, integrations, notifications, cycles, initiatives, roadmaps, documents, or user administration.