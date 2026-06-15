#!/usr/bin/env node

import {
  cancelCommand,
  rescueCommand,
  resultCommand,
  reviewCommand,
  setupCommand,
  statusCommand
} from "./claude-companion.mjs";
import { renderSetup, renderStatus, renderStoredResult } from "./lib/render.mjs";

const PROTOCOL_VERSION = "2024-11-05";
const SERVER_INSTRUCTIONS = [
  "Use Claude Code Companion as a blocking foreground delegate unless the human explicitly asks for parallel/background work.",
  "Do not hurry to cancel a running Claude task. Before cancelling, consider the requested work, the repository size, and whether Claude is expected to inspect files, reason, edit, or run validation.",
  "For non-trivial implementation, review, or architecture tasks, be patient for a reasonable task-specific duration. Cancel only when the human asks, the process is clearly stuck, or there is concrete evidence that continuing is harmful.",
  "Do not pass optional behavior controls such as background, model, permissionMode, effort, or finalResponse unless the human asks for them or explicitly provides them."
].join(" ");

const modeSchema = {
  type: "string",
  enum: ["normal", "no_write", "plan", "auto_accept"],
  description: "Optional high-level Claude mode. normal adds no permission mode; no_write blocks edit tools without plan mode; plan uses Claude plan mode; auto_accept uses acceptEdits."
};

const stringOrArraySchema = (description) => ({
  oneOf: [
    { type: "string" },
    { type: "array", items: { type: "string" } }
  ],
  description
});

const capabilityProperties = {
  mode: modeSchema,
  finalResponse: {
    type: "string",
    enum: ["normal", "concise", "minimal"],
    description: "Optional. Controls Claude's final prose only when explicitly provided. Omit to add no final-response instruction."
  },
  tools: { type: "string", description: "Optional pass-through for Claude --tools, for example 'default' or 'Bash,Read,Edit'." },
  allowedTools: stringOrArraySchema("Optional pass-through for Claude --allowedTools."),
  disallowedTools: stringOrArraySchema("Optional pass-through for Claude --disallowedTools."),
  mcpConfig: stringOrArraySchema("Optional path(s) or JSON string(s) passed to Claude --mcp-config."),
  strictMcpConfig: { type: "boolean", description: "Pass --strict-mcp-config so Claude uses only the supplied MCP config." },
  addDir: stringOrArraySchema("Optional additional directory path(s) passed to Claude --add-dir."),
  permissionMode: { type: "string", description: "Optional raw Claude --permission-mode. Prefer mode unless you need a CLI-specific value." }
};

const tools = [
  {
    name: "setup",
    description: "Check local Claude Code CLI availability, auth status, and companion state directory.",
    inputSchema: {
      type: "object",
      properties: {
        cwd: { type: "string", description: "Workspace directory. Defaults to the MCP server cwd." }
      }
    }
  },
  {
    name: "review",
    description: "Run a read-only Claude Code review over the current git state.",
    inputSchema: {
      type: "object",
      properties: {
        cwd: { type: "string" },
        scope: { type: "string", enum: ["working-tree", "branch"] },
        base: { type: "string", description: "Base ref when scope is branch." },
        background: { type: "boolean" },
        model: { type: "string", description: "Optional Claude model alias or full model name. Omit to let Claude CLI choose its current default/latest model." },
        effort: { type: "string", enum: ["low", "medium", "high", "xhigh", "max"], description: "Optional Claude effort hint. Forwarded only if the installed Claude CLI supports --effort." },
        ...capabilityProperties
      }
    }
  },
  {
    name: "adversarial_review",
    description: "Run a read-only Claude Code review with explicit critique/focus text.",
    inputSchema: {
      type: "object",
      properties: {
        cwd: { type: "string" },
        focus: { type: "string", description: "Additional review framing or critique focus." },
        scope: { type: "string", enum: ["working-tree", "branch"] },
        base: { type: "string" },
        background: { type: "boolean" },
        model: { type: "string", description: "Optional Claude model alias or full model name. Omit to let Claude CLI choose its current default/latest model." },
        effort: { type: "string", enum: ["low", "medium", "high", "xhigh", "max"], description: "Optional Claude effort hint. Forwarded only if the installed Claude CLI supports --effort." },
        ...capabilityProperties
      },
      required: ["focus"]
    }
  },
  {
    name: "rescue",
    description: "Delegate an arbitrary task to Claude Code. Pass readOnly or mode explicitly when you want a constrained edit posture.",
    inputSchema: {
      type: "object",
      properties: {
        cwd: { type: "string" },
        prompt: { type: "string" },
        readOnly: { type: "boolean" },
        background: { type: "boolean" },
        resume: { type: "boolean" },
        sessionId: { type: "string", description: "With resume=true, resume this Claude session id. With resume=false, create/use this exact new session id." },
        forkSession: { type: "boolean", description: "Pass through Claude CLI --fork-session when resuming. Behavior depends on the installed Claude CLI." },
        model: { type: "string", description: "Optional Claude model alias or full model name. Omit to let Claude CLI choose its current default/latest model." },
        effort: { type: "string", enum: ["low", "medium", "high", "xhigh", "max"], description: "Optional Claude effort hint. Forwarded only if the installed Claude CLI supports --effort." },
        ...capabilityProperties
      },
      required: ["prompt"]
    }
  },
  {
    name: "status",
    description: "List active and recent Claude Code companion jobs for this workspace.",
    inputSchema: {
      type: "object",
      properties: {
        cwd: { type: "string" },
        all: { type: "boolean" }
      }
    }
  },
  {
    name: "result",
    description: "Show stored output for a completed Claude Code companion job.",
    inputSchema: {
      type: "object",
      properties: {
        cwd: { type: "string" },
        jobId: { type: "string" }
      }
    }
  },
  {
    name: "cancel",
    description: "Cancel an active background Claude Code companion job.",
    inputSchema: {
      type: "object",
      properties: {
        cwd: { type: "string" },
        jobId: { type: "string" }
      }
    }
  }
];

let buffer = Buffer.alloc(0);
let transportMode = null;

function encodeMessage(message) {
  const body = Buffer.from(JSON.stringify(message), "utf8");
  return Buffer.concat([
    Buffer.from(`Content-Length: ${body.length}\r\n\r\n`, "utf8"),
    body
  ]);
}

function send(message) {
  if (transportMode === "line") {
    process.stdout.write(`${JSON.stringify(message)}\n`);
    return;
  }
  process.stdout.write(encodeMessage(message));
}

function textResult(text) {
  return { content: [{ type: "text", text: String(text ?? "") }] };
}

function errorResult(message) {
  return { content: [{ type: "text", text: String(message ?? "") }], isError: true };
}

function tryReadMessage() {
  const firstNonWhitespace = buffer.findIndex((byte) => byte !== 0x20 && byte !== 0x09 && byte !== 0x0d && byte !== 0x0a);
  if (firstNonWhitespace > 0) {
    buffer = buffer.slice(firstNonWhitespace);
  }
  if (buffer.length === 0) {
    return null;
  }

  if (buffer[0] === 0x7b || transportMode === "line") {
    const newline = buffer.indexOf("\n");
    if (newline === -1) {
      return null;
    }
    const line = buffer.slice(0, newline).toString("utf8").trim();
    buffer = buffer.slice(newline + 1);
    if (!line) {
      return tryReadMessage();
    }
    transportMode = "line";
    return JSON.parse(line);
  }

  const separator = buffer.indexOf("\r\n\r\n");
  if (separator === -1) {
    return null;
  }
  const header = buffer.slice(0, separator).toString("utf8");
  const match = /Content-Length:\s*(\d+)/i.exec(header);
  if (!match) {
    buffer = buffer.slice(separator + 4);
    return null;
  }
  transportMode = "header";
  const length = Number(match[1]);
  const start = separator + 4;
  const end = start + length;
  if (buffer.length < end) {
    return null;
  }
  const body = buffer.slice(start, end).toString("utf8");
  buffer = buffer.slice(end);
  return JSON.parse(body);
}

async function callTool(name, args = {}) {
  if (name === "setup") {
    return textResult(renderSetup(await setupCommand(args)));
  }
  if (name === "review") {
    const response = await reviewCommand(args);
    return textResult(response.rendered);
  }
  if (name === "adversarial_review") {
    const response = await reviewCommand({ ...args, adversarial: true });
    return textResult(response.rendered);
  }
  if (name === "rescue") {
    const response = await rescueCommand(args);
    return textResult(response.rendered);
  }
  if (name === "status") {
    return textResult(renderStatus(statusCommand(args)));
  }
  if (name === "result") {
    const response = resultCommand(args);
    return textResult(renderStoredResult(response.job, response.stored));
  }
  if (name === "cancel") {
    const response = cancelCommand(args);
    return textResult(`Cancelled ${response.id}.\n`);
  }
  throw new Error(`Unknown tool: ${name}`);
}

async function handle(message) {
  if (message.id === undefined) {
    return;
  }
  try {
    if (message.method === "initialize") {
      send({
        jsonrpc: "2.0",
        id: message.id,
        result: {
          protocolVersion: PROTOCOL_VERSION,
          capabilities: { tools: {} },
          serverInfo: { name: "claude-code-companion", version: "0.1.8" },
          instructions: SERVER_INSTRUCTIONS
        }
      });
      return;
    }
    if (message.method === "tools/list") {
      send({ jsonrpc: "2.0", id: message.id, result: { tools } });
      return;
    }
    if (message.method === "tools/call") {
      const result = await callTool(message.params?.name, message.params?.arguments ?? {});
      send({ jsonrpc: "2.0", id: message.id, result });
      return;
    }
    if (message.method === "ping") {
      send({ jsonrpc: "2.0", id: message.id, result: {} });
      return;
    }
    send({
      jsonrpc: "2.0",
      id: message.id,
      error: { code: -32601, message: `Method not found: ${message.method}` }
    });
  } catch (error) {
    if (message.method === "tools/call") {
      send({ jsonrpc: "2.0", id: message.id, result: errorResult(error instanceof Error ? error.message : String(error)) });
      return;
    }
    send({
      jsonrpc: "2.0",
      id: message.id,
      error: { code: -32000, message: error instanceof Error ? error.message : String(error) }
    });
  }
}

process.stdin.on("data", async (chunk) => {
  buffer = Buffer.concat([buffer, chunk]);
  while (true) {
    const message = tryReadMessage();
    if (!message) {
      break;
    }
    await handle(message);
  }
});
