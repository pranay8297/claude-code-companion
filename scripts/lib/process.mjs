import { spawn, spawnSync } from "node:child_process";

export function binaryStatus(binary, args = ["--version"], options = {}) {
  const result = spawnSync(binary, args, {
    cwd: options.cwd ?? process.cwd(),
    encoding: "utf8",
    timeout: options.timeoutMs ?? 5000
  });
  return {
    available: !result.error && result.status === 0,
    status: result.status,
    stdout: String(result.stdout ?? "").trim(),
    stderr: String(result.stderr ?? "").trim(),
    detail: result.error ? result.error.message : null
  };
}

export function spawnCapture(command, args, options = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: options.cwd ?? process.cwd(),
      env: options.env ?? process.env,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true
    });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk) => {
      stdout += chunk.toString();
      options.onStdout?.(chunk.toString(), child.pid);
    });
    child.stderr?.on("data", (chunk) => {
      stderr += chunk.toString();
      options.onStderr?.(chunk.toString(), child.pid);
    });
    child.on("error", (error) => {
      resolve({ status: 1, stdout, stderr, error });
    });
    child.on("close", (status, signal) => {
      resolve({ status: status ?? 1, signal, stdout, stderr, error: null });
    });
    options.onStart?.(child.pid);
  });
}

export function spawnDetached(command, args, options = {}) {
  const child = spawn(command, args, {
    cwd: options.cwd ?? process.cwd(),
    env: options.env ?? process.env,
    detached: true,
    stdio: "ignore",
    windowsHide: true
  });
  child.unref();
  return child;
}

export function terminateProcessTree(pid) {
  const numericPid = Number(pid);
  if (!Number.isFinite(numericPid) || numericPid <= 0) {
    return false;
  }
  try {
    process.kill(-numericPid, "SIGTERM");
    return true;
  } catch {
    try {
      process.kill(numericPid, "SIGTERM");
      return true;
    } catch {
      return false;
    }
  }
}
