import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  buildHtmlEmail,
  findLinks,
  getTrackingConfig,
  prepareTracking,
  rewriteLinks,
} from "../lib/services/tracking.js";

const KEY = "0123456789abcdef0123456789abcdef";
const ORIGIN = "https://track.automate305.com";
const ENV = { TRACKER_API_KEY: KEY, TRACKER_DOMAINS: "automate305.com" };
const SILENT = { warn() {} };
const FOOTER = "\n\n---\nUnsubscribe here: https://outbox.automate305.com/api/unsubscribe?token=abc\nSent by Automate305";

function trackerReply(urls) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      links: urls.map((url, index) => ({ url, tracked_url: `${ORIGIN}/c/link${index}` })),
    }),
  };
}

// ── Config: off unless everything lines up ──────────────────────────────────
test("tracking is off without a usable key", () => {
  assert.equal(getTrackingConfig("cam@automate305.com", { TRACKER_DOMAINS: "automate305.com" }), null);
  assert.equal(
    getTrackingConfig("cam@automate305.com", { ...ENV, TRACKER_API_KEY: "your-tracker-api-key" }),
    null,
  );
});

test("tracking is off for a sender domain that is not listed", () => {
  assert.equal(getTrackingConfig("matt@aestheticdevicepro.com", ENV), null);
  assert.equal(getTrackingConfig("cam@automate305.com", { TRACKER_API_KEY: KEY }), null);
  assert.equal(getTrackingConfig("not-an-email", ENV), null);
});

test("a listed domain tracks through its own track. host, pixel off by default", () => {
  const config = getTrackingConfig("Cam@Automate305.com", ENV);
  assert.equal(config.origin, ORIGIN);
  assert.equal(config.pixel, false);
  assert.equal(getTrackingConfig("cam@automate305.com", { ...ENV, TRACKER_OPEN_PIXEL: "true" }).pixel, true);
});

// ── Link handling ───────────────────────────────────────────────────────────
test("links are found without trailing punctuation and deduplicated", () => {
  const text = "See https://example.com/a. Also (https://example.com/b), and https://example.com/a again.";
  assert.deepEqual(findLinks(text), ["https://example.com/a", "https://example.com/b"]);
});

test("rewriting keeps the punctuation that followed the link", () => {
  const tracked = new Map([["https://example.com/a", `${ORIGIN}/c/x1`]]);
  assert.equal(
    rewriteLinks("Read https://example.com/a. Thanks", tracked),
    `Read ${ORIGIN}/c/x1. Thanks`,
  );
});

// ── prepareTracking ─────────────────────────────────────────────────────────
test("no config means the message is returned untouched and the tracker is never called", async () => {
  let called = false;
  const result = await prepareTracking(
    { config: null, messageId: "m1", recipient: "a@b.co", campaign: "hvac", body: "hi https://example.com", footer: FOOTER },
    { fetchImpl: async () => { called = true; } },
  );
  assert.equal(called, false);
  assert.deepEqual(result, { body: "hi https://example.com", html: null, tracked: false });
});

test("body links are registered and rewritten; the footer is never sent for tracking", async () => {
  let request;
  const result = await prepareTracking(
    {
      config: getTrackingConfig("cam@automate305.com", ENV),
      messageId: "m1",
      recipient: "owner@hvac.example",
      campaign: "hvac",
      body: "Quick look: https://example.com/demo.",
      footer: FOOTER,
    },
    {
      log: SILENT,
      fetchImpl: async (url, init) => {
        request = { url, init, payload: JSON.parse(init.body) };
        return trackerReply(request.payload.urls);
      },
    },
  );

  assert.equal(request.url, `${ORIGIN}/api/links`);
  assert.equal(request.init.headers["x-api-key"], KEY);
  assert.deepEqual(request.payload.urls, ["https://example.com/demo"]);
  assert.equal(request.payload.message_id, "m1");
  assert.equal(result.body, `Quick look: ${ORIGIN}/c/link0.`);
  assert.equal(result.html, null);
  assert.equal(result.tracked, true);
  assert.ok(!JSON.stringify(request.payload).includes("unsubscribe"));
});

test("with the pixel on, the HTML alternative carries the pixel and the untouched unsubscribe link", async () => {
  const result = await prepareTracking(
    {
      config: getTrackingConfig("cam@automate305.com", { ...ENV, TRACKER_OPEN_PIXEL: "true" }),
      messageId: "11111111-2222-3333-4444-555555555555",
      recipient: "owner@hvac.example",
      campaign: "hvac",
      body: "No links here <b>&</b> done.",
      footer: FOOTER,
    },
    { log: SILENT, fetchImpl: async () => assert.fail("no links, so no registration call") },
  );

  assert.equal(result.tracked, true);
  assert.equal(result.body, "No links here <b>&</b> done.");
  assert.ok(result.html.includes(`<img src="${ORIGIN}/o/11111111-2222-3333-4444-555555555555.gif"`));
  assert.ok(result.html.includes("No links here &lt;b&gt;&amp;&lt;/b&gt; done."), "text is HTML-escaped");
  assert.ok(result.html.includes('<a href="https://outbox.automate305.com/api/unsubscribe?token=abc">'));
});

test("every failure sends the message untracked", async () => {
  const config = getTrackingConfig("cam@automate305.com", { ...ENV, TRACKER_OPEN_PIXEL: "true" });
  const args = { config, messageId: "m1", recipient: "a@b.co", campaign: "hvac", body: "go https://example.com/x", footer: FOOTER };
  const expected = { body: args.body, html: null, tracked: false };

  const failures = {
    "network error": async () => { throw new Error("boom"); },
    "timeout": async () => { throw Object.assign(new Error("slow"), { name: "TimeoutError" }); },
    "bad key": async () => ({ ok: false, status: 401, json: async () => ({}) }),
    "garbage reply": async () => ({ ok: true, status: 200, json: async () => ({ nope: true }) }),
    "tracked link on a foreign host": async () => ({
      ok: true,
      status: 200,
      json: async () => ({ links: [{ url: "https://example.com/x", tracked_url: "https://evil.example/c/1" }] }),
    }),
    "reply missing a link": async () => ({ ok: true, status: 200, json: async () => ({ links: [] }) }),
  };

  for (const [name, fetchImpl] of Object.entries(failures)) {
    assert.deepEqual(await prepareTracking(args, { fetchImpl, log: SILENT }), expected, name);
  }
});

test("a body with too many links is not tracked", async () => {
  const body = Array.from({ length: 25 }, (_, i) => `https://example.com/${i}`).join(" ");
  const result = await prepareTracking(
    { config: getTrackingConfig("cam@automate305.com", ENV), messageId: "m1", recipient: "a@b.co", campaign: "hvac", body, footer: FOOTER },
    { log: SILENT, fetchImpl: async () => assert.fail("must not call the tracker") },
  );
  assert.equal(result.tracked, false);
});

test("a long run of punctuation after a link is handled in linear time", () => {
  const text = `see https://example.com/${"!".repeat(200000)}x`;
  const started = performance.now();
  const links = findLinks(text);
  const rewritten = rewriteLinks(text, new Map());
  assert.ok(performance.now() - started < 1000, "must not backtrack quadratically");
  assert.equal(links.length, 1);
  assert.equal(rewritten, text);

  const trailing = `https://example.com/a${"!".repeat(200000)}`;
  assert.deepEqual(findLinks(trailing), ["https://example.com/a"]);
});

test("the HTML builder escapes quotes in text and links", () => {
  const html = buildHtmlEmail('say "hi" https://example.com/?a=1&b=2', `${ORIGIN}/o/x.gif`);
  assert.ok(html.includes("say &quot;hi&quot;"));
  assert.ok(html.includes('<a href="https://example.com/?a=1&amp;b=2">'));
});

// ── Wiring in the send route ────────────────────────────────────────────────
test("the send route tracks after the postal-address hold and before sendMail", async () => {
  const source = await readFile(new URL("../pages/api/send.js", import.meta.url), "utf8");
  const holdAt = source.indexOf("No sender postal address configured for this brand");
  const trackAt = source.indexOf("await prepareTracking(");
  const sendAt = source.indexOf("transporter.sendMail");

  assert.ok(holdAt !== -1 && trackAt > holdAt && sendAt > trackAt, "tracking sits between the hold and sendMail");
  assert.match(source, /getTrackingConfig\(sender\.email\)/);
  assert.match(source, /text:\s+body \+ footer/);
  assert.match(source, /\.\.\.\(tracking\.html \? \{ html: tracking\.html \} : \{\}\)/);
});

test("the message id is the send_log id, and warmup mail is never tracked", async () => {
  const source = await readFile(new URL("../pages/api/send.js", import.meta.url), "utf8");
  assert.match(source, /const messageId = randomUUID\(\)/);
  assert.match(source, /insert\(\{\s+id:\s+messageId,/);

  const warmup = await readFile(new URL("../lib/services/warmup.ts", import.meta.url), "utf8");
  assert.doesNotMatch(warmup, /tracking/i);
});
