import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  GETLEADS_ENRICH_URL,
  blankFill,
  enrichContactsByEmail,
  fieldsFromEnrichment,
  readEnrichmentResults,
} from "../lib/services/getleads.js";

test("a missing GetLeads key changes nothing and is not sent anywhere", async () => {
  let called = false;

  await assert.rejects(
    () => enrichContactsByEmail(["pat@example.com"], {
      environment: {},
      fetchImpl: async () => {
        called = true;
        return { json: async () => ({}), ok: true, status: 200 };
      },
    }),
    { code: "GETLEADS_NOT_CONFIGURED" },
  );
  assert.equal(called, false);
});

test("enrichment posts work emails and keeps the key out of the result", async () => {
  let request;
  const results = await enrichContactsByEmail(["Pat@Example.com"], {
    environment: { GETLEADS_API_KEY: "glb_live_test_key" },
    fetchImpl: async (url, options) => {
      request = { options, url };
      return {
        json: async () => ({
          results: [{
            data: {
              current_role_status: "current",
              current_title: "Owner",
              linkedin_url: "https://www.linkedin.com/in/pat",
              mobile_phone: "+13055550100",
            },
            email: "Pat@Example.com",
            success: true,
          }, {
            data: { phone: "should-not-apply" },
            email: "skip@example.com",
            success: false,
          }],
        }),
        ok: true,
        status: 200,
      };
    },
  });

  assert.equal(request.url, GETLEADS_ENRICH_URL);
  assert.equal(request.options.headers.Authorization, "Bearer glb_live_test_key");
  assert.deepEqual(JSON.parse(request.options.body), {
    items: [{ email: "pat@example.com" }],
    limit_per_item: 1,
  });
  assert.equal(JSON.stringify(results).includes("glb_live_test_key"), false);
  assert.equal(results.length, 1);
  assert.equal(results[0].email, "pat@example.com");
});

test("blank fields are filled and a past role does not replace the company", () => {
  const current = fieldsFromEnrichment({
    data: {
      company_name: "Example Co",
      current_role_status: "current",
      current_title: "Owner",
      mobile_phone: "+13055550100",
    },
  });
  const past = fieldsFromEnrichment({
    data: {
      company_name: "Old Co",
      current_role_status: "former",
      current_title: "Intern",
      linkedin_url: "https://www.linkedin.com/in/pat",
    },
  });

  assert.deepEqual(blankFill({ company: "Kept Co", phone: "" }, current), {
    phone: "+13055550100",
    title: "Owner",
  });
  assert.deepEqual(blankFill({ company: "", linkedin_url: "", title: "Owner" }, past), {
    linkedin_url: "https://www.linkedin.com/in/pat",
  });
  assert.deepEqual(readEnrichmentResults({ items: [] }), []);
});

test("the enrich control posts to the server and the page never sees the key", async () => {
  const panel = await readFile(
    new URL("../components/dashboard/contacts-page-panel.tsx", import.meta.url),
    "utf8",
  );
  const action = await readFile(new URL("../app/actions.ts", import.meta.url), "utf8");

  assert.match(panel, /requestGetLeadsEnrichment/);
  assert.match(panel, /name="contactIds"/);
  assert.doesNotMatch(panel, /GETLEADS_API_KEY|Cowork GetLeads run/);
  assert.match(action, /await hasDashboardAccess\(\)/);
  assert.match(action, /enrichContactsByEmail/);
});
