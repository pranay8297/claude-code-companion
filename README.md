# Claude Code Companion

Claude Code Companion is a local MCP server that lets Codex delegate work to the installed
Claude Code CLI.

It is useful when you want Codex to ask Claude Code for a second pass on planning, review,
frontend implementation, debugging, or repository analysis while keeping control inside Codex.

## Requirements

- Node.js 20 or newer
- Claude Code CLI installed as `claude`
- Claude Code authenticated in the same terminal environment
- Codex CLI with MCP support

## Install

Add the MCP server to Codex:

```bash
codex mcp add claude-code-companion npx -y @indianaprado/claude-code-companion@latest
```

Restart Codex after adding the server.

## Recommended Timeout

Claude Code tasks can legitimately take several minutes when they inspect a repository,
edit files, or run validation. Configure a longer MCP tool timeout so Codex does not
cancel blocking Claude calls too early.

Edit `~/.codex/config.toml`:

```toml
[mcp_servers.claude-code-companion]
command = "npx"
args = ["-y", "@indianaprado/claude-code-companion@latest"]
tool_timeout_sec = 1800
```

Restart Codex after changing the config. `1800` seconds gives a blocking Claude call up
to 30 minutes while preserving foreground behavior.

## Update

To force Codex to use the latest published package, remove and re-add the MCP server:

```bash
codex mcp remove claude-code-companion
codex mcp add claude-code-companion npx -y @indianaprado/claude-code-companion@latest
```

Then confirm that `tool_timeout_sec = 1800` is still present in `~/.codex/config.toml`
and restart Codex.

## Tools

The MCP server exposes these tools:

- `setup`: Check Node, Claude CLI, auth, and companion state directory.
- `review`: Ask Claude Code to review the current git state.
- `adversarial_review`: Ask Claude Code for a focused critique.
- `rescue`: Delegate an arbitrary task to Claude Code.
- `compact`: Run Claude Code `/compact` against the current or specified Claude session.
- `status`: List recent and active Claude companion jobs.
- `result`: Show stored output for a job.
- `cancel`: Cancel an active background job.

## Modes

`rescue`, `review`, and `adversarial_review` support optional mode controls:

- `normal`: No companion-imposed Claude permission mode.
- `no_write`: Adds no-edit guidance and denies Claude edit tools.
- `plan`: Uses Claude Code plan mode.
- `auto_accept`: Uses Claude Code `acceptEdits` mode.

Do not pass optional behavior controls unless you actually want them. The companion is
designed to stay fluid: Codex decides when to delegate, and Claude Code runs with the
explicit posture requested for that call.

## Session Behavior

The companion keeps Claude session continuity by default:

- It stores the `session_id` returned by Claude Code for successful jobs.
- The next call in the same workspace auto-resumes the last successful session.
- Pass `fresh: true` when you explicitly want a new Claude session.
- Pass `sessionId` to resume or target a specific Claude session.
- Use `compact` to run Claude Code `/compact` on the last known session or an explicit session.

Context compaction is handled by Claude Code. The companion invokes `/compact` as a top-level
Claude prompt when the `compact` tool is used.

## Capability Pass-Through

The companion can pass through Claude CLI capability flags when supplied:

- `model`
- `effort`
- `tools`
- `allowedTools`
- `disallowedTools`
- `mcpConfig`
- `strictMcpConfig`
- `addDir`
- `permissionMode`
- `finalResponse`

For example, you can give Claude access to web/search tools, shell tools, local MCP servers,
or extra directories when the task requires them.

## CLI Usage

You can also run the companion directly:

```bash
npx -y -p @indianaprado/claude-code-companion claude-code-companion-cli setup
npx -y -p @indianaprado/claude-code-companion claude-code-companion-cli rescue --read-only "inspect this repo and summarize the architecture"
npx -y -p @indianaprado/claude-code-companion claude-code-companion-cli compact
```

From a local checkout:

```bash
node scripts/claude-companion.mjs setup
node scripts/claude-companion.mjs rescue --read-only "inspect this repo and summarize the architecture"
node scripts/claude-companion.mjs compact
```

## Publishing

Run publish commands from the package directory, not from the parent workspace:

```bash
cd claude-code-companion
npm test
npm publish --access public
```

The package intentionally has no npm dependencies, no install lifecycle scripts, and no
external package imports. `npm test` checks those supply-chain constraints.
