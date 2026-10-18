import { execSync } from 'node:child_process'

export interface LocalSupabaseEnv {
  url: string
  anonKey: string
  serviceRoleKey: string
  mailpitUrl: string
}

let cached: LocalSupabaseEnv | null = null

/**
 * Connection details of the LOCAL Supabase stack, read from `supabase status`.
 * Refuses anything that isn't localhost so tests can never touch the hosted project.
 */
export function localSupabaseEnv(): LocalSupabaseEnv {
  if (cached) return cached
  const out = execSync('npx --yes supabase@2.121.0 status -o env', {
    cwd: `${__dirname}/../..`,
    stdio: ['ignore', 'pipe', 'ignore'],
  }).toString()
  const vars = Object.fromEntries(
    out.split('\n')
      .map((line) => line.match(/^([A-Z_]+)="?(.*?)"?$/))
      .filter((m): m is RegExpMatchArray => m !== null)
      .map((m) => [m[1], m[2]]),
  )
  const env: LocalSupabaseEnv = {
    url: vars.API_URL,
    anonKey: vars.ANON_KEY,
    serviceRoleKey: vars.SERVICE_ROLE_KEY,
    mailpitUrl: vars.MAILPIT_URL ?? vars.INBUCKET_URL,
  }
  for (const [name, value] of Object.entries(env)) {
    if (!value) throw new Error(`supabase status did not report ${name}; is the local stack running?`)
  }
  if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(env.url)) {
    throw new Error(`Refusing to run e2e tests against a non-local Supabase: ${env.url}`)
  }
  cached = env
  return env
}
