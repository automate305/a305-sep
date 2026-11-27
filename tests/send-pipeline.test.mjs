import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { cronSelfOrigin } from "../pages/api/cron/daily-send.js";
import { effectiveDailyCap, rampCapForSendingDay, sendingDayFromHistory } from "../lib/services/send-ramp.js";
import { threadHeaders } from "../lib/services/send-thread.js";
import { senderHasCapacity } from "../lib/services/smtp.js";

test("the ramp is 10, then 15, then 25 sending days", () => {
  assert.equal(rampCapForSendingDay(1), 10);
  assert.equal(rampCapForSendingDay(5), 10);
  assert.equal(rampCapForSendingDay(6), 15);
  assert.equal(rampCapForSendingDay(10), 15);
  assert.equal(rampCapForSendingDay(11), 25);
});

test("the effective daily cap is the lower of the stored limit and the ramp", () => {
  assert.equal(effectiveDailyCap({ daily_limit: 25, ramp_cap: 10 }), 10);
  assert.equal(effectiveDailyCap({ daily_limit: 5, ramp_cap: 10 }), 5);
  assert.equal(senderHasCapacity({ daily_limit: 25, ramp_cap: 10, sends_today: 10 }), false);
  assert.equal(senderHasCapacity({ daily_limit: 25, ramp_cap: 10, sends_today: 9 }), true);
  assert.equal(senderHasCapacity({ daily_limit: 5, sends_today: 4 }), true);
});

test("ramp constants can be overridden from the environment", () => {
  const environment = {
    OUTBOX_RAMP_FIRST_CAP: "3",
    OUTBOX_RAMP_FIRST_DAYS: "2",
    OUTBOX_RAMP_LATER_CAP: "8",
    OUTBOX_RAMP_SECOND_CAP: "5",
    OUTBOX_RAMP_SECOND_DAYS: "2",
  };

  assert.equal(rampCapForSendingDay(1, environment), 3);
  assert.equal(rampCapForSendingDay(3, environment), 5);
  assert.equal(rampCapForSendingDay(5, environment), 8);
});

test("a mailbox with no warmed_at and no prospect sends stays on day 1", () => {
  assert.equal(sendingDayFromHistory({ now: new Date("2026-11-27T15:00:00Z") }), 1);
});

test("sending day counts distinct eastern dates on or after warmed_at, including today", () => {
  const day = sendingDayFromHistory({
    now: new Date("2026-11-27T15:00:00Z"),
    sentAtValues: [
      "2026-11-19T16:00:00Z",
      "2026-11-20T16:00:00Z",
      "2026-11-21T16:00:00Z",
      "2026-11-22T16:00:00Z",
      "2026-11-23T16:00:00Z",
      "2026-11-24T16:00:00Z",
    ],
    warmedAt: "2026-11-20T15:00:00Z",
  });

  assert.equal(day, 6);
});

test("the weekday cron calls its own deployment and ignores the request host", () => {
  assert.equal(
    cronSelfOrigin({ VERCEL_URL: "a305-sep.vercel.app", WEBHOOK_URL: "https://evil.example" }),
    "https://a305-sep.vercel.app",
  );
  assert.equal(
    cronSelfOrigin({ WEBHOOK_URL: "https://a305-sep.vercel.app/ignored" }),
    "https://a305-sep.vercel.app",
  );
  assert.equal(cronSelfOrigin({ WEBHOOK_URL: "http://a305-sep.vercel.app" }), null);
  assert.equal(cronSelfOrigin({ VERCEL_URL: "https://evil.example" }), null);
});

test("follow-ups thread to the step-1 message id", () => {
  assert.deepEqual(threadHeaders("<abc@mail.example>"), {
    "In-Reply-To": "<abc@mail.example>",
    References: "<abc@mail.example>",
  });
  assert.deepEqual(threadHeaders("abc@mail.example"), {
    "In-Reply-To": "<abc@mail.example>",
    References: "<abc@mail.example>",
  });
  assert.deepEqual(threadHeaders(""), {});
});

test("the send migration is additive and the manual path honors the campaign switch", async () => {
  const migration = await readFile(
    new URL("../supabase/migrations/20261127_outbox_send_pipeline.sql", import.meta.url),
    "utf8",
  );
  const sendRoute = await readFile(new URL("../pages/api/send.js", import.meta.url), "utf8");
  const reviewRoute = await readFile(new URL("../pages/api/review.js", import.meta.url), "utf8");

  assert.match(migration, /outbox_run_log/);
  assert.match(migration, /warmed_at/);
  assert.match(migration, /sends_today_on/);
  assert.match(migration, /message_id/);
  assert.match(migration, /America\/New_York/);
  assert.doesNotMatch(migration, /drop (table|view|column)/i);
  assert.match(sendRoute, /campaignAutomationEnabled/);
  assert.match(sendRoute, /campaignFromRequest/);
  assert.match(sendRoute, /senderPoolAtCapacity/);
  assert.match(reviewRoute, /approve-all-held/);
  assert.match(reviewRoute, /current_step', 1\)|\.eq\('current_step', 1\)/);
});
