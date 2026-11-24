import assert from "node:assert/strict";
import test from "node:test";

import {
  campaignAutomationEnabled,
  campaignBlockedBySurbl,
  domainsForCampaign,
  surblSendBlock,
} from "../lib/services/campaign-launch.js";

test("aesthetic sending starts Monday and the listed domain stays behind the global flag", () => {
  const saturday = new Date("2026-11-21T15:00:00Z");
  const monday = new Date("2026-11-23T13:00:00Z");

  assert.equal(campaignAutomationEnabled("aesthetic", {}, saturday), false);
  assert.equal(campaignAutomationEnabled("hvac", {}, monday), false);
  assert.equal(campaignAutomationEnabled("aesthetic", {}, monday), true);
  assert.equal(
    campaignAutomationEnabled("hvac", { CAMPAIGN_AUTOMATION_ENABLED: "true" }, saturday),
    true,
  );
});

test("SURBL abuse blocks sending and an unknown Spamhaus answer does not", () => {
  assert.equal(
    surblSendBlock({
      lists: [{ list: "SURBL multi", outcome: "listed", reason: "ABUSE (spam/abuse)" }],
    }).blocked,
    true,
  );
  assert.equal(
    surblSendBlock({
      lists: [
        { list: "SURBL multi", outcome: "clean" },
        { list: "Spamhaus DBL", outcome: "unavailable" },
      ],
    }).blocked,
    false,
  );
  assert.equal(
    surblSendBlock({ lists: [{ list: "SURBL multi", outcome: "unavailable" }] }).blocked,
    false,
  );
  assert.equal(
    surblSendBlock({
      lists: [{ list: "SURBL multi", outcome: "unavailable", reason: "lookup did not complete (ETIMEOUT)" }],
    }).warning,
    "lookup did not complete (ETIMEOUT)",
  );
  assert.equal(
    surblSendBlock({ lists: [{ list: "SURBL multi", outcome: "error" }] }).blocked,
    false,
  );
});

test("an unavailable SURBL answer warns and does not block the campaign", async () => {
  const warnings = [];
  const originalWarn = console.warn;
  console.warn = (...args) => warnings.push(args.join(" "));

  try {
    const decision = await campaignBlockedBySurbl(
      "aesthetic",
      [{ campaign: "aesthetic", email: "matt@aestheticdevicepro.com" }],
      {
        evaluate: async () => ({
          lists: [{ list: "SURBL multi", outcome: "unavailable", reason: "lookup did not complete (ETIMEOUT)" }],
        }),
      },
    );

    assert.equal(decision.blocked, false);
    assert.match(warnings.join("\n"), /matt@|aestheticdevicepro\.com/);
    assert.match(warnings.join("\n"), /ETIMEOUT/);
  } finally {
    console.warn = originalWarn;
  }
});

test("a listed SURBL answer still blocks the campaign", async () => {
  const decision = await campaignBlockedBySurbl(
    "aesthetic",
    [{ campaign: "aesthetic", email: "matt@aestheticdevicepro.com" }],
    {
      evaluate: async () => ({
        lists: [{ list: "SURBL multi", outcome: "listed", reason: "ABUSE (spam/abuse)" }],
      }),
    },
  );

  assert.equal(decision.blocked, true);
  assert.match(decision.reason, /ABUSE/);
});

test("a campaign domain comes from its own senders", () => {
  const senders = [
    { campaign: "aesthetic", email: "matt@aestheticdevicepro.com" },
    { campaign: "aesthetic", email: "tamiko@aestheticdevicepro.com" },
    { campaign: "hvac", email: "cam@automate305.com" },
  ];

  assert.deepEqual(domainsForCampaign(senders, "aesthetic"), ["aestheticdevicepro.com"]);
  assert.deepEqual(domainsForCampaign(senders, "hvac"), ["automate305.com"]);
});
