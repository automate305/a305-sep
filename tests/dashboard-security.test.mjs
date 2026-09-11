import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("loads live dashboard data only from a server-only service", async () => {
  const dashboardService = await readFile(
    new URL("../lib/services/dashboard.ts", import.meta.url),
    "utf8",
  );
  const dashboardComponent = await readFile(
    new URL("../components/dashboard/outreach-dashboard.tsx", import.meta.url),
    "utf8",
  );
  const dashboardAuth = await readFile(
    new URL("../lib/services/dashboard-auth.ts", import.meta.url),
    "utf8",
  );
  const schema = await readFile(new URL("../supabase/schema.sql", import.meta.url), "utf8");

  assert.match(dashboardService, /import "server-only"/);
  assert.match(dashboardService, /from\("todays_queue"\)/);
  assert.match(dashboardService, /from\("pipeline_summary"\)/);
  assert.match(dashboardService, /from\("send_log"\)/);
  assert.match(dashboardService, /from\("senders"\)/);
  assert.doesNotMatch(
    dashboardComponent,
    /SUPABASE_SERVICE_KEY|WEBHOOK_SECRET|SMTP_PASS_|createClient/,
  );
  assert.match(dashboardAuth, /httpOnly: true/);
  assert.match(dashboardAuth, /timingSafeEqual/);
  assert.doesNotMatch(schema, /create policy "service_role_all"/i);
  assert.match(schema, /revoke all on table[\s\S]+from anon, authenticated/i);
});

test("renders configuration and empty states instead of demo records", async () => {
  const dashboardComponent = await readFile(
    new URL("../components/dashboard/outreach-dashboard.tsx", import.meta.url),
    "utf8",
  );

  assert.match(dashboardComponent, /filteredQueue\.slice\(0, 7\)\.map/);
  assert.match(dashboardComponent, /Queue is clear/);
  assert.match(dashboardComponent, /Live data unavailable/);
  assert.doesNotMatch(
    dashboardComponent,
    /Maria Gonzalez|Derek Thompson|Nina Patel|James Whitaker|\$42,800/,
  );
});

test("keeps hold approvals server-side and defaults first touches to review", async () => {
  const actions = await readFile(new URL("../app/actions.ts", import.meta.url), "utf8");
  const enrollRoute = await readFile(new URL("../pages/api/enroll.js", import.meta.url), "utf8");

  assert.match(actions, /^"use server";/);
  assert.match(actions, /await hasDashboardAccess\(\)/);
  assert.match(actions, /\.eq\("status", "held"\)/);
  assert.match(enrollRoute, /approval_required = true/);
  assert.match(enrollRoute, /status:\s+requiresApproval \? 'held' : 'active'/);
  assert.match(actions, /export async function importContactsAndEnroll/);
  assert.match(actions, /status: "held"/);
  assert.match(actions, /First-touch approval required/);
  assert.doesNotMatch(actions, /sendMail|\/api\/send/);
});

test("keeps contact imports and sequence edits behind the dashboard session", async () => {
  const actions = await readFile(new URL("../app/actions.ts", import.meta.url), "utf8");
  const contactPanel = await readFile(
    new URL("../components/dashboard/contact-enrollment-panel.tsx", import.meta.url),
    "utf8",
  );
  const sequencePanel = await readFile(
    new URL("../components/dashboard/sequence-builder-panel.tsx", import.meta.url),
    "utf8",
  );

  assert.match(actions, /importContactsAndEnroll[\s\S]+await hasDashboardAccess\(\)/);
  assert.match(actions, /saveSequence[\s\S]+await hasDashboardAccess\(\)/);
  assert.doesNotMatch(contactPanel, /SUPABASE_SERVICE_KEY|WEBHOOK_SECRET|createClient/);
  assert.doesNotMatch(sequencePanel, /SUPABASE_SERVICE_KEY|WEBHOOK_SECRET|createClient/);
});
