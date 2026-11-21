import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { blockingSuppression, suppressionBlocks } from "../lib/services/send-block.js";
import { imapHostForSmtpHost, isProspectReply } from "../lib/services/reply-match.js";
import { mailboxesForSenders, syncProspectReplies } from "../lib/services/reply-sync.js";
import { isPermanentRecipientFailure } from "../lib/services/smtp-failure.js";
import { stopContactForReply } from "../lib/services/stop-contact.js";

test("a recipient 550 is permanent and an authentication 535 is not", () => {
  assert.equal(isPermanentRecipientFailure({ responseCode: 550, message: "mailbox unavailable" }), true);
  assert.equal(isPermanentRecipientFailure({ responseCode: 535, message: "authentication failed" }), false);
  assert.equal(isPermanentRecipientFailure({ responseCode: 451, message: "try again" }), false);
  assert.equal(isPermanentRecipientFailure({ message: "connection reset" }), false);
  assert.equal(
    isPermanentRecipientFailure({ responseCode: 550, message: "relay access denied" }),
    false,
  );
});

test("own mailboxes, seeds, and bounce daemons are not prospect replies", () => {
  const seeds = new Set(["seed-one@example.com"]);

  assert.equal(isProspectReply("pat@example.com", { seeds }), true);
  assert.equal(isProspectReply("Cam@automate305.com", { seeds }), false);
  assert.equal(isProspectReply("tamiko@aestheticdevicepro.com", { seeds }), false);
  assert.equal(isProspectReply("seed-one@example.com", { seeds }), false);
  assert.equal(isProspectReply("MAILER-DAEMON@hostinger.com", { seeds }), false);
  assert.equal(imapHostForSmtpHost("smtp.gmail.com"), "imap.gmail.com");
  assert.equal(imapHostForSmtpHost("smtp.hostinger.com"), "imap.hostinger.com");
  assert.equal(imapHostForSmtpHost("smtp.example.com"), null);
});

test("aliases that share a login are polled once and a missing password is skipped", () => {
  const environment = { SMTP_PASS_CAM: "cam-app-password" };
  const mailboxes = mailboxesForSenders([
    { email: "cam@automate305.com", host: "smtp.gmail.com" },
    { email: "hello@automate305.com", host: "smtp.gmail.com" },
    { email: "matt@aestheticdevicepro.com", host: "smtp.hostinger.com" },
  ], environment);

  assert.deepEqual(mailboxes.map((mailbox) => mailbox.user), ["cam@automate305.com"]);
  assert.equal(mailboxes[0].host, "imap.gmail.com");
});

test("a reply suppression blocks another enrollment and a campaign block does not cross brands", () => {
  const rows = [
    { campaign: null, match_type: "email", scope: "global", source: "reply", value: "pat@example.com" },
    { campaign: "hvac", match_type: "domain", scope: "campaign", source: "manual", value: "blocked.test" },
  ];

  assert.deepEqual(blockingSuppression(rows, "Pat@Example.com", "aesthetic"), {
    reason: "Suppressed address",
    status: "replied",
  });
  assert.equal(suppressionBlocks(rows, "owner@blocked.test", "hvac"), true);
  assert.equal(suppressionBlocks(rows, "owner@blocked.test", "aesthetic"), false);
});

test("stopping a reply relabels held steps and does not clear an opt-out flag", async () => {
  const updates = [];
  const supabase = {
    from(table) {
      const builder = {
        eq() { return builder; },
        in() { return builder; },
        maybeSingle() {
          return Promise.resolve({ data: { id: "contact-1" }, error: null });
        },
        select() { return builder; },
        update(payload) {
          updates.push({ payload, table });
          return builder;
        },
        then(resolve, reject) {
          const rows = table === "enrollments" ? [{ id: "held-1" }, { id: "active-1" }] : [];
          return Promise.resolve({ data: rows, error: null }).then(resolve, reject);
        },
      };
      return builder;
    },
    rpc(name, args) {
      updates.push({ args, name });
      return Promise.resolve({ data: { contact_found: true, contact_id: "contact-1" }, error: null });
    },
  };

  const result = await stopContactForReply(supabase, "Pat@Example.com");

  assert.equal(result.enrollments_stood_down, 2);
  assert.equal(updates[0].name, "suppress_contact");
  assert.equal(updates[0].args.suppression_source, "reply");
  assert.equal(updates[1].table, "enrollments");
  assert.equal(updates[1].payload.status, "replied");
  assert.equal(Object.hasOwn(updates[1].payload, "unsubscribed"), false);
});

test("an inbox reply from a known contact stops that contact and ignores seeds", async () => {
  const stopped = [];
  const supabase = {
    from(table) {
      const builder = {
        in(_column, values) {
          assert.deepEqual(values, ["pat@example.com"]);
          return Promise.resolve({ data: [{ email: "pat@example.com" }], error: null });
        },
        select() { return builder; },
        then(resolve, reject) {
          const data = table === "senders"
            ? [{ email: "cam@automate305.com", host: "smtp.gmail.com" }]
            : [];
          return Promise.resolve({ data, error: null }).then(resolve, reject);
        },
      };
      return builder;
    },
  };
  const result = await syncProspectReplies(supabase, {
    environment: {
      SMTP_PASS_CAM: "cam-app-password",
      WARMUP_SEED_RECIPIENTS: "seed@example.com",
    },
    listMessages: async () => [
      { from: "Pat@Example.com" },
      { from: "seed@example.com" },
      { from: "cam@automate305.com" },
    ],
    stopReply: async (_supabase, email) => {
      stopped.push(email);
      return { contact_found: true };
    },
  });

  assert.deepEqual(stopped, ["pat@example.com"]);
  assert.equal(result.mailboxes, 1);
  assert.equal(result.matched, 1);
  assert.equal(result.stopped, 1);
  assert.equal(JSON.stringify(result).includes("cam-app-password"), false);
});

test("the reply cron is protected and the weekday send checks inboxes before mail", async () => {
  process.env.CRON_SECRET = "test-cron-secret";
  const { default: replies } = await import("../pages/api/cron/daily-replies.js");
  const response = {
    body: null,
    headers: new Map(),
    json(payload) { this.body = payload; return this; },
    setHeader(name, value) { this.headers.set(name, value); },
    status(statusCode) { this.statusCode = statusCode; return this; },
    statusCode: 200,
  };

  await replies({ headers: {}, method: "GET" }, response);
  assert.equal(response.statusCode, 401);

  const sendCron = await readFile(new URL("../pages/api/cron/daily-send.js", import.meta.url), "utf8");
  const migration = await readFile(
    new URL("../supabase/migrations/20261121_reply_stops_inflight.sql", import.meta.url),
    "utf8",
  );

  assert.ok(sendCron.indexOf("syncProspectReplies") < sendCron.indexOf("todays_queue"));
  assert.match(migration, /e\.status in \('active', 'held', 'paused'\)/);
  assert.match(migration, /when 'reply' then 'replied'/);
  assert.match(migration, /terminal_status <> 'replied'/);
  assert.doesNotMatch(migration, /drop (table|view|column)/i);
});
