# Claude Code Companion

Use the installed Claude Code CLI from Codex through a local MCP server.

This plugin mirrors the mode-driven shape of `openai/codex-plugin-cc` in reverse:

- read-only `review`
- read-only `adversarial_review`
- write-capable `rescue`
- foreground or background execution
- `status`, `result`, and `cancel` job control

## Requirements

- Node.js
- Claude Code CLI available as `claude`
- Claude Code authenticated in the same terminal environment

## One-line Codex MCP Install

After publishing this package to npm:

```bash
codex mcp add claude-code-companion npx -y @indianaprado/claude-code-companion
```

That command adds a global Codex MCP server entry named `claude-code-companion`.
Codex will start the MCP server with `npx` when needed.

For a local unpublished checkout:

```bash
codex mcp add claude-code-companion node /Users/pranaybindela/Desktop/work/claude-mcp/claude-code-companion/scripts/claude-mcp-server.mjs
```

Confirm the entry:

```bash
codex mcp list
codex mcp get claude-code-companion
```

## Publish To npm

The package name is scoped because the unscoped `claude-code-companion` name is already taken on npm.
The package intentionally has no npm dependencies, no install lifecycle scripts, and no external
package imports. Check that before publishing:

```bash
npm run supply-chain:check
```

```bash
npm login
npm publish --access public
```

Dry-run before publishing:

```bash
npm publish --dry-run
```

Check setup:

```bash
node scripts/claude-companion.mjs setup
```

## Manual CLI

```bash
node scripts/claude-companion.mjs review
node scripts/claude-companion.mjs adversarial-review "focus on UX and frontend state bugs"
node scripts/claude-companion.mjs rescue --read-only "investigate why the dashboard is slow"
node scripts/claude-companion.mjs rescue --final-response concise "research and summarize the issue briefly"
node scripts/claude-companion.mjs rescue --resume --session-id <uuid> "continue this Claude session"
node scripts/claude-companion.mjs rescue --background "implement the mock frontend"
node scripts/claude-companion.mjs status
node scripts/claude-companion.mjs result <job-id>
node scripts/claude-companion.mjs cancel <job-id>
```

When installed from npm, the helper CLI is available as:

```bash
npx -y -p @indianaprado/claude-code-companion claude-code-companion-cli setup
```

## MCP Tools

The bundled MCP server exposes:

- `setup`
- `review`
- `adversarial_review`
- `rescue`
- `status`
- `result`
- `cancel`

`rescue` adds no Claude permission mode unless you pass one. Pass `readOnly: true` or
`mode: "no_write"` for investigation-only delegation.
The plugin does not set a default Claude permission mode; pass `permissionMode: "plan"` only when
you explicitly want Claude's plan mode.

Modes only control edit posture:

- `normal`: no plugin-imposed permission mode.
- `no_write`: no plan mode; appends a no-edit instruction and denies Claude edit tools.
- `plan`: passes Claude `--permission-mode plan`.
- `auto_accept`: passes Claude `--permission-mode acceptEdits`.

The same capability flags are available in every mode:

- `finalResponse`
- `tools`
- `allowedTools`
- `disallowedTools`
- `mcpConfig`
- `strictMcpConfig`
- `addDir`

Use `mcpConfig` to give Claude access to local MCP servers for web/search, DBs, browser tools, or
other local integrations. Avoid recursively giving Claude this `claude-code-companion` MCP unless you
explicitly want nested Claude calls.

Project rule: do not impose behavior defaults. Optional controls should only be applied when the
human asks for them or passes the corresponding parameter.

Execution rule: use blocking foreground calls unless the human asks for parallel/background work or
explicitly wants a separate long-running job. `background: true` is for user-requested parallel
delegation, not a default for implementation tasks.

Cancellation rule: do not hurry to cancel a blocking Claude tool call. Estimate a reasonable wait
from the task size: small smoke tests may finish quickly, while repo inspection, implementation,
review, and validation can legitimately take several minutes. Cancel only when the human asks, the
process is clearly stuck, or continuing would be harmful.

`finalResponse` controls how much prose Claude returns at the end of the run only when explicitly
provided:

- omitted: add no final-response instruction; Claude responds normally.
- `concise`: asks Claude for a compact outcome or focused review.
- `minimal`: asks Claude to return only `DONE` or `BLOCKED: <short reason>` for task delegation.
- `normal`: equivalent to omitted; no extra brevity instruction.

Examples:

```bash
# Allow web search/fetch in no-write mode.
node scripts/claude-companion.mjs rescue --mode no_write \
  --allowed-tools WebSearch,WebFetch \
  "Use web search to summarize today's NBA Finals news."

# Allow local shell programs in no-write mode.
node scripts/claude-companion.mjs rescue --mode no_write \
  --allowed-tools Bash \
  "Run redis-cli PING and report the output."

# Give Claude local MCP servers.
node scripts/claude-companion.mjs rescue --mode no_write \
  --mcp-config /path/to/claude-mcp-config.json \
  --allowed-tools mcp__server_name__tool_name \
  "Use the MCP tool and summarize the result."
```

Important: `no_write` blocks Claude's built-in `Edit` and `Write` tools and tells Claude not to edit.
If you also grant unrestricted `Bash`, a shell command can still mutate files or external systems.
For hard no-write isolation with Bash/DB tools, run Claude against read-only credentials or an external
sandbox.

The plugin does not expose Claude CLI budget caps. It uses the Claude account already logged into
your local `claude` CLI.

Cost shown by the plugin is not calculated locally. The plugin reads Claude CLI JSON fields such as
`total_cost_usd` and displays them. Final prose is output tokens from Claude. To reduce that output,
explicitly pass `finalResponse: "concise"` or `finalResponse: "minimal"`.

`model` is optional. When omitted, the plugin does not pass `--model`, so Claude CLI chooses its
current default/latest model. On this machine, that currently selected `claude-opus-4-5-20251101`.
When provided, `model` is forwarded to `claude --model`, so aliases such as `sonnet` and full model
names such as `claude-sonnet-4-5-20250929` work when supported by the installed Claude CLI.

`effort` is optional and version-sensitive. The plugin forwards it only when the installed Claude CLI
advertises `--effort`; otherwise it is ignored so older or changed CLIs do not fail the run.

Session controls:

- `resume: true` resumes the most recent Claude conversation in the current directory.
- `resume: true` plus `sessionId` resumes that exact Claude session.
- `sessionId` without `resume` starts or uses that exact session id.
- `forkSession: true` is passed through to Claude CLI with resume; behavior depends on the installed CLI.
