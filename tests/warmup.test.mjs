import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { activeWarmupDay, warmupMessage } from "../lib/services/warmup.ts";

// Real send_log history for matt@/tamiko@aestheticdevicepro.com, captured
// 30 Sep 2026. Active days: Sep 1,2,3,5,6,7,10,23,24 — 9 distinct days,
// three real gaps (Sep 4; Sep 8-9; Sep 11-22, twelve days).
const REAL_WARMUP_SEND_DATES_UTC = [
  "2026-09-01T23:29:26.859Z", "2026-09-02T02:29:26.859Z",
  "2026-09-02T23:29:26.859Z", "2026-09-03T02:29:26.859Z",
  "2026-09-03T23:29:26.859Z", "2026-09-04T02:29:26.859Z",
  "2026-09-05T23:29:26.859Z", "2026-09-06T02:29:26.859Z",
  "2026-09-06T23:29:26.859Z", "2026-09-07T02:29:26.859Z",
  "2026-09-07T23:29:26.859Z", "2026-09-08T02:29:26.859Z",
  "2026-09-10T23:29:26.859Z", "2026-09-11T02:29:26.859Z",
  "2026-09-23T21:52:22.454Z", "2026-09-23T22:15:00.000Z",
  "2026-09-23T22:40:00.000Z", "2026-09-23T23:05:00.000Z",
  "2026-09-24T21:52:22.454Z", "2026-09-24T22:15:00.000Z",
  "2026-09-24T22:40:00.000Z", "2026-09-24T23:05:00.000Z",
];

function fakeSupabase(sentAtIsoTimestamps) {
  return {
    from(table) {
      assert.equal(table, "send_log");
      return {
        eq() { return this; },
        select() { return this; },
        then: (resolve) => resolve({
          data: sentAtIsoTimestamps.map((sent_at) => ({ sent_at })),
          error: null,
        }),
      };
    },
  };
}

test("counts distinct active days, not calendar days, from real warmup history", async () => {
  // "Today" is after the real gap, same as when this was actually resumed.
  const day = await activeWarmupDay(
    fakeSupabase(REAL_WARMUP_SEND_DATES_UTC),
    "sender-1",
    new Date("2026-09-30T13:30:00.000Z"),
  );

  // 9 real active days happened (Sep 1,2,3,5,6,7,10,23,24); today is the 10th.
  assert.equal(day, 10, "a mailbox with 9 active days and a 12-day gap must resume at day 10, not day 21");
});

test("a mailbox silent for two weeks does not jump to a high cap", async () => {
  // Calendar-based math from a Sep 7 start would already read day 21 (the
  // cap) by Sep 30 — 23 calendar days elapsed. Active-day counting must not.
  const day = await activeWarmupDay(
    fakeSupabase(REAL_WARMUP_SEND_DATES_UTC),
    "sender-1",
    new Date("2026-09-30T13:30:00.000Z"),
  );

  assert.notEqual(day, 28, "calendar time passing must not, by itself, complete the ramp");
  assert.ok(day < 28, "a genuinely interrupted ramp must still show real days left");
});

test("a send already made today does not double-count today", async () => {
  const sends = [...REAL_WARMUP_SEND_DATES_UTC, "2026-09-30T13:00:00.000Z"];
  const day = await activeWarmupDay(fakeSupabase(sends), "sender-1", new Date("2026-09-30T18:00:00.000Z"));

  assert.equal(day, 10, "today's own send must not be counted as a prior day");
});

test("a brand-new mailbox with no history starts at day 1", async () => {
  const day = await activeWarmupDay(fakeSupabase([]), "sender-1", new Date("2026-09-30T13:00:00.000Z"));

  assert.equal(day, 1);
});

test("caps at 28 once 28 distinct active days have genuinely happened", async () => {
  const thirtyDistinctDays = Array.from(
    { length: 30 },
    (_, index) => `2026-01-${String(index + 1).padStart(2, "0")}T12:00:00.000Z`,
  );
  const day = await activeWarmupDay(fakeSupabase(thirtyDistinctDays), "sender-1", new Date("2026-02-01T12:00:00.000Z"));

  assert.equal(day, 28);
});

test("a send that throws propagates rather than silently resuming at day 1", async () => {
  const throwingSupabase = {
    from() {
      return {
        eq() { return this; },
        select() { return this; },
        then: (_resolve, reject) => reject(new Error("connection reset")),
      };
    },
  };

  await assert.rejects(() => activeWarmupDay(throwingSupabase, "sender-1"));
});

// ── The cron route ───────────────────────────────────────────────────────────
function createJsonResponse() {
  return {
    body: null,
    headers: new Map(),
    statusCode: 200,
    json(payload) { this.body = payload; return this; },
    setHeader(name, value) { this.headers.set(name, value); },
    status(statusCode) { this.statusCode = statusCode; return this; },
  };
}

test("the warmup cron refuses a request without the bearer secret", async () => {
  process.env.CRON_SECRET = "test-cron-secret";
  const { default: handler } = await import("../pages/api/cron/daily-warmup.js");
  const response = createJsonResponse();

  await handler({ headers: {}, method: "GET" }, response);

  assert.equal(response.statusCode, 401);
});

test("the warmup cron is disabled by default even with a valid secret", async () => {
  process.env.CRON_SECRET = "test-cron-secret";
  delete process.env.WARMUP_AUTOMATION_ENABLED;
  const { default: handler } = await import("../pages/api/cron/daily-warmup.js");
  const response = createJsonResponse();

  await handler({ headers: { authorization: "Bearer test-cron-secret" }, method: "GET" }, response);

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.automation, "disabled");
});

test("only the exact string 'true' enables the warmup cron", async () => {
  process.env.CRON_SECRET = "test-cron-secret";
  for (const value of ["1", "TRUE", "yes"]) {
    process.env.WARMUP_AUTOMATION_ENABLED = value;
    delete process.env.SUPABASE_URL;
    const { default: handler } = await import("../pages/api/cron/daily-warmup.js");
    const response = createJsonResponse();
    await handler({ headers: { authorization: "Bearer test-cron-secret" }, method: "GET" }, response);
    assert.equal(response.body.automation, "disabled", `"${value}" must not enable automation`);
  }
  delete process.env.WARMUP_AUTOMATION_ENABLED;
});

test("non-GET methods are refused", async () => {
  process.env.CRON_SECRET = "test-cron-secret";
  const { default: handler } = await import("../pages/api/cron/daily-warmup.js");
  const response = createJsonResponse();

  await handler({ headers: {}, method: "POST" }, response);

  assert.equal(response.statusCode, 405);
});

test("the cron never calls startHostingerWarmup — it only runs an existing ramp", async () => {
  const route = await readFile(new URL("../pages/api/cron/daily-warmup.js", import.meta.url), "utf8");

  assert.match(route, /runWarmup/);
  assert.doesNotMatch(route, /startHostingerWarmup/);
});

test("vercel.json runs warmup every day, unlike the weekday-only campaign cron", async () => {
  const config = JSON.parse(await readFile(new URL("../vercel.json", import.meta.url), "utf8"));
  const warmupCron = config.crons.find((cron) => cron.path === "/api/cron/daily-warmup");

  assert.ok(warmupCron, "vercel.json must register the warmup cron");
  assert.equal(warmupCron.schedule, "0 13 * * *");
});

// ── Warmup wording ───────────────────────────────────────────────────────────
const VARIANTS = Array.from({ length: 300 }, (_, variant) => variant);

test("every warmup wording follows the copy rules", () => {
  for (const variant of VARIANTS) {
    for (const name of ["Matt", "Tamiko"]) {
      const { subject, text } = warmupMessage(name, variant);
      const [greeting, body, closingAndName] = text.split("\n\n");
      const [closing, signedAs, ...rest] = closingAndName.split("\n");

      assert.match(subject, /^[a-z]+( [a-z]+){2,3}$/, `subject "${subject}" must be lowercase, three or four words`);
      assert.match(greeting, /^[A-Z][a-z]+,$/, `greeting "${greeting}" must be sentence case`);
      assert.match(body, /^[A-Z]/, "body must start with a capital");
      assert.notEqual(body, body.toLowerCase(), "body must never be all lowercase");
      assert.doesNotMatch(text, /[—–]/, "no em or en dashes");
      assert.doesNotMatch(text, /https?:|www\.|\{\{/, "no links or unresolved placeholders");
      assert.doesNotMatch(text, /camilo/i, "Aesthetic senders never sign as Camilo");
      assert.match(closing, /^[A-Z]/);
      assert.equal(signedAs, name, "signed with the sending mailbox's own name");
      assert.deepEqual(rest, [], "nothing after the signature");
    }
  }
});

test("consecutive sends never repeat a subject or a body", () => {
  for (let start = 0; start < 100; start += 1) {
    const subjects = new Set();
    for (let offset = 0; offset < 7; offset += 1) subjects.add(warmupMessage("Matt", start + offset).subject);
    assert.equal(subjects.size, 7, `seven consecutive sends from ${start} must use seven subjects`);

    const bodies = new Set();
    for (let offset = 0; offset < 5; offset += 1) bodies.add(warmupMessage("Matt", start + offset).text.split("\n\n")[1]);
    assert.equal(bodies.size, 5, `five consecutive sends from ${start} must use five bodies`);
  }
});

test("the wording genuinely varies across a ramp, not just by one field", () => {
  const distinctMessages = new Set(VARIANTS.map((variant) => warmupMessage("Matt", variant).text));
  const distinctSubjects = new Set(VARIANTS.map((variant) => warmupMessage("Matt", variant).subject));

  assert.ok(distinctMessages.size >= 20, `expected at least 20 distinct messages, got ${distinctMessages.size}`);
  assert.ok(distinctSubjects.size >= 6, `expected at least 6 distinct subjects, got ${distinctSubjects.size}`);
});

test("a bad variant number cannot produce a broken message", () => {
  for (const variant of [-3, 2.7, Number.MAX_SAFE_INTEGER]) {
    const { subject, text } = warmupMessage("Tamiko", variant);
    assert.ok(subject.length > 0 && text.endsWith("Tamiko"), `variant ${variant} must still yield a full message`);
  }
});

test("the send path uses the varied wording and no longer hard-codes one message", async () => {
  const source = await readFile(new URL("../lib/services/warmup.ts", import.meta.url), "utf8");

  assert.match(source, /warmupMessage\(sender\.name, variant\)/);
  assert.doesNotMatch(source, /subject: "Quick mailbox setup check"/, "the single hard-coded subject must be gone");
  assert.match(source, /subject: "Internal mailbox setup check"/, "the send_log label is unchanged");
});

// ── Start-warmup safety ──────────────────────────────────────────────────────
test("startWarmup only touches senders that have never started, so it cannot reset a running timer", async () => {
  const source = await readFile(new URL("../lib/services/warmup.ts", import.meta.url), "utf8");
  const start = source.slice(source.indexOf("export async function startWarmup"), source.indexOf("export async function startHostingerWarmup"));

  assert.equal((start.match(/\.is\("warmup_started_at", null\)/g) || []).length, 2, "both the select and the update must require warmup_started_at IS NULL");
});

test("the Google Workspace warmup targets only hello@ and info@, never cam@ or the Hostinger senders", async () => {
  const source = await readFile(new URL("../lib/services/warmup.ts", import.meta.url), "utf8");
  const body = source.slice(source.indexOf("export async function startGoogleWorkspaceWarmup"), source.indexOf("export async function runWarmup"));

  assert.match(body, /hello@automate305\.com/);
  assert.match(body, /info@automate305\.com/);
  assert.doesNotMatch(body, /cam@|aestheticdevicepro/);
});

test("the cron never starts a warmup for either provider", async () => {
  const route = await readFile(new URL("../pages/api/cron/daily-warmup.js", import.meta.url), "utf8");

  assert.doesNotMatch(route, /startGoogleWorkspaceWarmup|startGoogleWarmup/);
});
