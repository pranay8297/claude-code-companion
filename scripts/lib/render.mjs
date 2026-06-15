import fs from "node:fs";

function elapsed(job) {
  const start = Date.parse(job.startedAt ?? job.createdAt ?? "");
  const end = Date.parse(job.completedAt ?? new Date().toISOString());
  if (!Number.isFinite(start) || !Number.isFinite(end)) {
    return "";
  }
  const seconds = Math.max(0, Math.round((end - start) / 1000));
  return `${seconds}s`;
}

export function renderSetup(report) {
  return [
    "# Claude Code Companion Setup",
    "",
    `Node: ${report.node.available ? "available" : "missing"} ${report.node.stdout || report.node.detail || ""}`.trim(),
    `Claude CLI: ${report.claude.available ? "available" : "missing"} ${report.claude.stdout || report.claude.detail || ""}`.trim(),
    `Claude auth: ${
      report.auth.parsed?.loggedIn
        ? "logged in"
        : report.auth.parsed?.loggedIn === false
          ? "not logged in"
          : "unknown; auth probe timed out or returned no JSON"
    }`,
    `State directory: ${report.stateDir}`,
    "",
    report.ready
      ? "Ready. If auth is shown as unknown, run a tiny `claude -p` command to confirm the CLI can use your logged-in session."
      : "Not ready. Run `claude auth login` if auth is missing, then retry."
  ].join("\n") + "\n";
}

export function renderTaskResult(job, result) {
  const lines = [
    `# ${job.title}`,
    "",
    `Job: ${job.id}`,
    `Status: ${result.status === 0 ? "completed" : "failed"}`,
    `Mode: ${job.mode ?? (job.readOnly ? "no_write" : "normal")}`,
    result.sessionId ? `Claude session: ${result.sessionId}` : "",
    result.costUsd != null ? `Cost: $${result.costUsd}` : "",
    "",
    result.finalText || "(Claude returned no final text.)"
  ].filter(Boolean);
  if (result.stderr?.trim()) {
    lines.push("", "## stderr", "", result.stderr.trim());
  }
  return lines.join("\n") + "\n";
}

export function renderQueued(job) {
  return `${job.title} started in the background as ${job.id}. Use \`status\` or \`result\` with this job id.\n`;
}

export function renderStatus(jobs) {
  if (jobs.length === 0) {
    return "No Claude jobs found for this workspace.\n";
  }
  const rows = ["| Job | Kind | Status | Phase | Mode | Elapsed | Summary |", "| --- | --- | --- | --- | --- | --- | --- |"];
  for (const job of jobs) {
    rows.push(
      `| ${job.id} | ${job.kind ?? ""} | ${job.status ?? ""} | ${job.phase ?? ""} | ${job.mode ?? (job.readOnly ? "no_write" : "normal")} | ${elapsed(job)} | ${(job.summary ?? "").replaceAll("|", "\\|")} |`
    );
  }
  return `${rows.join("\n")}\n`;
}

export function renderStoredResult(job, stored) {
  if (!job || !stored) {
    return "No stored Claude result found.\n";
  }
  if (stored.rendered) {
    return stored.rendered;
  }
  let log = "";
  if (stored.logFile && fs.existsSync(stored.logFile)) {
    log = fs.readFileSync(stored.logFile, "utf8");
  }
  return [`# ${stored.title ?? "Claude Job"}`, "", `Job: ${stored.id}`, `Status: ${stored.status}`, "", log || "(No output stored.)"].join("\n") + "\n";
}
