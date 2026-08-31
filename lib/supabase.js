import { createClient } from '@supabase/supabase-js'

let _client

export function getSupabase() {
  if (!_client) {
    _client = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_KEY
    )
  }
  return _client
}

export const supabase = new Proxy({}, {
  get(_, prop) {
    return getSupabase()[prop]
  }
})
