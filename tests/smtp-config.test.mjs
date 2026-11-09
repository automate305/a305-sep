import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  createSmtpTransporter,
  getSmtpPasswordEnvironmentVariable,
  getSmtpTransportSettings,
  isUsableEnvironmentValue,
  resolveSmtpPassword,
  senderHasCapacity,
} from "../lib/services/smtp.js";
import { describeSenderState } from "../lib/services/sender-gate.js";

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
    describeSenderState(baseSender, { SMTP_PASS_CAM: "your-cam-hostinger-password" })
      .sendableStatically,
    false,
  );
  assert.equal(
    describeSenderState({ ...baseSender, warmed: false }, { SMTP_PASS_CAM: "real-app-password" })
      .sendableStatically,
    false,
  );
  assert.equal(
    describeSenderState(baseSender, { SMTP_PASS_CAM: "real-app-password" }).sendableStatically,
    true,
  );
});

test("runs no-send readiness before the Cowork daily send", async () => {
  const dailyTrigger = await readFile(
    new URL("../scripts/daily-trigger.js", import.meta.url),
    "utf8",
  );
  const sendRoute = await readFile(new URL("../pages/api/send.js", import.meta.url), "utf8");

  assert.ok(dailyTrigger.indexOf("await checkSendingReadiness()") < dailyTrigger.indexOf("await resetDailySends()"));
  assert.match(dailyTrigger, /\/api\/readiness/);
  // The send route no longer filters warmed in SQL: an unwarmed mailbox
  // has to reach the gate so the refusal can name it. The gate enforces
  // warmed — see sender-gate.test.mjs.
  assert.match(sendRoute, /createSenderGate\(\)/);
  assert.match(sendRoute, /gate\.selectSender\(/);
  assert.doesNotMatch(sendRoute, /\.limit\(1\)/);
});

// ── Alias login ──────────────────────────────────────────────────────────────
const aliasEnvironment = { SMTP_PASS_CAM: "app-password-for-cam-0000" };

test("an alias with no password of its own logs in as the primary account", () => {
  for (const alias of ["hello@automate305.com", "info@automate305.com"]) {
    const resolved = resolveSmtpPassword(alias, aliasEnvironment);
    assert.equal(resolved.user, "cam@automate305.com");
    assert.equal(resolved.variable, "SMTP_PASS_CAM");
    assert.equal(resolved.password, aliasEnvironment.SMTP_PASS_CAM);
  }
});

test("cam@ and a mailbox with its own password log in as themselves", () => {
  assert.equal(resolveSmtpPassword("cam@automate305.com", aliasEnvironment).user, "cam@automate305.com");
  const own = resolveSmtpPassword("hello@automate305.com", { ...aliasEnvironment, SMTP_PASS_HELLO: "its-own-password-0000" });
  assert.equal(own.user, "hello@automate305.com");
  assert.equal(own.variable, "SMTP_PASS_HELLO");
});

test("Hostinger senders never fall back to the Google login", () => {
  const resolved = resolveSmtpPassword("matt@aestheticdevicepro.com", aliasEnvironment);
  assert.equal(resolved.password, undefined);
  assert.equal(resolved.user, "matt@aestheticdevicepro.com");
});

test("the transporter logs in as the primary account while the sender keeps its own address", () => {
  const sender = { ...baseSender, email: "info@automate305.com", host: "smtp.gmail.com" };
  const transporter = createSmtpTransporter(sender, aliasEnvironment);
  try {
    assert.equal(transporter.options.auth.user, "cam@automate305.com");
    assert.equal(sender.email, "info@automate305.com");
  } finally {
    transporter.close();
  }
});

test("an alias with no usable credential anywhere is still refused", () => {
  assert.throws(
    () => createSmtpTransporter({ ...baseSender, email: "hello@automate305.com" }, {}),
    (error) => error.code === "SMTP_CREDENTIAL_MISSING",
  );
});
