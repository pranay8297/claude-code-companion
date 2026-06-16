#!/usr/bin/env node

import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

import { parseArgs } from "./lib/args.mjs";
import { getClaudeAuthStatus, getClaudeVersion, runClaude } from "./lib/claude.mjs";
import { binaryStatus } from "./lib/process.mjs";
import { buildRescuePrompt, buildReviewPrompt } from "./lib/prompts.mjs";
import { cancelJob, createJob, findJob, launchWorker, markJob, recentJobs } from "./lib/jobs.mjs";
import { appendLog, now, readJob, resolveStateDir } from "./lib/state.mjs";
import { renderQueued, renderSetup, renderStatus, renderStoredResult, renderTaskResult } from "./lib/render.mjs";

const SCRIPT_PATH = fileURLToPath(import.meta.url);

function isDirectRun() {
  if (!process.argv[1]) {
    return false;
  }
  try {
    return fs.realpathSync(process.argv[1]) === fs.realpathSync(SCRIPT_PATH);
  } catch {
    return path.resolve(process.argv[1]) === path.resolve(SCRIPT_PATH);
  }
}

function output(value, asJson = false) {
  process.stdout.write(asJson ? `${JSON.stringify(value, null, 2)}\n` : String(value));
}

function cwdFrom(options) {
  return options.cwd ? path.resolve(process.cwd(), options.cwd) : process.cwd();
}

function summarize(prompt) {
  const text = String(prompt ?? "").replace(/\s+/g, " ").trim();
  return text.length > 96 ? `${text.slice(0, 93)}...` : text;
}

function latestSessionId(cwd) {
  return recentJobs(cwd, true).find((job) => job.status === "completed" && job.sessionId)?.sessionId ?? null;
}

function sessionOptions(cwd, input = {}) {
  if (input.fresh) {
    return { resume: false, sessionId: input.sessionId, sessionPolicy: input.sessionId ? "fresh-explicit-session" : "fresh" };
  }
  if (input.sessionId) {
    return {
      resume: input.resume !== false,
      sessionId: input.sessionId,
      sessionPolicy: input.resume === false ? "explicit-session" : "explicit-resume"
    };
  }
  if (input.resume === false) {
    return { resume: false, sessionId: null, sessionPolicy: "fresh" };
  }
  const previousSessionId = latestSessionId(cwd);
  if (previousSessionId) {
    return { resume: true, sessionId: previousSessionId, sessionPolicy: "auto-resume" };
  }
  return { resume: false, sessionId: null, sessionPolicy: "new-workspace-session" };
}

export async function setupCommand(input = {}) {
  const cwd = path.resolve(input.cwd ?? process.cwd());
  const node = binaryStatus("node", ["--version"], { cwd });
  const claude = getClaudeVersion(cwd);
  const auth = getClaudeAuthStatus(cwd);
  const authExplicitlyMissing = auth.parsed?.loggedIn === false;
  return {
    ready: node.available && claude.available && !authExplicitlyMissing,
    node,
    claude,
    auth,
    stateDir: resolveStateDir(cwd)
  };
}

async function executeClaudeJob(cwd, job, request) {
  markJob(cwd, job.id, {
    status: "running",
    phase: "running",
    startedAt: now(),
    request
  });
  const result = await runClaude(request.prompt, {
    cwd,
    mode: request.mode,
    readOnly: request.readOnly,
    resume: request.resume,
    sessionId: request.sessionId,
    forkSession: request.forkSession,
    model: request.model,
    effort: request.effort,
    permissionMode: request.permissionMode,
    tools: request.tools,
    allowedTools: request.allowedTools,
    disallowedTools: request.disallowedTools,
    mcpConfig: request.mcpConfig,
    strictMcpConfig: request.strictMcpConfig,
    addDir: request.addDir,
    onStart: (pid) => {
      markJob(cwd, job.id, { pid, phase: "claude-running" });
      appendLog(job.logFile, `[${now()}] Claude process started pid=${pid}.\n`);
    },
    onStdout: (chunk) => appendLog(job.logFile, chunk),
    onStderr: (chunk) => appendLog(job.logFile, chunk)
  });
  const rendered = renderTaskResult(job, result);
  markJob(cwd, job.id, {
    status: result.status === 0 ? "completed" : "failed",
    phase: result.status === 0 ? "done" : "failed",
    pid: null,
    completedAt: now(),
    sessionId: result.sessionId,
    costUsd: result.costUsd,
    result: {
      status: result.status,
      signal: result.signal,
      stdout: result.stdout,
      stderr: result.stderr,
      finalText: result.finalText,
      parsed: result.parsed
    },
    rendered
  });
  return { job: readJob(cwd, job.id), rendered, result };
}

async function runJobRequest(cwd, request, options = {}) {
  const job = createJob(cwd, {
    prefix: request.kind === "review" ? "review" : "task",
    kind: request.kind,
    title: request.title,
    summary: request.summary,
    mode: request.mode,
    readOnly: request.readOnly,
    background: request.background,
    sessionPolicy: request.sessionPolicy
  });
  markJob(cwd, job.id, { request });

  if (request.background) {
    const child = launchWorker(SCRIPT_PATH, cwd, job.id);
    markJob(cwd, job.id, { pid: child.pid ?? null, phase: "queued" });
    return { job: readJob(cwd, job.id), rendered: renderQueued(job), queued: true };
  }

  return executeClaudeJob(cwd, job, request, options);
}

export async function reviewCommand(input = {}) {
  const cwd = path.resolve(input.cwd ?? process.cwd());
  const session = sessionOptions(cwd, input);
  const prompt = buildReviewPrompt(cwd, {
    scope: input.scope,
    base: input.base,
    focus: input.focus,
    finalResponse: input.finalResponse
  });
  return runJobRequest(cwd, {
    kind: input.adversarial ? "adversarial-review" : "review",
    title: input.adversarial ? "Claude Adversarial Review" : "Claude Review",
    summary: input.adversarial ? summarize(input.focus || "Adversarial review") : "Review current git state",
    prompt,
    mode: input.mode ?? "no_write",
    readOnly: true,
    background: Boolean(input.background),
    resume: session.resume,
    sessionId: session.sessionId,
    sessionPolicy: session.sessionPolicy,
    forkSession: input.forkSession,
    model: input.model,
    effort: input.effort,
    permissionMode: input.permissionMode,
    tools: input.tools,
    allowedTools: input.allowedTools,
    disallowedTools: input.disallowedTools,
    mcpConfig: input.mcpConfig,
    strictMcpConfig: input.strictMcpConfig,
    addDir: input.addDir
  });
}

export async function rescueCommand(input = {}) {
  const cwd = path.resolve(input.cwd ?? process.cwd());
  if (!input.prompt || !String(input.prompt).trim()) {
    throw new Error("Provide a task prompt for Claude.");
  }
  const mode = input.mode ?? (input.readOnly ? "no_write" : null);
  const readOnly = mode === "no_write";
  const session = sessionOptions(cwd, input);
  const prompt = buildRescuePrompt(input.prompt, { mode, readOnly, finalResponse: input.finalResponse });
  return runJobRequest(cwd, {
    kind: "task",
    title: input.resume ? "Claude Resume" : "Claude Task",
    summary: summarize(input.prompt),
    prompt,
    mode,
    readOnly,
    background: Boolean(input.background),
    resume: session.resume,
    sessionId: session.sessionId,
    sessionPolicy: session.sessionPolicy,
    forkSession: input.forkSession,
    model: input.model,
    effort: input.effort,
    permissionMode: input.permissionMode,
    tools: input.tools,
    allowedTools: input.allowedTools,
    disallowedTools: input.disallowedTools,
    mcpConfig: input.mcpConfig,
    strictMcpConfig: input.strictMcpConfig,
    addDir: input.addDir
  });
}

export async function compactCommand(input = {}) {
  const cwd = path.resolve(input.cwd ?? process.cwd());
  const sessionId = input.sessionId || latestSessionId(cwd);
  if (!sessionId) {
    throw new Error("No Claude session found to compact. Run a Claude task first or pass sessionId.");
  }
  return runJobRequest(cwd, {
    kind: "compact",
    title: "Claude Compact",
    summary: `Compact Claude session ${sessionId}`,
    prompt: "/compact",
    mode: null,
    readOnly: true,
    background: Boolean(input.background),
    resume: true,
    sessionId,
    sessionPolicy: input.sessionId ? "compact-explicit-resume" : "compact-auto-resume",
    forkSession: false,
    model: input.model,
    effort: input.effort
  });
}

export function statusCommand(input = {}) {
  const cwd = path.resolve(input.cwd ?? process.cwd());
  return recentJobs(cwd, Boolean(input.all));
}

export function resultCommand(input = {}) {
  const cwd = path.resolve(input.cwd ?? process.cwd());
  const job = findJob(cwd, input.jobId ?? "");
  return { job, stored: job ? readJob(cwd, job.id) : null };
}

export function cancelCommand(input = {}) {
  const cwd = path.resolve(input.cwd ?? process.cwd());
  return cancelJob(cwd, input.jobId ?? "");
}

async function handleWorker(argv) {
  const { options } = parseArgs(argv, {
    valueOptions: ["cwd", "job-id"]
  });
  const cwd = cwdFrom(options);
  const job = readJob(cwd, options["job-id"]);
  if (!job?.request) {
    throw new Error(`No queued Claude job found for ${options["job-id"]}.`);
  }
  await executeClaudeJob(cwd, job, job.request);
}

async function main() {
  const [command, ...argv] = process.argv.slice(2);
  const common = {
    valueOptions: [
      "cwd",
      "job-id",
      "base",
      "scope",
      "model",
      "effort",
      "session-id",
      "permission-mode",
      "mode",
      "final-response",
      "tools",
      "allowed-tools",
      "disallowed-tools",
      "mcp-config",
      "add-dir"
    ],
    booleanOptions: ["json", "background", "read-only", "write", "resume", "fresh", "all", "adversarial", "fork-session", "strict-mcp-config"]
  };
  const { options, positionals } = parseArgs(argv, common);
  const cwd = cwdFrom(options);
  const asJson = Boolean(options.json);

  if (command === "worker") {
    await handleWorker(argv);
    return;
  }
  if (command === "setup") {
    const report = await setupCommand({ cwd });
    output(asJson ? report : renderSetup(report), asJson);
    return;
  }
  if (command === "review" || command === "adversarial-review") {
    const response = await reviewCommand({
      cwd,
      scope: options.scope,
      base: options.base,
      focus: positionals.join(" "),
      adversarial: command === "adversarial-review" || options.adversarial,
      background: options.background,
      fresh: Boolean(options.fresh),
      resume: options.resume == null ? undefined : Boolean(options.resume),
      sessionId: options["session-id"],
      forkSession: Boolean(options["fork-session"]),
      mode: options.mode,
      model: options.model,
      effort: options.effort,
      permissionMode: options["permission-mode"],
      finalResponse: options["final-response"],
      tools: options.tools,
      allowedTools: options["allowed-tools"],
      disallowedTools: options["disallowed-tools"],
      mcpConfig: options["mcp-config"],
      strictMcpConfig: Boolean(options["strict-mcp-config"]),
      addDir: options["add-dir"]
    });
    output(asJson ? response : response.rendered, asJson);
    return;
  }
  if (command === "rescue" || command === "task") {
    const response = await rescueCommand({
      cwd,
      prompt: positionals.join(" "),
      mode: options.mode,
      readOnly: Boolean(options["read-only"]) && !options.write,
      background: options.background,
      fresh: Boolean(options.fresh),
      resume: options.resume == null ? undefined : Boolean(options.resume),
      sessionId: options["session-id"],
      forkSession: Boolean(options["fork-session"]),
      model: options.model,
      effort: options.effort,
      permissionMode: options["permission-mode"],
      finalResponse: options["final-response"],
      tools: options.tools,
      allowedTools: options["allowed-tools"],
      disallowedTools: options["disallowed-tools"],
      mcpConfig: options["mcp-config"],
      strictMcpConfig: Boolean(options["strict-mcp-config"]),
      addDir: options["add-dir"]
    });
    output(asJson ? response : response.rendered, asJson);
    return;
  }
  if (command === "compact") {
    const response = await compactCommand({
      cwd,
      background: options.background,
      sessionId: options["session-id"],
      model: options.model,
      effort: options.effort
    });
    output(asJson ? response : response.rendered, asJson);
    return;
  }
  if (command === "status") {
    const jobs = statusCommand({ cwd, all: options.all });
    output(asJson ? jobs : renderStatus(jobs), asJson);
    return;
  }
  if (command === "result") {
    const response = resultCommand({ cwd, jobId: options["job-id"] ?? positionals[0] });
    output(asJson ? response : renderStoredResult(response.job, response.stored), asJson);
    return;
  }
  if (command === "cancel") {
    const response = cancelCommand({ cwd, jobId: options["job-id"] ?? positionals[0] });
    output(asJson ? response : `Cancelled ${response.id}.\n`, asJson);
    return;
  }

  throw new Error("Usage: claude-companion.mjs setup|review|adversarial-review|rescue|compact|status|result|cancel");
}

if (isDirectRun()) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  });
}
