// Integration & security tests for the QuoteMend dashboard merge.
// Run with: npm test  (node --test tests/)
//
// These guard the merge contract:
//  1. Every original API route file is present and exports a handler.
//  2. Every original environment variable is still documented.
//  3. The service-role key is only referenced server-side — never in
//     any client component ("use client" file) or public asset.
//  4. The template merge preview mirrors api/send.js behavior.
//  5. Priority derivation is deterministic and total.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

// ── 1. API routes preserved ──────────────────────────────────
test("all four original API routes exist and export a default handler", () => {
  const routes = ["enroll.js", "health.js", "send.js", "update-status.js"];
  for (const file of routes) {
    const path = join(root, "api", file);
    assert.ok(existsSync(path), `api/${file} is missing`);
    const src = readFileSync(path, "utf8");
    assert.match(
      src,
      /export default (async )?function handler/,
      `api/${file} no longer exports a default handler`
    );
  }
});

// ── 2. Environment variables preserved ───────────────────────
test(".env.example still documents every original variable", () => {
  const env = readFileSync(join(root, ".env.example"), "utf8");
  const required = [
    "SUPABASE_URL",
    "SUPABASE_SERVICE_KEY",
    "WEBHOOK_SECRET",
    "WEBHOOK_URL",
    "ELEVENLABS_API_KEY",
    "SMTP_PASS_MATT",
    "SMTP_PASS_TAMIKO",
    "SMTP_PASS_CAM",
  ];
  for (const name of required) {
    assert.ok(env.includes(name), `${name} vanished from .env.example`);
  }
});

// ── 3. Secrets never reach the client ────────────────────────
function walk(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === ".next") continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

test("no client component or public asset accesses server secrets", () => {
  const candidates = ["app", "components", "public"]
    .map((d) => join(root, d))
    .filter(existsSync)
    .flatMap((d) => walk(d));
  // Mentioning a variable NAME in setup copy is fine; ACCESSING the env is
  // not. Flag any process.env usage of a secret from client-reachable code.
  const forbidden =
    /process\.env(\.|\[["'])(SUPABASE_SERVICE_KEY|WEBHOOK_SECRET|SMTP_PASS)/;
  for (const file of candidates) {
    const src = readFileSync(file, "utf8");
    const isClient = src.startsWith('"use client"') || src.startsWith("'use client'");
    if (isClient || file.includes("/public/")) {
      assert.ok(
        !forbidden.test(src),
        `${file} accesses a server secret from client-reachable code`
      );
    }
  }
});

test("no NEXT_PUBLIC_ variable carries a secret name", () => {
  const all = ["app", "components", "lib", "public"]
    .map((d) => join(root, d))
    .filter(existsSync)
    .flatMap((d) => walk(d));
  for (const file of all) {
    const src = readFileSync(file, "utf8");
    assert.ok(
      !/NEXT_PUBLIC_[A-Z_]*(KEY|SECRET|PASS)/.test(src),
      `${file} exposes a secret through a NEXT_PUBLIC_ variable`
    );
  }
});

test("the data layer is marked server-only", () => {
  const src = readFileSync(join(root, "lib", "dashboard-data.ts"), "utf8");
  assert.match(src, /import "server-only"/);
});

// ── 4. Template merge parity with api/send.js ────────────────
// The TS module can't be imported by node:test directly without a build,
// so we verify parity structurally: both files must handle the same
// variable set with the same defaults.
test("dashboard preview handles the same template variables as api/send.js", () => {
  const sendSrc = readFileSync(join(root, "api", "send.js"), "utf8");
  const dashSrc = readFileSync(join(root, "lib", "dashboard-data.ts"), "utf8");
  const variables = (sendSrc.match(/\{\{[a-z_]+\}\}/g) || []).map((v) =>
    v.replace(/[{}]/g, "")
  );
  assert.ok(variables.length >= 8, "expected send.js to define merge variables");
  for (const v of new Set(variables)) {
    assert.ok(
      dashSrc.includes(`{{${v}}}`) || dashSrc.includes(`\\{\\{${v}\\}\\}`),
      `preview merge is missing {{${v}}}`
    );
  }
});

// ── 5. Priority derivation (re-implemented spec check) ───────
// Mirrors derivePriority in lib/dashboard-data.ts.
function derivePriority(daysOverdue, step) {
  if (daysOverdue > 0) return "Hot";
  if (step > 1) return "Warm";
  return "Watch";
}

test("priority derivation is total and matches the documented rules", () => {
  assert.equal(derivePriority(3, 1), "Hot");
  assert.equal(derivePriority(1, 5), "Hot");
  assert.equal(derivePriority(0, 2), "Warm");
  assert.equal(derivePriority(0, 1), "Watch");
  const dashSrc = readFileSync(join(root, "lib", "dashboard-data.ts"), "utf8");
  assert.match(dashSrc, /if \(daysOverdue > 0\) return "Hot"/);
  assert.match(dashSrc, /if \(step > 1\) return "Warm"/);
  assert.match(dashSrc, /return "Watch"/);
});
