// ============================================================
// Automate305 SEP · /api/health.js
// Unauthenticated health + config check. Returns 200 always.
// Reports which required env vars are SET (booleans only — never
// the values) so you can verify the Vercel configuration without
// exposing any secret. Safe to be public.
// ============================================================

export default function handler(req, res) {
  const present = (name) => Boolean(process.env[name])

  const env = {
    supabase_url:         present('SUPABASE_URL'),
    supabase_service_key: present('SUPABASE_SERVICE_KEY'),
    webhook_secret:       present('WEBHOOK_SECRET'),
    webhook_url:          present('WEBHOOK_URL'),
    smtp_pass_cam:        present('SMTP_PASS_CAM')
  }

  // The bare minimum for /api/send to run against Supabase:
  const ready = env.supabase_url && env.supabase_service_key && env.webhook_secret

  res.status(200).json({
    status:  'ok',
    service: 'a305-sep',
    time:    new Date().toISOString(),
    ready,               // true once the core env vars are set
    env                  // which vars are present (never the values)
  })
}
