import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  SPF_LOOKUP_LIMIT,
  checkDomainAuthentication,
  domainAuthenticates,
  evaluateBlocklist,
  evaluateDkim,
  evaluateDmarc,
  evaluateSpf,
  inspectDkimRecord,
  sendingDomainsFromSenders,
} from "../lib/services/domain-auth.js";

// ── A resolver that answers from a table ─────────────────────────────────────
// Fixtures below are the records these domains actually published when this
// suite was written (captured 24 Sep 2026). No test here touches the network.
function dnsError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function fakeResolver({ a = {}, mx = {}, txt = {} }) {
  const queried = [];
  const answer = (table, hostname) => {
    queried.push(hostname);
    const value = table[hostname];
    if (value === undefined) return Promise.reject(dnsError("ENOTFOUND"));
    if (value instanceof Error) return Promise.reject(value);
    return Promise.resolve(value);
  };

  return {
    queried,
    resolve4: (hostname) => answer(a, hostname),
    resolveMx: (hostname) => answer(mx, hostname),
    resolveTxt: (hostname) => answer(txt, hostname),
  };
}

const FIXED_TIME = new Date("2026-09-24T18:59:28.000Z");
const now = () => FIXED_TIME;

const BLOCKLIST_TEST_POINTS = {
  "dbltest.com.dbl.spamhaus.org": ["127.0.1.2"],
  "test.surbl.org.multi.surbl.org": ["127.0.0.254"],
};

const A305_TXT = {
  "_dmarc.automate305.com": [["v=DMARC1; p=quarantine; adkim=r; aspf=r; rua=mailto:dmarc_rua@onsecureserver.net;"]],
  // Google has flattened this to raw ranges: no further includes.
  "_spf.google.com": [["v=spf1 ip4:74.125.0.0/16 ip4:209.85.128.0/17 ip6:2001:4860:4864::/56 ~all"]],
  "automate305.com": [
    ["google-site-verification=BAs6_DQ0RzAmKrJKUYRCLyms88zLiMnLs9vlkTUEy14"],
    ["v=spf1 include:dc-aa8e722993._spfm.automate305.com ~all"],
  ],
  "dc-aa8e722993._spfm.automate305.com": [["v=spf1 include:_spf.google.com ~all"]],
  // A long key arrives split across several strings, as real resolvers return it.
  "google._domainkey.automate305.com": [["v=DKIM1;k=rsa;p=MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAxqt", "OllDSJok49s+ZfxKARAv7RRwKS/OxD7oeu89bp/0AuPzsBRZwt7D1s0452MZDkWNd8n4RiRd1Fi5QKbXv5lCACLBAzDEGk"]],
};

const AESTHETIC_TXT = {
  "_dmarc.aestheticdevicepro.com": [["v=DMARC1; p=none"]],
  "aestheticdevicepro.com": [["v=spf1 include:_spf.mail.hostinger.com include:_spf.reach.hostinger.com ~all"]],
  "hostingermail-a._domainkey.aestheticdevicepro.com": dnsError("ETIMEOUT"),
  "hostingermail-b._domainkey.aestheticdevicepro.com": [["v=DKIM1;p="]],
  "hostingermail-c._domainkey.aestheticdevicepro.com": [["v=DKIM1;p="]],
};

// ── SPF ──────────────────────────────────────────────────────────────────────
test("follows automate305's _spfm indirection to Google rather than failing it", async () => {
  const spf = await evaluateSpf(
    "automate305.com",
    { provider: "google-workspace", spfIncludes: ["_spf.google.com"] },
    { now, resolver: fakeResolver({ txt: A305_TXT }) },
  );

  assert.equal(spf.status, "pass", "a correct record one include deep must not read as a failure");
  assert.match(spf.detail, /Authorises google-workspace/);
  assert.equal(spf.lookupCount, 2);
  assert.deepEqual(spf.queried, [
    "automate305.com",
    "dc-aa8e722993._spfm.automate305.com",
    "_spf.google.com",
  ]);
});

test("fetches the root SPF record once, not twice", async () => {
  const resolver = fakeResolver({ txt: A305_TXT });
  await evaluateSpf("automate305.com", { spfIncludes: ["_spf.google.com"] }, { now, resolver });

  assert.equal(resolver.queried.filter((hostname) => hostname === "automate305.com").length, 1);
});

test("reports the lookup count and fails above the limit of ten", async () => {
  const includes = Array.from({ length: 11 }, (_, index) => `include:spf${index}.example.net`).join(" ");
  const txt = { "example.com": [[`v=spf1 ${includes} ~all`]] };
  for (let index = 0; index < 11; index += 1) txt[`spf${index}.example.net`] = [["v=spf1 ~all"]];

  const spf = await evaluateSpf("example.com", { spfIncludes: ["spf0.example.net"] }, { now, resolver: fakeResolver({ txt }) });

  assert.equal(spf.lookupCount, 11);
  assert.equal(spf.status, "fail");
  assert.match(spf.warnings[0], new RegExp(`needs 11 DNS lookups; the limit is ${SPF_LOOKUP_LIMIT}`));
});

test("counts exactly ten as within the limit", async () => {
  const includes = Array.from({ length: 10 }, (_, index) => `include:spf${index}.example.net`).join(" ");
  const txt = { "example.com": [[`v=spf1 ${includes} ~all`]] };
  for (let index = 0; index < 10; index += 1) txt[`spf${index}.example.net`] = [["v=spf1 ~all"]];

  const spf = await evaluateSpf("example.com", { spfIncludes: ["spf0.example.net"] }, { now, resolver: fakeResolver({ txt }) });

  assert.equal(spf.lookupCount, 10);
  assert.equal(spf.status, "pass");
  assert.deepEqual(spf.warnings, []);
});

test("an include loop terminates instead of recursing forever", async () => {
  const txt = {
    "a.example.com": [["v=spf1 include:b.example.com ~all"]],
    "b.example.com": [["v=spf1 include:a.example.com ~all"]],
    "example.com": [["v=spf1 include:a.example.com ~all"]],
  };

  const spf = await evaluateSpf("example.com", { spfIncludes: ["_spf.google.com"] }, { now, resolver: fakeResolver({ txt }) });

  assert.equal(spf.status, "fail");
});

test("an unfollowable include makes the count a floor, and says so", async () => {
  const txt = {
    "example.com": [["v=spf1 include:_spf.google.com include:gone.example.net ~all"]],
    "_spf.google.com": [["v=spf1 ip4:74.125.0.0/16 ~all"]],
    "gone.example.net": dnsError("ETIMEOUT"),
  };
  const spf = await evaluateSpf("example.com", { spfIncludes: ["_spf.google.com"] }, { now, resolver: fakeResolver({ txt }) });

  assert.equal(spf.status, "pass", "the provider is authorised; the gap is reported, not hidden");
  assert.match(spf.warnings.join(" "), /lookup count is at least 2, not exactly 2/);
});

test("two SPF records at the root is a permanent error", async () => {
  const txt = { "example.com": [["v=spf1 include:_spf.google.com ~all"], ["v=spf1 -all"]] };
  const spf = await evaluateSpf("example.com", { spfIncludes: ["_spf.google.com"] }, { now, resolver: fakeResolver({ txt }) });

  assert.equal(spf.status, "fail");
  assert.match(spf.detail, /2 SPF records/);
});

test("warns on +all, which authorises every server on the internet", async () => {
  const txt = { "example.com": [["v=spf1 include:_spf.google.com +all"]], "_spf.google.com": [["v=spf1 ~all"]] };
  const spf = await evaluateSpf("example.com", { spfIncludes: ["_spf.google.com"] }, { now, resolver: fakeResolver({ txt }) });

  assert.match(spf.warnings.join(" "), /authorises every server/);
});

test("an SPF lookup that times out is unknown, never a pass", async () => {
  const spf = await evaluateSpf(
    "example.com",
    { spfIncludes: ["_spf.google.com"] },
    { now, resolver: fakeResolver({ txt: { "example.com": dnsError("ETIMEOUT") } }) },
  );

  assert.equal(spf.status, "unknown");
  assert.match(spf.detail, /did not complete \(ETIMEOUT\)/);
});

// ── DKIM ─────────────────────────────────────────────────────────────────────
test("a revoked key (empty p=) fails, where a presence check would pass it", () => {
  assert.deepEqual(inspectDkimRecord("v=DKIM1;p="), { reason: "public key is empty (revoked)", usable: false });
  assert.equal(inspectDkimRecord("v=DKIM1;k=rsa;p=MIIBIjANBgkq").usable, true);
  assert.equal(inspectDkimRecord("v=DKIM1;k=rsa").usable, false);
});

test("reports aestheticdevicepro.com as failing, naming the records found", async () => {
  const dkim = await evaluateDkim(
    "aestheticdevicepro.com",
    { dkimSelectors: ["hostingermail-a", "hostingermail-b", "hostingermail-c"] },
    { now, resolver: fakeResolver({ txt: AESTHETIC_TXT }) },
  );

  assert.equal(dkim.status, "fail");
  assert.match(dkim.detail, /Record found at hostingermail-b\._domainkey\.aestheticdevicepro\.com/);
  assert.match(dkim.detail, /public key is empty \(revoked\)/);
  assert.match(dkim.detail, /hostingermail-a\._domainkey\.aestheticdevicepro\.com did not answer/);
});

test("a wrong selector fails and names the exact hostname it queried", async () => {
  const dkim = await evaluateDkim(
    "automate305.com",
    {},
    { now, resolver: fakeResolver({ txt: A305_TXT }), selectors: ["selector1"] },
  );

  assert.equal(dkim.status, "fail");
  assert.equal(dkim.detail, "No DKIM record at selector1._domainkey.automate305.com");
  assert.deepEqual(dkim.queried, ["selector1._domainkey.automate305.com"]);
  assert.match(dkim.observed[0], /no record \(ENOTFOUND\)/);
});

test("a wrong selector does not borrow a pass from the right one", async () => {
  // automate305 has a perfectly good key at "google". Asking about a
  // different selector must still fail: the status reflects this lookup.
  const right = await evaluateDkim("automate305.com", {}, { now, resolver: fakeResolver({ txt: A305_TXT }), selectors: ["google"] });
  const wrong = await evaluateDkim("automate305.com", {}, { now, resolver: fakeResolver({ txt: A305_TXT }), selectors: ["google2"] });

  assert.equal(right.status, "pass");
  assert.equal(wrong.status, "fail");
});

test("joins a key split across strings before judging it", async () => {
  const dkim = await evaluateDkim(
    "automate305.com",
    { dkimSelectors: ["google"] },
    { now, resolver: fakeResolver({ txt: A305_TXT }) },
  );

  assert.equal(dkim.status, "pass");
  assert.match(dkim.detail, /selector "google"/);
});

test("a DKIM lookup that only times out is unknown, not fail and not pass", async () => {
  const dkim = await evaluateDkim(
    "example.com",
    { dkimSelectors: ["s1"] },
    { now, resolver: fakeResolver({ txt: { "s1._domainkey.example.com": dnsError("ESERVFAIL") } }) },
  );

  assert.equal(dkim.status, "unknown");
});

// ── DMARC ────────────────────────────────────────────────────────────────────
test("p=none passes as a record but warns that it enforces nothing", async () => {
  const dmarc = await evaluateDmarc("aestheticdevicepro.com", null, { now, resolver: fakeResolver({ txt: AESTHETIC_TXT }) });

  assert.equal(dmarc.status, "pass");
  assert.equal(dmarc.policy, "none");
  assert.match(dmarc.warnings[0], /monitoring only/);
});

test("DMARC without a policy tag fails", async () => {
  const dmarc = await evaluateDmarc(
    "example.com",
    null,
    { now, resolver: fakeResolver({ txt: { "_dmarc.example.com": [["v=DMARC1; rua=mailto:x@example.com"]] } }) },
  );

  assert.equal(dmarc.status, "fail");
});

// ── BLOCKLISTS ───────────────────────────────────────────────────────────────
test("reports automate305.com's SURBL listing, decoded from the bitmask", async () => {
  const blocklist = await evaluateBlocklist("automate305.com", null, {
    now,
    resolver: fakeResolver({ a: { ...BLOCKLIST_TEST_POINTS, "automate305.com.multi.surbl.org": ["127.0.0.64"] } }),
  });

  assert.equal(blocklist.status, "fail");
  assert.match(blocklist.detail, /SURBL multi \(ABUSE \(spam\/abuse\)\)/);
});

test("a list that will not report its own test entry is unknown, never clean", async () => {
  // This is Spamhaus refusing a public resolver: every query, including the
  // always-listed test entry, comes back as "not listed".
  const blocklist = await evaluateBlocklist("example.com", null, {
    now,
    resolver: fakeResolver({ a: { "test.surbl.org.multi.surbl.org": ["127.0.0.254"] } }),
  });

  assert.equal(blocklist.status, "unknown");
  assert.match(blocklist.detail, /Not listed on SURBL multi; could not check Spamhaus DBL/);
});

test("Spamhaus error replies are refusals, not listings", async () => {
  const blocklist = await evaluateBlocklist("example.com", null, {
    now,
    resolver: fakeResolver({
      a: { ...BLOCKLIST_TEST_POINTS, "example.com.dbl.spamhaus.org": ["127.255.255.254"] },
    }),
  });

  assert.notEqual(blocklist.status, "fail", "an error code must never be reported as a listing");
  assert.equal(blocklist.status, "unknown");
});

test("clean on every list that is answering honestly is a pass", async () => {
  const blocklist = await evaluateBlocklist("example.com", null, {
    now,
    resolver: fakeResolver({ a: BLOCKLIST_TEST_POINTS }),
  });

  assert.equal(blocklist.status, "pass");
});

// ── The whole check ──────────────────────────────────────────────────────────
test("every result carries when it was checked, what was queried and what was seen", async () => {
  const report = await checkDomainAuthentication("automate305.com", {
    now,
    resolver: fakeResolver({
      a: BLOCKLIST_TEST_POINTS,
      mx: { "automate305.com": [{ exchange: "aspmx.l.google.com", priority: 1 }] },
      txt: A305_TXT,
    }),
  });

  assert.equal(report.checkedAt, "2026-09-24T18:59:28.000Z");
  for (const [check, entry] of Object.entries(report.results)) {
    assert.equal(entry.checkedAt, "2026-09-24T18:59:28.000Z", `${check} must be timestamped`);
    assert.ok(Array.isArray(entry.queried) && entry.queried.length > 0, `${check} must name what it queried`);
    assert.ok(Array.isArray(entry.observed), `${check} must record what it observed`);
  }
  assert.equal(report.overall, "pass");
  assert.equal(domainAuthenticates(report), true);
});

test("aestheticdevicepro.com does not authenticate while its DKIM key is revoked", async () => {
  const report = await checkDomainAuthentication("aestheticdevicepro.com", {
    now,
    resolver: fakeResolver({
      a: BLOCKLIST_TEST_POINTS,
      mx: { "aestheticdevicepro.com": [{ exchange: "mx1.hostinger.com", priority: 5 }] },
      txt: { ...AESTHETIC_TXT, "_spf.mail.hostinger.com": [["v=spf1 ~all"]], "_spf.reach.hostinger.com": [["v=spf1 ~all"]] },
    }),
  });

  assert.equal(report.results.dkim.status, "fail");
  assert.equal(report.overall, "fail");
  assert.equal(domainAuthenticates(report), false);
});

test("an unconfigured domain is checked but says it has no expectations", async () => {
  const report = await checkDomainAuthentication("unknown-brand.com", {
    now,
    resolver: fakeResolver({ a: BLOCKLIST_TEST_POINTS }),
  });

  assert.equal(report.configured, false);
  assert.equal(report.results.dkim.status, "unknown");
});

test("derives the sending domains from the senders table, deduplicated", () => {
  assert.deepEqual(
    sendingDomainsFromSenders([
      { email: "cam@automate305.com" },
      { email: "Matt@AestheticDevicePro.com" },
      { email: "tamiko@aestheticdevicepro.com" },
      { email: "broken-no-at-sign" },
    ]),
    ["aestheticdevicepro.com", "automate305.com"],
  );
});

// ── Read-only by construction ────────────────────────────────────────────────
test("the module can only read DNS: it imports nothing that could write a record", async () => {
  const source = await readFile(new URL("../lib/services/domain-auth.js", import.meta.url), "utf8");
  const imports = [...source.matchAll(/^import .* from ['"]([^'"]+)['"]/gm)].map((match) => match[1]);

  assert.deepEqual(imports, ["node:dns/promises"]);
  assert.doesNotMatch(source, /fetch\(|supabase|godaddy|hostinger\.com\/api|method:\s*['"](POST|PUT|PATCH|DELETE)/i);
});
