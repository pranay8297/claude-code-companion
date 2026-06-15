import { collectGitContext } from "./git.mjs";

const VALID_FINAL_RESPONSES = new Set(["normal", "concise", "minimal"]);

function normalizeFinalResponse(value) {
  if (value == null || value === "") {
    return null;
  }
  const normalized = String(value).trim();
  if (!VALID_FINAL_RESPONSES.has(normalized)) {
    throw new Error(`Unsupported finalResponse "${value}". Use normal, concise, or minimal.`);
  }
  return normalized;
}

function finalResponseInstruction(kind, value) {
  const mode = normalizeFinalResponse(value);
  if (!mode || mode === "normal") {
    return "";
  }
  if (kind === "review") {
    return mode === "minimal"
      ? "Final response: be terse. Return only findings with severity, file/line, and one short reason. If there are no findings, return exactly: NO_FINDINGS."
      : "Final response: keep the review concise. No preamble, no praise, no implementation narrative.";
  }
  return mode === "minimal"
    ? "Final response: minimize output tokens. If the task is complete, return exactly: DONE. If blocked, return only: BLOCKED: <short reason>. Do not summarize your steps."
    : "Final response: keep it concise. No preamble; include only the outcome and any essential caveat.";
}

export function buildReviewPrompt(cwd, options = {}) {
  const context = collectGitContext(cwd, options);
  return [
    "You are Claude Code acting as a read-only reviewer for Codex.",
    "Do not modify files. Do not run commands that write files. Focus on bugs, regressions, UX issues, missing tests, and maintainability risks.",
    "Return findings first, ordered by severity. Include file paths and line references when you can infer them.",
    finalResponseInstruction("review", options.finalResponse),
    options.focus ? `Additional focus: ${options.focus}` : "",
    `Review target: ${context.label}`,
    "Local git context:",
    context.content
  ]
    .filter(Boolean)
    .join("\n\n");
}

export function buildRescuePrompt(prompt, options = {}) {
  const mode =
    options.mode === "no_write" || options.readOnly
      ? "No-write mode: investigate, reason, and report. Do not edit files."
      : options.mode === "plan"
        ? "Plan mode requested: analyze and propose a plan without editing files."
        : options.mode === "auto_accept"
          ? "Auto-accept mode requested: you may edit files in this checkout when needed to satisfy the task."
          : "";
  return [
    mode,
    "You are Claude Code being called by Codex as a companion agent.",
    finalResponseInstruction("rescue", options.finalResponse),
    "Task:",
    prompt
  ]
    .filter(Boolean)
    .join("\n\n");
}
