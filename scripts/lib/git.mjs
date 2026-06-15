import { spawnSync } from "node:child_process";

function runGit(cwd, args) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8", timeout: 10000 });
  return {
    ok: result.status === 0,
    stdout: String(result.stdout ?? "").trim(),
    stderr: String(result.stderr ?? "").trim()
  };
}

export function gitAvailable(cwd) {
  return runGit(cwd, ["rev-parse", "--is-inside-work-tree"]).ok;
}

export function collectGitContext(cwd, options = {}) {
  if (!gitAvailable(cwd)) {
    return {
      available: false,
      label: "workspace files",
      content: "This directory is not inside a git repository. Review the workspace directly."
    };
  }

  const status = runGit(cwd, ["status", "--short", "--untracked-files=all"]).stdout;
  const branch = runGit(cwd, ["branch", "--show-current"]).stdout || "detached";
  const scope = options.scope ?? "working-tree";
  const base = options.base ?? "";
  let diff = "";
  let label = "working tree";

  if (scope === "branch" && base) {
    diff = runGit(cwd, ["diff", `${base}...HEAD`]).stdout;
    label = `branch diff against ${base}`;
  } else {
    const staged = runGit(cwd, ["diff", "--cached"]).stdout;
    const unstaged = runGit(cwd, ["diff"]).stdout;
    diff = [staged && "Staged diff:\n" + staged, unstaged && "Unstaged diff:\n" + unstaged]
      .filter(Boolean)
      .join("\n\n");
  }

  return {
    available: true,
    label,
    content: [
      `Branch: ${branch}`,
      `Status:\n${status || "(clean)"}`,
      `Diff:\n${diff || "(no tracked diff; inspect untracked files listed in status if relevant)"}`
    ].join("\n\n")
  };
}
