import 'server-only'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

// Service-role client. Bypasses RLS and can call the Auth admin API, so it
// must only ever run on the server: the 'server-only' import makes the build
// fail if a Client Component imports this module, and the key has no
// NEXT_PUBLIC_ prefix so Next.js never inlines it into browser bundles.
// Callers must check the signed-in user's permissions BEFORE using it.

export class AdminConfigError extends Error {}

let cached: SupabaseClient | null = null

export function createAdminClient(): SupabaseClient {
  if (cached) return cached
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    throw new AdminConfigError(
      'The server is missing SUPABASE_SERVICE_ROLE_KEY (or NEXT_PUBLIC_SUPABASE_URL). See DEPLOY.md.'
    )
  }
  cached = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })
  return cached
}
