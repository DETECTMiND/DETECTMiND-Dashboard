import 'server-only'
import type { SupabaseClient, User } from '@supabase/supabase-js'

/** Every auth user (paged). Fine for a research team; caps at 20k accounts. */
export async function listAuthUsers(admin: SupabaseClient): Promise<User[]> {
  const all: User[] = []
  const perPage = 1000
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage })
    if (error) throw new Error(`Could not list auth users: ${error.message}`)
    all.push(...data.users)
    if (data.users.length < perPage) break
  }
  return all
}

export async function findAuthUserByEmail(admin: SupabaseClient, email: string): Promise<User | null> {
  const users = await listAuthUsers(admin)
  return users.find(u => u.email?.toLowerCase() === email.toLowerCase()) ?? null
}

/** Invite accepted / password set at least once. */
export function hasSignedIn(user: User | null | undefined): boolean {
  return !!(user?.last_sign_in_at || user?.email_confirmed_at)
}

// Long ban used to end a deactivated researcher's sessions: refresh tokens
// stop working and they cannot sign in again until reactivated. RLS already
// denies them data from the moment `active` is false.
export const DEACTIVATED_BAN = '876000h'

type Failure = { ok: false; status: number; error: string }

/**
 * Sends a Supabase invite email to `email` (link lands on `redirectTo`). If an
 * auth account already exists for the address, returns that account instead
 * (existingAccount = true) so it can be granted access without a new invite.
 */
export async function inviteOrFindAuthUser(
  admin: SupabaseClient,
  email: string,
  redirectTo: string,
): Promise<{ ok: true; userId: string; existingAccount: boolean } | Failure> {
  const { data: invited, error: inviteError } = await admin.auth.admin.inviteUserByEmail(email, { redirectTo })
  if (invited?.user) return { ok: true, userId: invited.user.id, existingAccount: false }
  if (inviteError && /already been registered|already exists|email_exists/i.test(`${inviteError.message} ${inviteError.code ?? ''}`)) {
    let found: User | null
    try {
      found = await findAuthUserByEmail(admin, email)
    } catch (e) {
      return { ok: false, status: 500, error: e instanceof Error ? e.message : 'Could not look up the account' }
    }
    if (!found) return { ok: false, status: 409, error: 'An account with this email exists but could not be found' }
    return { ok: true, userId: found.id, existingAccount: true }
  }
  return { ok: false, status: 502, error: `Could not send the invite: ${inviteError?.message ?? 'unknown error'}` }
}

/** Inserts the researchers row (service role; clients cannot insert researchers). */
export async function insertResearcherRow(
  admin: SupabaseClient,
  row: { userId: string; email: string; role: 'admin' | 'researcher'; displayName?: string | null },
): Promise<{ ok: true } | Failure> {
  const { error } = await admin.from('researchers').insert({
    user_id: row.userId, email: row.email, role: row.role, active: true, display_name: row.displayName ?? null,
  })
  if (!error) return { ok: true }
  if (error.code === '23505') return { ok: false, status: 409, error: 'This account is already a researcher' }
  return { ok: false, status: 500, error: error.message }
}

/** The researchers row for an email (case-insensitive), via the service role. */
export async function findResearcherByEmail(
  admin: SupabaseClient,
  email: string,
): Promise<{ ok: true; row: { user_id: string; email: string | null; role: string; active: boolean } | null } | Failure> {
  const pattern = email.replace(/[\\%_]/g, c => `\\${c}`)
  const { data, error } = await admin.from('researchers')
    .select('user_id, email, role, active').ilike('email', pattern).limit(1)
  if (error) return { ok: false, status: 500, error: error.message }
  return { ok: true, row: data?.[0] ?? null }
}
