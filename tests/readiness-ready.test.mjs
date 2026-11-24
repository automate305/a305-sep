import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { campaignIsReady } from "../pages/api/readiness.js";
import { createSenderGate } from "../lib/services/sender-gate.js";

const warmed = { permitted: true, warmed: true };
const warming = { permitted: false, warmed: false };

test("one permitted warmed sender makes the campaign ready", () => {
  assert.equal(campaignIsReady([warming, warmed]), true);
});

test("unwarmed mailboxes alone do not make a campaign ready", () => {
  assert.equal(campaignIsReady([warming, { permitted: true, warmed: false }]), false);
  assert.equal(campaignIsReady([]), false);
  assert.equal(campaignIsReady(null), false);
});

test("readiness no longer requires every active mailbox", async () => {
  const source = await readFile(new URL("../pages/api/readiness.js", import.meta.url), "utf8");

  assert.match(source, /campaignIsReady\(senderResults\)/);
  assert.doesNotMatch(source, /\.every\(/);
});

test("the sender gate still refuses an unwarmed mailbox for cold mail", async () => {
  const verifySender = async () => {
    throw new Error("SMTP must not be attempted");
  };
  const gate = createSenderGate({
    environment: { SMTP_PASS_HELLO: "real-google-app-password" },
    verifySender,
  });

  await assert.rejects(
    () => gate.selectSender([{
      active: true,
      campaign: "hvac",
      daily_limit: 4,
      email: "hello@automate305.com",
      sends_today: 4,
      warmed: false,
    }], "hvac"),
    /hello@automate305\.com is not warmed/,
  );
});
