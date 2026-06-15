import { appendLog, generateJobId, listJobs, now, readJob, resolveJobLogFile, upsertJob, writeJob } from "./state.mjs";
import { spawnDetached, terminateProcessTree } from "./process.mjs";

export function createJob(cwd, values) {
  const id = generateJobId(values.prefix ?? "claude");
  const logFile = resolveJobLogFile(cwd, id);
  const job = {
    id,
    kind: values.kind ?? "task",
    title: values.title ?? "Claude Task",
    summary: values.summary ?? "",
    cwd,
    status: "queued",
    phase: "queued",
    pid: null,
    logFile,
    mode: values.mode ?? null,
    readOnly: Boolean(values.readOnly),
    background: Boolean(values.background),
    createdAt: now()
  };
  writeJob(cwd, id, job);
  upsertJob(cwd, job);
  appendLog(logFile, `[${now()}] Queued ${job.title}.\n`);
  return job;
}

export function markJob(cwd, jobId, patch) {
  const existing = readJob(cwd, jobId) ?? { id: jobId, cwd };
  const next = { ...existing, ...patch, updatedAt: now() };
  writeJob(cwd, jobId, next);
  upsertJob(cwd, next);
  return next;
}

export function recentJobs(cwd, includeAll = false) {
  const jobs = listJobs(cwd);
  return includeAll ? jobs : jobs.slice(0, 10);
}

export function findJob(cwd, reference = "") {
  const jobs = listJobs(cwd);
  if (!reference) {
    return jobs[0] ?? null;
  }
  return jobs.find((job) => job.id === reference || job.id.startsWith(reference)) ?? null;
}

export function launchWorker(scriptPath, cwd, jobId) {
  return spawnDetached(process.execPath, [scriptPath, "worker", "--cwd", cwd, "--job-id", jobId], { cwd });
}

export function cancelJob(cwd, reference = "") {
  const job = findJob(cwd, reference);
  if (!job) {
    throw new Error(reference ? `No Claude job found for ${reference}.` : "No Claude job found.");
  }
  const killed = terminateProcessTree(job.pid);
  const next = markJob(cwd, job.id, {
    status: "cancelled",
    phase: "cancelled",
    pid: null,
    completedAt: now(),
    errorMessage: "Cancelled by user."
  });
  appendLog(job.logFile, `[${now()}] Cancel requested. killed=${killed}\n`);
  return next;
}
