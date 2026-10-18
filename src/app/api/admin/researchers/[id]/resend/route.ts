import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { audit, jsonError, passwordRedirect, readJson, requireAdmin, UUID_RE } from '@/lib/admin-auth'
import { hasSignedIn } from '../../shared'

// POST /api/admin/researchers/:id/resend {action?: 'invite' | 'reset'}
//   action 'invite' -> sends the invite again (only while they are Invited)
//   action 'reset'  -> sends a password-reset email (only once they are Active)
//   no action       -> legacy behaviour: invite when not accepted yet, otherwise reset
// Response: {kind: 'invite' | 'password_reset', message}
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin(req)
  if (auth instanceof NextResponse) return auth
  const { admin, user } = auth
  const { id } = await ctx.params
  if (!UUID_RE.test(id)) return jsonError(400, 'Invalid researcher id')

  const body = await readJson<{ action?: unknown }>(req)
  const action = body?.action
  if (action !== undefined && action !== 'invite' && action !== 'reset') {
    return jsonError(400, "action must be 'invite' or 'reset'")
  }

  const { data: row, error } = await admin.from('researchers').select('email, active').eq('user_id', id).maybeSingle()
  if (error) return jsonError(500, error.message)
  if (!row) return jsonError(404, 'Researcher not found')
  if (!row.active) return jsonError(400, 'Reactivate this person before sending them an email')

  const { data: authUser, error: userError } = await admin.auth.admin.getUserById(id)
  if (userError || !authUser?.user) return jsonError(404, 'No sign-in account exists for this person')
  const email = authUser.user.email ?? row.email
  if (!email) return jsonError(400, 'This account has no email address')

  const accepted = hasSignedIn(authUser.user)
  const kind: 'invite' | 'password_reset' =
    action === 'invite' ? 'invite' : action === 'reset' ? 'password_reset' : accepted ? 'password_reset' : 'invite'

  if (kind === 'invite') {
    if (accepted) return jsonError(409, `${email} has already set a password. Send a password reset instead.`)
    const { error: inviteError } = await admin.auth.admin.inviteUserByEmail(email, { redirectTo: passwordRedirect(req, 'invite') })
    if (inviteError) return jsonError(502, `Could not resend the invite: ${inviteError.message}`)
  } else {
    if (!accepted && action === 'reset') return jsonError(409, `${email} has not accepted their invite yet. Resend the invite instead.`)
    const { error: resetError } = await admin.auth.resetPasswordForEmail(email, { redirectTo: passwordRedirect(req, 'recovery') })
    if (resetError) return jsonError(502, `Could not send a password reset email: ${resetError.message}`)
  }

  await audit(admin, user.id, 'researcher_invited', 'researcher', id, { email, resend: true, kind })
  return NextResponse.json({
    kind,
    message: kind === 'invite' ? `Invite sent again to ${email}.` : `Password reset link sent to ${email}.`,
  })
}
