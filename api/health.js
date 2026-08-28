// ============================================================
// Automate305 SEP · /api/health.js
// Config check — which env vars are set on this deployment.
// Reports presence only (true/false), never a value.
// Deliberately unauthenticated: you need this to work *before*
// WEBHOOK_SECRET is set, and it discloses no data.
//
// GET /api/health
// { "status": "ok", "ready": false, "env": { ... } }
// ============================================================

// cam@ is the live HVAC sender. The other mailbox passwords are
// resolved per-sender at send time (see passEnvVar in send.js),
// so they can't be checked without knowing the active senders.
const REQUIRED = {
  supabase_url:         'SUPABASE_URL',
  supabase_service_key: 'SUPABASE_SERVICE_KEY',
  webhook_secret:       'WEBHOOK_SECRET',
  webhook_url:          'WEBHOOK_URL',
  smtp_pass_cam:        'SMTP_PASS_CAM'
}

export default function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const env = {}
  for (const [key, name] of Object.entries(REQUIRED)) {
    env[key] = Boolean(process.env[name]?.trim())
  }

  // Never cache — a stale ready:false would outlive the fix.
  res.setHeader('Cache-Control', 'no-store')

  return res.status(200).json({
    status: 'ok',
    ready:  Object.values(env).every(Boolean),
    env
  })
}
