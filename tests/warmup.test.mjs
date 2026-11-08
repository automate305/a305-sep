import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { activeWarmupDay } from "../lib/services/warmup.ts";

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

  assert.notEqual(day, 21, "calendar time passing must not, by itself, complete the ramp");
  assert.ok(day < 21, "a genuinely interrupted ramp must still show real days left");
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

test("caps at 21 once 21 distinct active days have genuinely happened", async () => {
  const twentyFiveDistinctDays = Array.from(
    { length: 25 },
    (_, index) => `2026-01-${String(index + 1).padStart(2, "0")}T12:00:00.000Z`,
  );
  const day = await activeWarmupDay(fakeSupabase(twentyFiveDistinctDays), "sender-1", new Date("2026-02-01T12:00:00.000Z"));

  assert.equal(day, 21);
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

  assert.match(route, /runHostingerWarmup/);
  assert.doesNotMatch(route, /startHostingerWarmup/);
});

test("vercel.json runs warmup every day, unlike the weekday-only campaign cron", async () => {
  const config = JSON.parse(await readFile(new URL("../vercel.json", import.meta.url), "utf8"));
  const warmupCron = config.crons.find((cron) => cron.path === "/api/cron/daily-warmup");

  assert.ok(warmupCron, "vercel.json must register the warmup cron");
  assert.equal(warmupCron.schedule, "0 13 * * *");
});
