import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const STATE_VERSION = 1;
const MAX_JOBS = 50;

function nowIso() {
  return new Date().toISOString();
}

export function resolveWorkspaceRoot(cwd) {
  let current = path.resolve(cwd ?? process.cwd());
  while (true) {
    if (fs.existsSync(path.join(current, ".git"))) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) {
      return path.resolve(cwd ?? process.cwd());
    }
    current = parent;
  }
}

function stateRoot() {
  return (
    process.env.CLAUDE_CODE_COMPANION_DATA ||
    process.env.CODEX_PLUGIN_DATA ||
    process.env.PLUGIN_DATA ||
    path.join(os.tmpdir(), "claude-code-companion")
  );
}

export function resolveStateDir(cwd) {
  const workspaceRoot = resolveWorkspaceRoot(cwd);
  let canonical = workspaceRoot;
  try {
    canonical = fs.realpathSync.native(workspaceRoot);
  } catch {
    canonical = workspaceRoot;
  }
  const slug = (path.basename(workspaceRoot) || "workspace")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "") || "workspace";
  const hash = createHash("sha256").update(canonical).digest("hex").slice(0, 16);
  return path.join(stateRoot(), `${slug}-${hash}`);
}

export function resolveStateFile(cwd) {
  return path.join(resolveStateDir(cwd), "state.json");
}

export function resolveJobsDir(cwd) {
  return path.join(resolveStateDir(cwd), "jobs");
}

export function ensureStateDir(cwd) {
  fs.mkdirSync(resolveJobsDir(cwd), { recursive: true });
}

function defaultState() {
  return { version: STATE_VERSION, jobs: [] };
}

export function loadState(cwd) {
  const file = resolveStateFile(cwd);
  if (!fs.existsSync(file)) {
    return defaultState();
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    return {
      ...defaultState(),
      ...parsed,
      jobs: Array.isArray(parsed.jobs) ? parsed.jobs : []
    };
  } catch {
    return defaultState();
  }
}

export function saveState(cwd, state) {
  ensureStateDir(cwd);
  const jobs = [...(state.jobs ?? [])]
    .sort((left, right) => String(right.updatedAt ?? "").localeCompare(String(left.updatedAt ?? "")))
    .slice(0, MAX_JOBS);
  const nextState = { version: STATE_VERSION, jobs };
  fs.writeFileSync(resolveStateFile(cwd), `${JSON.stringify(nextState, null, 2)}\n`, "utf8");
  return nextState;
}

export function updateState(cwd, mutate) {
  const state = loadState(cwd);
  mutate(state);
  return saveState(cwd, state);
}

export function generateJobId(prefix = "job") {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function upsertJob(cwd, patch) {
  const timestamp = nowIso();
  return updateState(cwd, (state) => {
    const index = state.jobs.findIndex((job) => job.id === patch.id);
    if (index === -1) {
      state.jobs.unshift({ createdAt: timestamp, updatedAt: timestamp, ...patch });
      return;
    }
    state.jobs[index] = { ...state.jobs[index], ...patch, updatedAt: timestamp };
  });
}

export function listJobs(cwd) {
  return loadState(cwd).jobs;
}

export function resolveJobFile(cwd, jobId) {
  ensureStateDir(cwd);
  return path.join(resolveJobsDir(cwd), `${jobId}.json`);
}

export function resolveJobLogFile(cwd, jobId) {
  ensureStateDir(cwd);
  return path.join(resolveJobsDir(cwd), `${jobId}.log`);
}

export function readJob(cwd, jobId) {
  const file = resolveJobFile(cwd, jobId);
  if (!fs.existsSync(file)) {
    return null;
  }
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

export function writeJob(cwd, jobId, payload) {
  ensureStateDir(cwd);
  fs.writeFileSync(resolveJobFile(cwd, jobId), `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

export function appendLog(logFile, message) {
  const text = String(message ?? "");
  if (!logFile || !text) {
    return;
  }
  fs.mkdirSync(path.dirname(logFile), { recursive: true });
  fs.appendFileSync(logFile, text, "utf8");
}

export function now() {
  return nowIso();
}
