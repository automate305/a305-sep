import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import test from "node:test";

function frame(message) {
  const payload = Buffer.from(JSON.stringify(message), "utf8");
  return Buffer.concat([
    Buffer.from(`Content-Length: ${payload.length}\r\n\r\n`, "utf8"),
    payload,
  ]);
}

function readFrames(socket) {
  let buffer = Buffer.alloc(0);
  const messages = [];
  return {
    push(chunk) {
      buffer = Buffer.concat([buffer, chunk]);
      while (true) {
        const headerEnd = buffer.indexOf("\r\n\r\n");
        if (headerEnd === -1) return;
        const header = buffer.slice(0, headerEnd).toString("utf8");
        const match = header.match(/Content-Length:\s*(\d+)/i);
        if (!match) throw new Error("missing content length");
        const length = Number(match[1]);
        const start = headerEnd + 4;
        if (buffer.length < start + length) return;
        messages.push(JSON.parse(buffer.slice(start, start + length).toString("utf8")));
        buffer = buffer.slice(start + length);
      }
    },
    messages,
  };
}

test("lists Outbox tools and refuses a send without the confirm phrase", async () => {
  const child = spawn(process.execPath, ["mcp/server.mjs"], {
    cwd: new URL("..", import.meta.url),
    stdio: ["pipe", "pipe", "pipe"],
  });
  const reader = readFrames();
  child.stdout.on("data", (chunk) => reader.push(chunk));
  const stderr = [];
  child.stderr.on("data", (chunk) => stderr.push(chunk.toString()));

  child.stdin.write(frame({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "test", version: "0" } },
  }));
  child.stdin.write(frame({ jsonrpc: "2.0", method: "notifications/initialized" }));
  child.stdin.write(frame({ jsonrpc: "2.0", id: 2, method: "tools/list" }));
  child.stdin.write(frame({
    jsonrpc: "2.0",
    id: 3,
    method: "tools/call",
    params: { name: "outbox_send_approved", arguments: { confirm: "no" } },
  }));
  child.stdin.end();

  const exitCode = await new Promise((resolve) => child.on("close", resolve));
  assert.equal(exitCode, 0, stderr.join(""));
  assert.equal(reader.messages[0].result.serverInfo.name, "outbox");
  const names = reader.messages[1].result.tools.map((tool) => tool.name);
  assert.deepEqual(names, [
    "outbox_health",
    "outbox_readiness",
    "outbox_overview",
    "outbox_enroll",
    "outbox_review_hold",
    "outbox_set_contact_status",
    "outbox_send_approved",
  ]);
  assert.equal(reader.messages[2].result.isError, true);
  assert.match(reader.messages[2].result.content[0].text, /Refused/);
});
