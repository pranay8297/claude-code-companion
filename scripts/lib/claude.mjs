import { binaryStatus, spawnCapture } from "./process.mjs";

const NO_WRITE_DISALLOWED_TOOLS = "Edit,Write";
const VALID_MODES = new Set(["normal", "no_write", "plan", "auto_accept"]);
let claudeHelpText = null;

export function getClaudeVersion(cwd) {
  return binaryStatus("claude", ["--version"], { cwd });
}

export function getClaudeAuthStatus(cwd) {
  const result = binaryStatus("claude", ["auth", "status"], { cwd, timeoutMs: 8000 });
  let parsed = null;
  try {
    parsed = JSON.parse(result.stdout);
  } catch {
    parsed = null;
  }
  return {
    available: result.available || Boolean(result.stdout),
    timedOut: result.detail?.includes("ETIMEDOUT") || result.signal === "SIGTERM",
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
    detail: result.detail,
    parsed
  };
}

function normalizeEffort(effort) {
  if (!effort) {
    return null;
  }
  const value = String(effort).trim();
  const allowed = new Set(["low", "medium", "high", "xhigh", "max"]);
  if (!allowed.has(value)) {
    throw new Error(`Unsupported Claude effort "${effort}". Use low, medium, high, xhigh, or max.`);
  }
  return value;
}

function normalizeMode(mode) {
  if (mode == null || mode === "") {
    return null;
  }
  const value = String(mode).trim();
  if (!VALID_MODES.has(value)) {
    throw new Error(`Unsupported Claude mode "${mode}". Use normal, no_write, plan, or auto_accept.`);
  }
  return value;
}

function claudeSupportsFlag(flag, cwd) {
  if (claudeHelpText == null) {
    claudeHelpText = binaryStatus("claude", ["--help"], { cwd, timeoutMs: 5000 }).stdout;
  }
  return claudeHelpText.includes(flag);
}

function appendStringList(args, flag, value) {
  if (value == null || value === false) {
    return;
  }
  const values = Array.isArray(value) ? value : [value];
  const normalized = values.map((entry) => String(entry).trim()).filter(Boolean);
  if (normalized.length > 0) {
    args.push(flag, ...normalized);
  }
}

function parseClaudeJson(stdout) {
  const text = String(stdout ?? "").trim();
  if (!text) {
    return { parsed: null, finalText: "" };
  }
  try {
    const parsed = JSON.parse(text);
    const finalText =
      parsed.result ??
      parsed.response ??
      parsed.message?.content?.map?.((part) => part.text ?? "").join("\n") ??
      parsed.content?.map?.((part) => part.text ?? "").join("\n") ??
      text;
    return { parsed, finalText: String(finalText ?? "").trim() };
  } catch {
    return { parsed: null, finalText: text };
  }
}

export async function runClaude(prompt, options = {}) {
  const args = ["-p", prompt, "--output-format", "json"];
  if (options.mode && options.permissionMode) {
    throw new Error("Use either mode or permissionMode, not both.");
  }
  const mode = normalizeMode(options.mode ?? (options.readOnly ? "no_write" : null));
  if (options.resume) {
    if (options.sessionId) {
      args.push("--resume", options.sessionId);
    } else {
      args.push("--continue");
    }
    if (options.forkSession) {
      args.push("--fork-session");
    }
  } else if (options.sessionId) {
    args.push("--session-id", options.sessionId);
  }
  if (options.model) {
    args.push("--model", options.model);
  }
  const effort = normalizeEffort(options.effort);
  if (effort && claudeSupportsFlag("--effort", options.cwd)) {
    args.push("--effort", effort);
  }
  appendStringList(args, "--add-dir", options.addDir);
  appendStringList(args, "--mcp-config", options.mcpConfig);
  if (options.strictMcpConfig) {
    args.push("--strict-mcp-config");
  }
  if (options.tools) {
    args.push("--tools", String(options.tools));
  }
  appendStringList(args, "--allowedTools", options.allowedTools);
  appendStringList(
    args,
    "--disallowedTools",
    mode === "no_write"
      ? [NO_WRITE_DISALLOWED_TOOLS, ...(Array.isArray(options.disallowedTools) ? options.disallowedTools : [options.disallowedTools]).filter(Boolean)]
      : options.disallowedTools
  );
  if (mode === "plan") {
    args.push("--permission-mode", "plan");
  } else if (mode === "auto_accept") {
    args.push("--permission-mode", "acceptEdits");
  } else if (options.permissionMode) {
    args.push("--permission-mode", options.permissionMode);
  }

  const result = await spawnCapture("claude", args, {
    cwd: options.cwd,
    onStart: options.onStart,
    onStdout: options.onStdout,
    onStderr: options.onStderr
  });
  const parsed = parseClaudeJson(result.stdout);
  return {
    ...result,
    parsed: parsed.parsed,
    finalText: parsed.finalText,
    sessionId: parsed.parsed?.session_id ?? parsed.parsed?.sessionId ?? null,
    costUsd: parsed.parsed?.total_cost_usd ?? parsed.parsed?.cost_usd ?? null
  };
}
