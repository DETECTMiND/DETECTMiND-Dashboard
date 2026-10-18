import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { audit, jsonError, passwordRedirect, requireAdmin, UUID_RE } from '@/lib/admin-auth'
import { hasSignedIn } from '../../shared'

// POST /api/admin/researchers/:id/resend
// Not yet accepted -> sends the invite again. Already accepted -> sends a
// password-reset email instead (an accepted invite cannot be re-sent).
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin(req)
  if (auth instanceof NextResponse) return auth
  const { admin, user } = auth
  const { id } = await ctx.params
  if (!UUID_RE.test(id)) return jsonError(400, 'Invalid researcher id')

  const { data: row, error } = await admin.from('researchers').select('email, active').eq('user_id', id).maybeSingle()
  if (error) return jsonError(500, error.message)
  if (!row) return jsonError(404, 'Researcher not found')
  if (!row.active) return jsonError(400, 'Reactivate this researcher before sending them an email')

  const { data: authUser, error: userError } = await admin.auth.admin.getUserById(id)
  if (userError || !authUser?.user) return jsonError(404, 'No sign-in account exists for this researcher')
  const email = authUser.user.email ?? row.email
  if (!email) return jsonError(400, 'This account has no email address')

  const redirectTo = passwordRedirect(req)
  let kind: 'invite' | 'password_reset'
  if (!hasSignedIn(authUser.user)) {
    kind = 'invite'
    const { error: inviteError } = await admin.auth.admin.inviteUserByEmail(email, { redirectTo })
    if (inviteError) return jsonError(502, `Could not resend the invite: ${inviteError.message}`)
  } else {
    kind = 'password_reset'
    const { error: resetError } = await admin.auth.resetPasswordForEmail(email, { redirectTo })
    if (resetError) return jsonError(502, `Could not send a password reset email: ${resetError.message}`)
  }

  await audit(admin, user.id, 'researcher_invited', 'researcher', id, { email, resend: true, kind })
  return NextResponse.json({
    kind,
    message: kind === 'invite'
      ? `Invite re-sent to ${email}.`
      : `${email} has already accepted their invite, so a password reset link was sent instead.`,
  })
}
