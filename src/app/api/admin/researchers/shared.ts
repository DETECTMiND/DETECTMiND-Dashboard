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
