import assert from "node:assert/strict";
import test from "node:test";

import { CONTACT_IMPORT_LIMIT, parseContactCsv } from "../lib/utils/contact-import.js";

test("normalizes common CSV headers and quoted values", () => {
  const result = parseContactCsv(`Email Address,First Name,Last Name,Company Name,City
JAMIE@EXAMPLE.COM,Jamie,Lee,"Example, Inc.",Miami`);

  assert.deepEqual(result.errors, []);
  assert.equal(result.contacts.length, 1);
  assert.deepEqual(result.contacts[0], {
    city: "Miami",
    company: "Example, Inc.",
    email: "jamie@example.com",
    first_name: "Jamie",
    last_name: "Lee",
    source: "dashboard_csv",
  });
});

test("excludes invalid rows and de-duplicates email addresses", () => {
  const result = parseContactCsv(`email,first_name
valid@example.com,Valid
not-an-email,Invalid
VALID@example.com,Duplicate`);

  assert.equal(result.contacts.length, 1);
  assert.equal(result.duplicateCount, 1);
  assert.deepEqual(result.errors, ["Row 3: add a valid email address."]);
});

test("requires an email header", () => {
  const result = parseContactCsv("first_name,company\nJamie,Example Co");

  assert.equal(result.contacts.length, 0);
  assert.deepEqual(result.errors, ["The CSV must include an email column."]);
});

test("caps each import batch", () => {
  const rows = Array.from(
    { length: CONTACT_IMPORT_LIMIT + 1 },
    (_, index) => `person${index}@example.com`,
  );
  const result = parseContactCsv(["email", ...rows].join("\n"));

  assert.equal(result.contacts.length, 0);
  assert.match(result.errors[0], new RegExp(String(CONTACT_IMPORT_LIMIT)));
});
