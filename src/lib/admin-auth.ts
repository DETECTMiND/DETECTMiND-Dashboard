import 'server-only'
import { NextResponse, type NextRequest } from 'next/server'
import type { SupabaseClient, User } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase-server'
import { AdminConfigError, createAdminClient } from '@/lib/supabase-admin'

export function jsonError(status: number, error: string, extra?: Record<string, unknown>) {
  return NextResponse.json({ error, ...extra }, { status })
}

type AdminContext = {
  user: User
  /** The caller's own (RLS-bound) client. */
  supabase: SupabaseClient
  /** Service-role client. Only use after the admin check passed. */
  admin: SupabaseClient
}

/**
 * Verifies that the request comes from a signed-in, active admin researcher.
 * Returns either the context or a ready-to-return JSON error response.
 */
export async function requireAdmin(req: NextRequest): Promise<AdminContext | NextResponse> {
  // Mutating requests must come from this site (defence in depth on top of
  // the SameSite=Lax auth cookies).
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    const origin = req.headers.get('origin')
    if (origin && origin !== req.nextUrl.origin) return jsonError(403, 'Cross-site request refused')
  }

  const supabase = await createClient()
  const { data: { user }, error: userError } = await supabase.auth.getUser()
  if (userError || !user) return jsonError(401, 'You are not signed in')

  const { data: me, error } = await supabase
    .from('researchers').select('role, active').eq('user_id', user.id).maybeSingle()
  if (error) return jsonError(500, `Could not check your access: ${error.message}`)
  if (!me || !me.active || me.role !== 'admin') return jsonError(403, 'Only admins can do this')

  let admin: SupabaseClient
  try {
    admin = createAdminClient()
  } catch (e) {
    if (e instanceof AdminConfigError) return jsonError(500, e.message)
    throw e
  }
  return { user, supabase, admin }
}

type StudyOwnerContext = AdminContext & {
  isAdmin: boolean
  study: { id: string; name: string }
}

/**
 * Verifies that the request comes from a signed-in, active researcher who can
 * manage `studyId` (an owner of that study, or an admin). The study check uses
 * the database's own can_manage_study() with the caller's session.
 */
export async function requireStudyOwner(req: NextRequest, studyId: string): Promise<StudyOwnerContext | NextResponse> {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    const origin = req.headers.get('origin')
    if (origin && origin !== req.nextUrl.origin) return jsonError(403, 'Cross-site request refused')
  }
  if (!UUID_RE.test(studyId)) return jsonError(400, 'Invalid study id')

  const supabase = await createClient()
  const { data: { user }, error: userError } = await supabase.auth.getUser()
  if (userError || !user) return jsonError(401, 'You are not signed in')

  const { data: me, error } = await supabase
    .from('researchers').select('role, active').eq('user_id', user.id).maybeSingle()
  if (error) return jsonError(500, `Could not check your access: ${error.message}`)
  if (!me || !me.active) return jsonError(403, 'Your account does not have dashboard access')

  const [{ data: canManage, error: manageError }, { data: study, error: studyError }] = await Promise.all([
    supabase.rpc('can_manage_study', { p_study: studyId }),
    supabase.from('studies').select('id, name').eq('id', studyId).maybeSingle(),
  ])
  if (manageError) return jsonError(500, `Could not check your access: ${manageError.message}`)
  if (studyError) return jsonError(500, studyError.message)
  if (!study) return jsonError(404, 'Study not found')
  if (canManage !== true) return jsonError(403, 'Only a study owner or an admin can manage this study team')

  let admin: SupabaseClient
  try {
    admin = createAdminClient()
  } catch (e) {
    if (e instanceof AdminConfigError) return jsonError(500, e.message)
    throw e
  }
  return { user, supabase, admin, isAdmin: me.role === 'admin', study: study as { id: string; name: string } }
}

/** Appends an audit_log row as the given actor (service role bypasses RLS). */
export async function audit(
  admin: SupabaseClient,
  actor: string,
  action: string,
  targetType: string,
  targetId: string,
  details: Record<string, unknown> = {},
) {
  const { error } = await admin.from('audit_log').insert({
    actor, action, target_type: targetType, target_id: targetId, details,
  })
  if (error) console.error('audit_log insert failed', action, error.message)
}

export async function readJson<T>(req: NextRequest): Promise<T | null> {
  try {
    const body = await req.json()
    return body && typeof body === 'object' ? body as T : null
  } catch {
    return null
  }
}

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Where invite and password-reset links land (must be in Supabase's Redirect
 * URLs; `/auth/callback**` covers the query). `mode` lets the set-password
 * page greet a new invitee differently from someone resetting a password.
 */
export function passwordRedirect(req: NextRequest, mode: 'invite' | 'recovery' = 'invite') {
  return `${req.nextUrl.origin}/auth/callback?next=/reset-password&mode=${mode}`
}
