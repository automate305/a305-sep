import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

process.env.SUPABASE_URL = "https://example.supabase.co";
process.env.SUPABASE_SERVICE_KEY = "test-service-role-key";
process.env.WEBHOOK_SECRET = "test-webhook-secret";
process.env.WEBHOOK_URL = "https://example.test";
process.env.DASHBOARD_ACCESS_KEY = "test-dashboard-access-key";
process.env.SMTP_PASS_CAM = "test-smtp-password";

function createResponse() {
  return {
    body: null,
    headers: new Map(),
    statusCode: 200,
    json(payload) {
      this.body = payload;
      return this;
    },
    setHeader(name, value) {
      this.headers.set(name, value);
    },
    status(statusCode) {
      this.statusCode = statusCode;
      return this;
    },
  };
}

test("preserves the public health payload without exposing values", async () => {
  const { default: healthHandler } = await import("../pages/api/health.js");
  const response = createResponse();

  healthHandler({ method: "GET" }, response);

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.service, "a305-sep");
  assert.equal(response.body.ready, true);
  assert.deepEqual(response.body.env, {
    smtp_pass_cam: true,
    supabase_service_key: true,
    supabase_url: true,
    webhook_secret: true,
    webhook_url: true,
  });
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.doesNotMatch(JSON.stringify(response.body), /test-service-role-key|test-webhook-secret/);
});

test("treats documented placeholders as unconfigured", async () => {
  const { default: healthHandler } = await import("../pages/api/health.js");
  const originalSupabaseUrl = process.env.SUPABASE_URL;
  const originalSmtpPassword = process.env.SMTP_PASS_CAM;
  const response = createResponse();

  try {
    process.env.SUPABASE_URL = "https://your-project-id.supabase.co";
    process.env.SMTP_PASS_CAM = "your-cam-hostinger-password";
    healthHandler({ method: "GET" }, response);

    assert.equal(response.statusCode, 200);
    assert.equal(response.body.ready, false);
    assert.equal(response.body.env.supabase_url, false);
    assert.equal(response.body.env.smtp_pass_cam, false);
  } finally {
    process.env.SUPABASE_URL = originalSupabaseUrl;
    process.env.SMTP_PASS_CAM = originalSmtpPassword;
  }
});

test("preserves authentication on all mutation routes", async () => {
  const routeNames = ["enroll", "send", "update-status"];

  for (const routeName of routeNames) {
    const { default: handler } = await import(`../pages/api/${routeName}.js`);
    const response = createResponse();

    await handler({ body: {}, headers: {}, method: "POST" }, response);

    assert.equal(response.statusCode, 401, `${routeName} must remain protected`);
    assert.deepEqual(response.body, { error: "Unauthorized" });
  }
});

test("protects the no-send SMTP readiness route", async () => {
  const { default: readinessHandler } = await import("../pages/api/readiness.js");
  const response = createResponse();

  await readinessHandler({ headers: {}, method: "GET" }, response);

  assert.equal(response.statusCode, 401);
  assert.deepEqual(response.body, { error: "Unauthorized" });
});

test("readiness fails closed before connecting with placeholder database credentials", async () => {
  const { default: readinessHandler } = await import("../pages/api/readiness.js");
  const originalSupabaseUrl = process.env.SUPABASE_URL;
  const originalSupabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;
  const response = createResponse();

  try {
    process.env.SUPABASE_URL = "https://your-project-id.supabase.co";
    process.env.SUPABASE_SERVICE_KEY = "your-service-role-key";

    await readinessHandler(
      {
        headers: { "x-a305-secret": process.env.WEBHOOK_SECRET },
        method: "GET",
      },
      response,
    );

    assert.equal(response.statusCode, 503);
    assert.equal(response.body.ready, false);
    assert.equal(response.body.error, "Supabase is not configured");
    assert.doesNotMatch(JSON.stringify(response.body), /your-service-role-key/);
  } finally {
    process.env.SUPABASE_URL = originalSupabaseUrl;
    process.env.SUPABASE_SERVICE_KEY = originalSupabaseServiceKey;
  }
});

test("keeps every documented environment variable", async () => {
  const environmentExample = await readFile(new URL("../.env.example", import.meta.url), "utf8");
  const expectedVariables = [
    "SUPABASE_URL",
    "SUPABASE_SERVICE_KEY",
    "WEBHOOK_SECRET",
    "WEBHOOK_URL",
    "DASHBOARD_ACCESS_KEY",
    "AI_MONTHLY_BUDGET_USD",
    "ELEVENLABS_API_KEY",
    "SMTP_PASS_MATT",
    "SMTP_PASS_DON",
    "SMTP_PASS_ED",
    "SMTP_PASS_EDDIE",
    "SMTP_PASS_MATTHEW",
    "SMTP_PASS_ROB",
    "SMTP_PASS_TAMIKO",
    "SMTP_PASS_JEN",
    "SMTP_PASS_JENNY",
    "SMTP_PASS_JESS",
    "SMTP_PASS_JESSICA",
    "SMTP_PASS_TAMI",
    "SMTP_PASS_CAM",
    "SMTP_PASS_CAMILO",
    "SMTP_PASS_HELLO",
    "SMTP_PASS_SALES",
  ];

  for (const variableName of expectedVariables) {
    assert.match(environmentExample, new RegExp(`^${variableName}=`, "m"));
  }
});
