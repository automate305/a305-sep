import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { POSTAL_ADDRESS_BY_CAMPAIGN, buildEmailFooter } from "../lib/services/email-footer.js";

const ADDRESS = "Automate305, 12864 Biscayne Blvd, PMB #2203, North Miami, FL 33181";
const LINK = "https://outbox.automate305.com/api/unsubscribe?token=abc";

test("both brands end every email with the Automate305 postal address", () => {
  for (const campaign of ["hvac", "aesthetic"]) {
    const footer = buildEmailFooter({ campaign, unsubscribeUrl: LINK });
    assert.ok(footer.endsWith(`Sent by ${ADDRESS}`), `${campaign} footer must end with the address`);
  }
});

test("the footer keeps the unsubscribe link and the reply instruction", () => {
  const withLink = buildEmailFooter({ campaign: "hvac", unsubscribeUrl: LINK });
  assert.ok(withLink.includes(`Unsubscribe here: ${LINK}`));
  assert.ok(withLink.includes('Or reply "unsubscribe"'));

  const withoutLink = buildEmailFooter({ campaign: "hvac", unsubscribeUrl: null });
  assert.ok(withoutLink.includes('Reply "unsubscribe"'));
  assert.ok(withoutLink.endsWith(`Sent by ${ADDRESS}`));
});

test("a brand with no address gets no footer, so the message cannot be sent", () => {
  assert.equal(buildEmailFooter({ campaign: "unknown", unsubscribeUrl: LINK }), null);
  assert.equal(buildEmailFooter({ campaign: undefined, unsubscribeUrl: LINK }), null);
  assert.deepEqual(Object.keys(POSTAL_ADDRESS_BY_CAMPAIGN).toSorted(), ["aesthetic", "hvac"]);
});

test("the footer follows the copy rules: no em dash, no link besides unsubscribe", () => {
  const footer = buildEmailFooter({ campaign: "aesthetic", unsubscribeUrl: LINK });
  assert.doesNotMatch(footer, /[—–]/);
  assert.equal((footer.match(/https?:\/\//g) || []).length, 1);
});

test("the send handler uses the footer and holds instead of sending without an address", async () => {
  const source = await readFile(new URL("../pages/api/send.js", import.meta.url), "utf8");
  assert.match(source, /buildEmailFooter\(\{ campaign: item\.campaign/);
  const footerAt = source.indexOf("buildEmailFooter({ campaign");
  const holdAt = source.indexOf("No sender postal address configured for this brand");
  const sendAt = source.indexOf("transporter.sendMail");
  assert.ok(footerAt !== -1 && holdAt > footerAt && sendAt > holdAt, "the hold must come before sendMail");
  assert.match(source, /text:\s+body \+ footer/);
});
