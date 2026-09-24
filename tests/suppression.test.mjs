import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  buildUnsubscribeUrl,
  getUnsubscribeSigningKey,
  mintUnsubscribeToken,
  normalizeEmail,
  parseSuppressionCsv,
  readUnsubscribeToken,
  suppressContact,
  toSuppressionCsv,
} from "../lib/services/suppression.js";

const ENVIRONMENT = { UNSUBSCRIBE_SECRET: "a-real-unsubscribe-signing-secret" };

test("a token round-trips and carries the normalised address", () => {
  const token = mintUnsubscribeToken("  Pat.Smith@Example.COM ", ENVIRONMENT);

  assert.deepEqual(readUnsubscribeToken(token, ENVIRONMENT), {
    email: "pat.smith@example.com",
    valid: true,
  });
});

test("a tampered token is refused, so a link cannot be edited to name someone else", () => {
  const token = mintUnsubscribeToken("victim@example.com", ENVIRONMENT);
  const [, signature] = token.split(".");
  const forgedPayload = Buffer.from(
    JSON.stringify({ e: "someone.else@example.com", v: 1 }),
    "utf8",
  ).toString("base64url");

  assert.deepEqual(readUnsubscribeToken(`${forgedPayload}.${signature}`, ENVIRONMENT), {
    email: null,
    valid: false,
  });
  assert.deepEqual(readUnsubscribeToken(`${token}x`, ENVIRONMENT), { email: null, valid: false });
  assert.deepEqual(readUnsubscribeToken("", ENVIRONMENT), { email: null, valid: false });
  assert.deepEqual(readUnsubscribeToken("no-dot-here", ENVIRONMENT), { email: null, valid: false });
});

test("a token signed with one secret is worthless under another", () => {
  const token = mintUnsubscribeToken("pat@example.com", ENVIRONMENT);

  assert.equal(
    readUnsubscribeToken(token, { UNSUBSCRIBE_SECRET: "a-different-signing-secret" }).valid,
    false,
  );
});

test("the signing key is derived from WEBHOOK_SECRET, never the secret itself", () => {
  const derived = getUnsubscribeSigningKey({ WEBHOOK_SECRET: "the-send-webhook-secret" });

  assert.ok(derived, "unsubscribe links must still work before UNSUBSCRIBE_SECRET is set");
  assert.notEqual(derived, "the-send-webhook-secret");

  const url = buildUnsubscribeUrl("pat@example.com", "https://example.test", {
    WEBHOOK_SECRET: "the-send-webhook-secret",
  });
  assert.doesNotMatch(url, /the-send-webhook-secret/);
});

test("refuses to mint a link when nothing is configured to sign it", () => {
  assert.throws(() => mintUnsubscribeToken("pat@example.com", {}), {
    code: "UNSUBSCRIBE_SECRET_MISSING",
  });
  assert.equal(getUnsubscribeSigningKey({ UNSUBSCRIBE_SECRET: "your-secret-here" }), null);
});

test("a built link points at the unsubscribe route and survives a trailing slash", () => {
  const url = buildUnsubscribeUrl("pat@example.com", "https://example.test/", ENVIRONMENT);

  assert.match(url, /^https:\/\/example\.test\/api\/unsubscribe\?token=/);
  assert.equal(new URL(url).pathname, "/api/unsubscribe");
});

// ── The write goes through one transaction ──────────────────────────────────
function recordingSupabase(response = { data: { contact_found: true }, error: null }) {
  const calls = [];

  return {
    calls,
    from() {
      throw new Error("suppression must not write tables directly; use the rpc");
    },
    rpc(name, args) {
      calls.push({ args, name });
      return Promise.resolve(response);
    },
  };
}

test("suppression is a single rpc call, not separate table writes", async () => {
  const supabase = recordingSupabase();

  await suppressContact(supabase, {
    email: "Pat@Example.com",
    reason: "Recipient used the unsubscribe link",
    source: "one-click",
  });

  assert.equal(supabase.calls.length, 1);
  assert.equal(supabase.calls[0].name, "suppress_contact");
  assert.equal(supabase.calls[0].args.contact_email, "pat@example.com");
  assert.equal(supabase.calls[0].args.suppression_scope, "global");
  assert.equal(supabase.calls[0].args.suppression_campaign, null);
});

test("refuses a campaign-scoped suppression with no campaign key", async () => {
  await assert.rejects(
    () => suppressContact(recordingSupabase(), {
      email: "pat@example.com",
      reason: "test",
      scope: "campaign",
    }),
    { code: "SUPPRESSION_CAMPAIGN_REQUIRED" },
  );

  await assert.rejects(
    () => suppressContact(recordingSupabase(), { email: "   ", reason: "test" }),
    { code: "SUPPRESSION_EMAIL_REQUIRED" },
  );
});

test("surfaces a failed write rather than reporting a silent success", async () => {
  const supabase = recordingSupabase({ data: null, error: { message: "deadlock detected" } });

  await assert.rejects(
    () => suppressContact(supabase, { email: "pat@example.com", reason: "test" }),
    { code: "SUPPRESSION_WRITE_FAILED" },
  );
});

// ── Export / import round-trips ─────────────────────────────────────────────
test("an exported suppression list re-imports without loss", () => {
  const rows = [
    {
      campaign: null,
      created_at: "2026-09-19T10:00:00.000Z",
      match_type: "email",
      reason: "Recipient used the unsubscribe link",
      scope: "global",
      source: "one-click",
      value: "pat@example.com",
    },
    {
      campaign: "aesthetic",
      created_at: "2026-09-18T10:00:00.000Z",
      match_type: "email",
      reason: 'Said "stop, and take me off everything"',
      scope: "campaign",
      source: "reply",
      value: "sam@example.com",
    },
    {
      campaign: null,
      created_at: "2026-09-17T10:00:00.000Z",
      match_type: "domain",
      reason: "Competitor, do not contact",
      scope: "global",
      source: "manual",
      value: "competitor.com",
    },
  ];

  const parsed = parseSuppressionCsv(toSuppressionCsv(rows));

  assert.deepEqual(parsed.errors, []);
  assert.deepEqual(parsed.rows, rows);
});

test("a comma and a quote in a reason survive the round trip", () => {
  const rows = [{
    campaign: null,
    created_at: "2026-09-19T10:00:00.000Z",
    match_type: "email",
    reason: 'Replied: "remove me, now"',
    scope: "global",
    source: "reply",
    value: "pat@example.com",
  }];

  assert.deepEqual(parseSuppressionCsv(toSuppressionCsv(rows)).rows, rows);
});

test("accepts a bare list from another platform and infers the obvious", () => {
  const parsed = parseSuppressionCsv("email\nPat@Example.com\ncompetitor.com\n");

  assert.deepEqual(parsed.errors, []);
  assert.deepEqual(parsed.rows.map((row) => [row.value, row.match_type, row.scope]), [
    ["pat@example.com", "email", "global"],
    ["competitor.com", "domain", "global"],
  ]);
  assert.equal(parsed.rows[0].source, "import");
});

test("reports bad rows instead of importing them", () => {
  const parsed = parseSuppressionCsv(
    "value,match_type,scope,campaign\n" +
    "not-an-email,email,global,\n" +
    "sam@example.com,email,campaign,\n" +
    "ok@example.com,email,global,\n",
  );

  assert.equal(parsed.rows.length, 1);
  assert.equal(parsed.rows[0].value, "ok@example.com");
  assert.equal(parsed.errors.length, 2);
  assert.match(parsed.errors[0], /is not an email address/);
  assert.match(parsed.errors[1], /campaign scope needs a campaign key/);
});

test("an empty or headerless list is refused rather than half-imported", () => {
  assert.deepEqual(parseSuppressionCsv(""), { errors: [], rows: [] });
  assert.deepEqual(parseSuppressionCsv("first_name,last_name\nPat,Smith"), {
    errors: ['CSV needs a "value" or "email" column'],
    rows: [],
  });
});

test("normalises addresses the same way everywhere", () => {
  assert.equal(normalizeEmail("  Pat.Smith@Example.COM "), "pat.smith@example.com");
  assert.equal(normalizeEmail(null), "");
});

// ── Route and mail-header contracts ─────────────────────────────────────────
test("GET never opts anyone out; only POST suppresses", async () => {
  const route = await readFile(new URL("../pages/api/unsubscribe.js", import.meta.url), "utf8");

  const getBranch = route.indexOf("if (req.method === 'GET')");
  const suppressCall = route.indexOf("await suppressContact(");
  assert.ok(getBranch > -1, "the route must handle GET explicitly");
  assert.ok(suppressCall > -1, "the route must suppress on POST");
  assert.ok(
    getBranch < suppressCall,
    "GET must return before anything is suppressed, or a link scanner opts people out",
  );
  assert.match(route, /confirmPage\(token\)/);
});

test("one-click declares an https link, which is what Gmail requires", async () => {
  const sendRoute = await readFile(new URL("../pages/api/send.js", import.meta.url), "utf8");

  // RFC 8058: List-Unsubscribe-Post is only valid alongside an https URI.
  // Declaring it against a mailto alone gets no native control in Gmail.
  assert.match(sendRoute, /buildUnsubscribeUrl\(item\.email, unsubscribeOrigin\)/);
  assert.match(sendRoute, /'List-Unsubscribe': `<\$\{unsubUrl\}>, <\$\{unsubMailto\}>`/);
  assert.match(sendRoute, /'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click'/);

  const oneClickIndex = sendRoute.indexOf("List-Unsubscribe=One-Click");
  const fallbackIndex = sendRoute.indexOf("{ 'List-Unsubscribe': `<${unsubMailto}>` }");
  assert.ok(
    fallbackIndex > oneClickIndex,
    "without a signing key the mail must fall back to mailto and NOT claim one-click",
  );
});

test("an operator-reported unsubscribe uses the same transaction as the public route", async () => {
  const updateStatus = await readFile(
    new URL("../pages/api/update-status.js", import.meta.url),
    "utf8",
  );

  assert.match(updateStatus, /await suppressContact\(supabase, \{/);
  assert.doesNotMatch(
    updateStatus,
    /update\(\{ unsubscribed: true \}\)/,
    "the standalone unsubscribed flag write is what the transaction replaces",
  );
});

test("the migration extends todays_queue and keeps both original conditions", async () => {
  const migration = await readFile(
    new URL("../supabase/migrations/20260919_suppressions.sql", import.meta.url),
    "utf8",
  );

  assert.match(migration, /c\.unsubscribed\s+= false/);
  assert.match(migration, /c\.bounced\s+= false/);
  assert.match(migration, /not exists \(\s*select 1\s*from suppressions s/);
  assert.match(migration, /create table if not exists suppressions/);
  assert.match(migration, /alter table suppressions enable row level security/);
  // Assert against the SQL itself, not the comments explaining it.
  const statements = migration
    .split(/\r?\n/)
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");

  assert.doesNotMatch(statements, /drop (table|view|column)/i, "the migration must be additive");
  assert.doesNotMatch(statements, /security definer/i, "the rpc must not run as its owner");
});

// ── The route, actually invoked ─────────────────────────────────────────────
function createHtmlResponse() {
  return {
    body: null,
    headers: new Map(),
    statusCode: 200,
    json(payload) { this.body = payload; return this; },
    send(payload) { this.body = payload; return this; },
    setHeader(name, value) { this.headers.set(name, value); },
    status(statusCode) { this.statusCode = statusCode; return this; },
  };
}

test("a real GET renders the confirm page and touches no database", async () => {
  // Supabase is deliberately left unconfigured. A GET that reached the
  // database at all would fail here rather than render.
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_KEY;
  process.env.UNSUBSCRIBE_SECRET = "a-real-unsubscribe-signing-secret";

  const { default: unsubscribeHandler } = await import("../pages/api/unsubscribe.js");
  const token = mintUnsubscribeToken("pat@example.com", process.env);
  const response = createHtmlResponse();

  await unsubscribeHandler({ headers: {}, method: "GET", query: { token } }, response);

  assert.equal(response.statusCode, 200);
  assert.match(response.body, /<h1>Unsubscribe<\/h1>/);
  assert.match(response.body, /Nothing has changed yet/);
  assert.match(response.body, /method="POST"/);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
});

test("a real GET with a forged token refuses rather than rendering a working form", async () => {
  const { default: unsubscribeHandler } = await import("../pages/api/unsubscribe.js");
  const response = createHtmlResponse();

  await unsubscribeHandler(
    { headers: {}, method: "GET", query: { token: "forged.token" } },
    response,
  );

  assert.equal(response.statusCode, 400);
  assert.match(response.body, /not valid/);
});

test("other verbs are refused outright", async () => {
  const { default: unsubscribeHandler } = await import("../pages/api/unsubscribe.js");
  const response = createHtmlResponse();

  await unsubscribeHandler({ headers: {}, method: "DELETE", query: {} }, response);

  assert.equal(response.statusCode, 405);
  assert.equal(response.headers.get("Allow"), "GET, POST");
});

test("a POST reads the token from a form body, as one-click sends it", async () => {
  const { default: unsubscribeHandler } = await import("../pages/api/unsubscribe.js");
  const token = mintUnsubscribeToken("pat@example.com", process.env);
  const response = createHtmlResponse();

  // Supabase is still unconfigured, so this stops at the 503 rather than
  // writing. What it proves is that the token was read and accepted from a
  // urlencoded body: an invalid token would have been a 400.
  await unsubscribeHandler(
    {
      body: `token=${encodeURIComponent(token)}`,
      headers: { "content-type": "application/x-www-form-urlencoded" },
      method: "POST",
      query: {},
    },
    response,
  );

  assert.equal(response.statusCode, 503);
  assert.match(response.body, /could not complete/i);
});
