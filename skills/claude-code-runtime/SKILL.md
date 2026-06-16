---
name: claude-code-runtime
description: Use when Codex should delegate a review, diagnosis, implementation task, or background job to Claude Code through the local Claude Code Companion MCP server.
---

# Claude Code Runtime

Use the `claude-code-companion` MCP tools as a thin runtime bridge to the installed `claude` CLI.

## Tools

- `setup`: Check whether Node and Claude Code CLI are available and whether Claude auth appears usable.
- `review`: Run a read-only Claude review over the current git state.
- `adversarial_review`: Run a read-only Claude critique with custom focus text.
- `rescue`: Delegate an arbitrary task to Claude Code. Use `readOnly: true` for investigation-only work; otherwise it is write-capable.
- `compact`: Run Claude Code `/compact` on the last known workspace session or an explicit session id.
- `status`: Show active and recent Claude jobs.
- `result`: Show stored output for a completed job.
- `cancel`: Terminate an active background job.

## Operating Rules

- Keep delegation fluid. Do not impose frontend/backend ownership policy unless the user asks for it.
- Project rule: do not create behavior defaults. Pass optional controls only when the user asks for them or explicitly provides them.
- Use blocking foreground calls unless the user asks for parallel/background work or explicitly wants a separate long-running job.
- Use `background: true` only for user-requested parallel delegation; use `status` and `result` later.
- Do not hurry to cancel a blocking Claude tool call. Estimate a reasonable duration from the task size and wait accordingly; cancel only if the user asks, the process is clearly stuck, or there is concrete evidence that continuing is harmful.
- Keep Claude session continuity by default. Omit `fresh` unless the user asks for a new Claude session; the companion auto-resumes the last known successful workspace session when available.
- Use `compact` when the user explicitly asks to compact a Claude session or before a deliberate long-running continuation where preserving the session matters.
- Use read-only review tools when the user asks for critique, planning, diagnosis, or a second opinion without edits.
- Use write-capable `rescue` when the user explicitly wants Claude to implement or fix something.
- Omit `model` when the user wants Claude CLI's current default/latest model. Pass `model` only when the user asks for a specific alias or full model name.
- Omit `permissionMode` unless the user explicitly asks for a Claude permission mode such as `plan`.
- Use `mode: "no_write"` when Claude should be able to investigate normally but must not edit files. This is not plan mode.
- Omit `finalResponse` unless the user asks for a concise or minimal Claude response.
- Capability fields (`tools`, `allowedTools`, `disallowedTools`, `mcpConfig`, `strictMcpConfig`, `addDir`, `finalResponse`) are available in every mode. Pass them only when the user wants Claude to use extra local tools, MCP servers, DB access, browser/search tools, extra directories, or a different response length.
- Claude runs in the same checkout. Do not assume worktree isolation.
- Preserve the user's task text. Add only minimal context needed to make the delegation clear.
