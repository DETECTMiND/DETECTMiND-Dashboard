import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { jsonError, readJson, requireAdmin, UUID_RE } from '@/lib/admin-auth'
import { DEACTIVATED_BAN } from '../shared'

// PATCH /api/admin/researchers/:id {role?, active?, display_name?}
// The row update runs with the CALLER's session, so RLS (admins only), the
// last-admin guard trigger and the audit trigger (researcher_role_changed /
// researcher_deactivated / researcher_reactivated, actor = caller) all apply.
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin(req)
  if (auth instanceof NextResponse) return auth
  const { supabase, admin, user } = auth
  const { id } = await ctx.params
  if (!UUID_RE.test(id)) return jsonError(400, 'Invalid researcher id')

  const body = await readJson<{ role?: unknown; active?: unknown; display_name?: unknown }>(req)
  if (!body) return jsonError(400, 'Invalid JSON body')
  const patch: { role?: 'admin' | 'researcher'; active?: boolean; display_name?: string | null } = {}
  if (body.role !== undefined) {
    if (body.role !== 'admin' && body.role !== 'researcher') return jsonError(400, "Role must be 'admin' or 'researcher'")
    patch.role = body.role
  }
  if (body.active !== undefined) {
    if (typeof body.active !== 'boolean') return jsonError(400, 'active must be true or false')
    if (!body.active && id === user.id) return jsonError(400, 'You cannot deactivate your own account')
    patch.active = body.active
  }
  if (body.display_name !== undefined) {
    patch.display_name = typeof body.display_name === 'string' && body.display_name.trim()
      ? body.display_name.trim().slice(0, 120) : null
  }
  if (Object.keys(patch).length === 0) return jsonError(400, 'Nothing to change')

  const { data, error } = await supabase.from('researchers').update(patch).eq('user_id', id)
    .select('user_id, email, role, active, display_name')
  if (error) return jsonError(400, error.message)
  if (!data?.length) return jsonError(404, 'Researcher not found')

  // End (or restore) the account's sessions to match `active`.
  let sessionNote: string | null = null
  if (patch.active !== undefined) {
    const { error: banError } = await admin.auth.admin.updateUserById(id, {
      ban_duration: patch.active ? 'none' : DEACTIVATED_BAN,
    })
    if (banError) {
      sessionNote = patch.active
        ? `Reactivated, but sign-in could not be re-enabled: ${banError.message}`
        : `Deactivated (no data access), but existing sessions could not be ended: ${banError.message}`
    }
  }

  return NextResponse.json({ researcher: data[0], warning: sessionNote })
}
