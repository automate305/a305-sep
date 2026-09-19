import assert from "node:assert/strict";
import test from "node:test";

import {
  NO_ELIGIBLE_SENDER,
  SENDER_BLOCK_CODES,
  createSenderGate,
  describeSenderState,
} from "../lib/services/sender-gate.js";

const CREDENTIALS = {
  SMTP_PASS_CAM: "real-google-app-password",
  SMTP_PASS_MATT: "real-hostinger-password",
  SMTP_PASS_SALES: "real-google-app-password",
  SMTP_PASS_TAMIKO: "real-hostinger-password",
};

const cam = {
  active: true,
  campaign: "hvac",
  daily_limit: 20,
  email: "cam@automate305.com",
  sends_today: 3,
  warmed: true,
};

const matt = {
  active: true,
  campaign: "aesthetic",
  daily_limit: 2,
  email: "matt@aestheticdevicepro.com",
  sends_today: 0,
  warmed: false,
};

const tamiko = {
  active: true,
  campaign: "aesthetic",
  daily_limit: 2,
  email: "tamiko@aestheticdevicepro.com",
  sends_today: 0,
  warmed: false,
};

// Stands in for the SMTP handshake so the suite never dials a mailbox.
function recordingVerifier({ failFor = [] } = {}) {
  const attempted = [];

  async function verify(sender) {
    attempted.push(sender.email);
    if (failFor.includes(sender.email)) {
      const authError = new Error("Invalid login");
      authError.code = "EAUTH";
      throw authError;
    }
  }

  verify.attempted = attempted;
  return verify;
}

test("refuses an aesthetic send and names the unwarmed mailboxes", async () => {
  const gate = createSenderGate({
    environment: CREDENTIALS,
    verifySender: recordingVerifier(),
  });

  // Capture the error itself to assert on the operator-facing message.
  let thrown = null;
  try {
    await gate.selectSender([matt, tamiko], "aesthetic");
  } catch (error) {
    thrown = error;
  }

  assert.ok(thrown, "an aesthetic send must be refused while the mailboxes are warming");
  assert.equal(thrown.code, NO_ELIGIBLE_SENDER);
  assert.match(thrown.message, /matt@aestheticdevicepro\.com is not warmed/);
  assert.match(thrown.message, /tamiko@aestheticdevicepro\.com is not warmed/);
  assert.equal(thrown.campaign, "aesthetic");
  assert.deepEqual(
    thrown.blockedSenders.map((blocked) => blocked.blockedBy[0].code),
    [SENDER_BLOCK_CODES.NOT_WARMED, SENDER_BLOCK_CODES.NOT_WARMED],
  );
});

test("never opens an SMTP connection to a mailbox that is still warming", async () => {
  const verifySender = recordingVerifier();
  const gate = createSenderGate({ environment: CREDENTIALS, verifySender });

  await assert.rejects(() => gate.selectSender([matt, tamiko], "aesthetic"));

  assert.deepEqual(verifySender.attempted, []);
});

test("still selects cam@automate305.com for hvac", async () => {
  const gate = createSenderGate({
    environment: CREDENTIALS,
    verifySender: recordingVerifier(),
  });

  const selected = await gate.selectSender([cam], "hvac");

  assert.equal(selected.email, "cam@automate305.com");
});

test("prefers the least-used mailbox and verifies each one only once", async () => {
  const verifySender = recordingVerifier();
  const gate = createSenderGate({ environment: CREDENTIALS, verifySender });
  const busyCam = { ...cam, email: "cam@automate305.com", sends_today: 9 };
  const freshCam = { ...cam, email: "sales@automate305.com", sends_today: 1 };

  assert.equal((await gate.selectSender([busyCam, freshCam], "hvac")).email, "sales@automate305.com");
  assert.equal((await gate.selectSender([busyCam, freshCam], "hvac")).email, "sales@automate305.com");

  assert.deepEqual(verifySender.attempted, ["sales@automate305.com"]);
});

test("refuses a warmed mailbox whose SMTP login fails, naming the failure", async () => {
  const gate = createSenderGate({
    environment: CREDENTIALS,
    verifySender: recordingVerifier({ failFor: ["cam@automate305.com"] }),
  });

  let thrown = null;
  try {
    await gate.selectSender([cam], "hvac");
  } catch (error) {
    thrown = error;
  }

  assert.ok(thrown, "a mailbox that cannot authenticate must not send");
  assert.match(thrown.message, /cam@automate305\.com: SMTP authentication failed/);
});

test("refuses a mailbox with a placeholder credential, naming the variable", async () => {
  const gate = createSenderGate({
    environment: { SMTP_PASS_CAM: "your-cam-hostinger-password" },
    verifySender: recordingVerifier(),
  });

  let thrown = null;
  try {
    await gate.selectSender([cam], "hvac");
  } catch (error) {
    thrown = error;
  }

  assert.ok(thrown, "a mailbox without a usable credential must not send");
  assert.match(thrown.message, /has no usable SMTP_PASS_CAM/);
});

test("refuses an inactive mailbox and one that is out of daily budget", async () => {
  const gate = createSenderGate({
    environment: CREDENTIALS,
    verifySender: recordingVerifier(),
  });

  await assert.rejects(
    () => gate.selectSender([{ ...cam, active: false }], "hvac"),
    (error) => {
      assert.match(error.message, /cam@automate305\.com is not active/);
      return true;
    },
  );

  await assert.rejects(
    () => gate.selectSender([{ ...cam, sends_today: 20 }], "hvac"),
    (error) => {
      assert.match(error.message, /has reached its daily limit \(20\/20\)/);
      return true;
    },
  );
});

test("separates permission from today's budget so readiness survives a full counter", async () => {
  const gate = createSenderGate({
    environment: CREDENTIALS,
    verifySender: recordingVerifier(),
  });

  // The cron checks readiness BEFORE reset_daily_sends, so a mailbox
  // sitting at yesterday's limit must still read as permitted.
  const spentCam = { ...cam, sends_today: 20 };
  const verdict = await gate.inspectSender(spentCam);

  assert.equal(verdict.permitted, true, "a spent-but-warmed mailbox stays ready");
  assert.equal(verdict.sendable, false, "but it cannot send until the counter resets");
  assert.deepEqual(verdict.permittedBlockedBy, []);
});

test("reports every reason at once rather than the first", () => {
  const state = describeSenderState(
    { ...matt, active: false, sends_today: 2 },
    { SMTP_PASS_MATT: "your-matt-password-here" },
  );

  assert.deepEqual(state.blockedBy.map((reason) => reason.code), [
    SENDER_BLOCK_CODES.INACTIVE,
    SENDER_BLOCK_CODES.NOT_WARMED,
    SENDER_BLOCK_CODES.CREDENTIAL_MISSING,
    SENDER_BLOCK_CODES.DAILY_LIMIT_REACHED,
  ]);
});

test("refuses when a campaign has no senders at all", async () => {
  const gate = createSenderGate({
    environment: CREDENTIALS,
    verifySender: recordingVerifier(),
  });

  await assert.rejects(
    () => gate.selectSender([], "aesthetic"),
    (error) => {
      assert.equal(error.code, NO_ELIGIBLE_SENDER);
      assert.match(error.message, /No sender is configured for campaign "aesthetic"/);
      return true;
    },
  );
});
