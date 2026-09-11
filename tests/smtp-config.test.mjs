import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  getSmtpPasswordEnvironmentVariable,
  getSmtpTransportSettings,
  isUsableEnvironmentValue,
  senderHasCapacity,
  senderIsEligible,
} from "../lib/services/smtp.js";

const baseSender = {
  active: true,
  daily_limit: 5,
  email: "cam@automate305.com",
  host: "smtp.hostinger.com",
  port: 465,
  sends_today: 0,
  warmed: true,
};

test("routes confirmed domains through their actual email providers", () => {
  assert.deepEqual(getSmtpTransportSettings(baseSender), {
    host: "smtp.gmail.com",
    port: 465,
    provider: "google-workspace",
    secure: true,
  });

  assert.deepEqual(
    getSmtpTransportSettings({ ...baseSender, email: "matt@aestheticdevicepro.com" }),
    {
      host: "smtp.hostinger.com",
      port: 465,
      provider: "hostinger",
      secure: true,
    },
  );
});

test("derives the existing per-mailbox credential names", () => {
  assert.equal(getSmtpPasswordEnvironmentVariable("cam@automate305.com"), "SMTP_PASS_CAM");
  assert.equal(
    getSmtpPasswordEnvironmentVariable("matt@aestheticdevicepro.com"),
    "SMTP_PASS_MATT",
  );
});

test("rejects placeholders, cold mailboxes, and exhausted senders", () => {
  assert.equal(isUsableEnvironmentValue("your-cam-hostinger-password"), false);
  assert.equal(isUsableEnvironmentValue("real-app-password"), true);
  assert.equal(senderHasCapacity({ ...baseSender, daily_limit: 0 }), false);
  assert.equal(senderHasCapacity({ ...baseSender, sends_today: 5 }), false);
  assert.equal(
    senderIsEligible(baseSender, { SMTP_PASS_CAM: "your-cam-hostinger-password" }),
    false,
  );
  assert.equal(
    senderIsEligible({ ...baseSender, warmed: false }, { SMTP_PASS_CAM: "real-app-password" }),
    false,
  );
  assert.equal(senderIsEligible(baseSender, { SMTP_PASS_CAM: "real-app-password" }), true);
});

test("runs no-send readiness before the Cowork daily send", async () => {
  const dailyTrigger = await readFile(
    new URL("../scripts/daily-trigger.js", import.meta.url),
    "utf8",
  );
  const sendRoute = await readFile(new URL("../pages/api/send.js", import.meta.url), "utf8");

  assert.ok(dailyTrigger.indexOf("await checkSendingReadiness()") < dailyTrigger.indexOf("await resetDailySends()"));
  assert.match(dailyTrigger, /\/api\/readiness/);
  assert.match(sendRoute, /\.eq\('warmed', true\)/);
  assert.doesNotMatch(sendRoute, /\.limit\(1\)/);
});
