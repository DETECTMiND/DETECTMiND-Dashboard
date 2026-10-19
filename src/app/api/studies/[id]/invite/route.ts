import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { audit, EMAIL_RE, jsonError, passwordRedirect, readJson, requireStudyOwner } from '@/lib/admin-auth'
import { findResearcherByEmail, hasSignedIn, insertResearcherRow, inviteOrFindAuthUser } from '@/app/api/admin/researchers/shared'

const RATE_LIMIT = 20
const RATE_WINDOW_MS = 60 * 60 * 1000
const INVITE_AUDIT_ACTION = 'study_member_invited'

type MemberRole = 'owner' | 'editor' | 'viewer'

const roleWord = (role: MemberRole) => (role === 'owner' ? 'an owner' : role === 'editor' ? 'an editor' : 'a viewer')

function dbErrorText(error: { message?: string; code?: string }): string {
  const msg = error.message || 'Could not update the study team'
  if (/row-level security|permission denied/i.test(msg)) return 'You do not have permission to change this study team.'
  return msg
}

// GET /api/studies/:id/invite
// Owners (of this study) and admins. Which team members have not accepted
// their invite yet (never signed in). Needs auth.users, so it runs with the
// service role after the owner check.
// Response: {members: [{user_id, invited, invited_at, last_sign_in_at}]}
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id: studyId } = await ctx.params
  const auth = await requireStudyOwner(req, studyId)
  if (auth instanceof NextResponse) return auth
  const { admin } = auth

  const { data: members, error } = await admin.from('study_members').select('user_id').eq('study_id', studyId)
  if (error) return jsonError(500, error.message)
  const rows = await Promise.all(((members || []) as { user_id: string }[]).map(async m => {
    const { data } = await admin.auth.admin.getUserById(m.user_id)
    const u = data?.user ?? null
    return {
      user_id: m.user_id,
      invited: !!u && !hasSignedIn(u),
      invited_at: u?.invited_at ?? null,
      last_sign_in_at: u?.last_sign_in_at ?? null,
    }
  }))
  return NextResponse.json({ members: rows })
}

// POST /api/studies/:id/invite {email, role: 'editor' | 'viewer' | 'owner'}
// Owners (of this study) and admins; only admins may use role 'owner'. A new
// email gets a Supabase invite and a plain researcher account; an existing
// researcher is simply added (or their editor/viewer role changed). The membership write uses the CALLER's session
// so RLS, the owner guard and the membership audit trigger all apply.
// Response: {status: 'invited' | 'added' | 'updated', email, role, message}
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id: studyId } = await ctx.params
  const auth = await requireStudyOwner(req, studyId)
  if (auth instanceof NextResponse) return auth
  const { supabase, admin, user, study, isAdmin } = auth

  const body = await readJson<{ email?: unknown; role?: unknown }>(req)
  const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : ''
  if (!EMAIL_RE.test(email) || email.length > 254) return jsonError(400, 'Enter a valid email address')
  if (body?.role === 'owner' && !isAdmin) return jsonError(403, 'Only an admin can add an owner.')
  if (body?.role !== 'editor' && body?.role !== 'viewer' && body?.role !== 'owner') {
    return jsonError(400, "Role must be 'owner', 'editor' or 'viewer'")
  }
  const role: MemberRole = body.role

  // Rate limit: at most RATE_LIMIT invites per caller per hour.
  const since = new Date(Date.now() - RATE_WINDOW_MS).toISOString()
  const { count, error: countError } = await admin.from('audit_log')
    .select('id', { count: 'exact', head: true })
    .eq('actor', user.id).eq('action', INVITE_AUDIT_ACTION).gte('at', since)
  if (countError) return jsonError(500, `Could not check the invite limit: ${countError.message}`)
  if ((count ?? 0) >= RATE_LIMIT) {
    return jsonError(429, `You have sent ${RATE_LIMIT} invites in the last hour. Please wait a while before inviting more people.`)
  }

  // 1. Find or create the researcher account.
  const existing = await findResearcherByEmail(admin, email)
  if (!existing.ok) return jsonError(existing.status, existing.error)

  let userId: string
  let inviteSent = false
  if (existing.row) {
    if (!existing.row.active) return jsonError(403, 'This account is deactivated; ask an admin')
    userId = existing.row.user_id
  } else {
    const invite = await inviteOrFindAuthUser(admin, email, passwordRedirect(req, 'invite'))
    if (!invite.ok) return jsonError(invite.status, invite.error)
    userId = invite.userId
    inviteSent = !invite.existingAccount

    // An existing auth account may already have a researchers row stored under a different email.
    const { data: row, error: rowError } = await admin.from('researchers')
      .select('active').eq('user_id', userId).maybeSingle()
    if (rowError) return jsonError(500, rowError.message)
    if (row && !row.active) return jsonError(403, 'This account is deactivated; ask an admin')
    if (!row) {
      const inserted = await insertResearcherRow(admin, { userId, email, role: 'researcher' })
      if (!inserted.ok) return jsonError(inserted.status, inserted.error)
      await audit(admin, user.id, 'researcher_invited', 'researcher', userId, {
        email, role: 'researcher', existing_account: invite.existingAccount,
        study_id: study.id, study_name: study.name, study_role: role,
      })
    }
  }

  // 2. Add or update the membership (caller's session).
  const { data: membership, error: memberError } = await supabase.from('study_members')
    .select('role').eq('study_id', studyId).eq('user_id', userId).maybeSingle()
  if (memberError) return jsonError(500, dbErrorText(memberError))

  if (membership?.role === 'owner' && !isAdmin) {
    return jsonError(409, `${email} is already an owner of this study. Only an admin can change or remove owners.`)
  }

  let status: 'invited' | 'added' | 'updated'
  let message: string
  if (membership) {
    if (membership.role !== role) {
      const { data, error } = await supabase.from('study_members').update({ role })
        .eq('study_id', studyId).eq('user_id', userId).select('role')
      if (error) return jsonError(400, dbErrorText(error))
      if (!data?.length) return jsonError(403, 'You do not have permission to change this study team.')
      message = `${email} is now ${roleWord(role)} of ${study.name}.`
    } else {
      message = `${email} is already ${roleWord(role)} of ${study.name}.`
    }
    status = 'updated'
  } else {
    const { error } = await supabase.from('study_members').insert({ study_id: studyId, user_id: userId, role })
    if (error) {
      if (inviteSent) {
        await audit(admin, user.id, INVITE_AUDIT_ACTION, 'study', studyId, {
          email, role, study_name: study.name, outcome: 'invite_sent_membership_failed', new_account: true, user_id: userId,
        })
      }
      return jsonError(error.code === '23505' ? 409 : 400,
        error.code === '23505' ? `${email} is already on this study team` : dbErrorText(error))
    }
    status = inviteSent ? 'invited' : 'added'
    message = inviteSent
      ? `Invite sent to ${email}. They join ${study.name} as ${roleWord(role)} once they set a password.`
      : `${email} was added to ${study.name} as ${roleWord(role)}.`
  }

  await audit(admin, user.id, INVITE_AUDIT_ACTION, 'study', studyId, {
    email, role, study_name: study.name, outcome: status, new_account: inviteSent, user_id: userId,
  })

  return NextResponse.json({ status, email, role, message }, { status: status === 'updated' ? 200 : 201 })
}
