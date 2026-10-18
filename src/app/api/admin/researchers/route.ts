import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { audit, EMAIL_RE, jsonError, passwordRedirect, readJson, requireAdmin } from '@/lib/admin-auth'
import { findResearcherByEmail, hasSignedIn, insertResearcherRow, inviteOrFindAuthUser, listAuthUsers } from './shared'

type ResearcherRow = {
  user_id: string
  email: string | null
  display_name: string | null
  role: 'admin' | 'researcher'
  active: boolean
  added_at: string | null
}

// GET /api/admin/researchers -> every researcher with sign-in status and studies.
export async function GET(req: NextRequest) {
  const ctx = await requireAdmin(req)
  if (ctx instanceof NextResponse) return ctx
  const { admin } = ctx

  const [researchers, members] = await Promise.all([
    admin.from('researchers').select('user_id, email, display_name, role, active, added_at').order('email'),
    admin.from('study_members').select('study_id, user_id, role, studies(name)'),
  ])
  if (researchers.error) return jsonError(500, researchers.error.message)
  if (members.error) return jsonError(500, members.error.message)

  let users
  try {
    users = await listAuthUsers(admin)
  } catch (e) {
    return jsonError(500, e instanceof Error ? e.message : 'Could not list auth users')
  }
  const byId = new Map(users.map(u => [u.id, u]))

  type MemberRow = { study_id: string; user_id: string; role: string; studies: { name: string } | { name: string }[] | null }
  const studiesByUser = new Map<string, { study_id: string; name: string; role: string }[]>()
  for (const m of (members.data || []) as MemberRow[]) {
    const study = Array.isArray(m.studies) ? m.studies[0] : m.studies
    const list = studiesByUser.get(m.user_id) ?? []
    list.push({ study_id: m.study_id, name: study?.name ?? m.study_id, role: m.role })
    studiesByUser.set(m.user_id, list)
  }

  return NextResponse.json({
    researchers: ((researchers.data || []) as ResearcherRow[]).map(r => {
      const u = byId.get(r.user_id)
      return {
        ...r,
        email: r.email ?? u?.email ?? null,
        invited_at: u?.invited_at ?? null,
        last_sign_in_at: u?.last_sign_in_at ?? null,
        accepted: hasSignedIn(u),
        studies: studiesByUser.get(r.user_id) ?? [],
      }
    }),
  })
}

// POST /api/admin/researchers {email, role} -> invite (or attach an existing account).
export async function POST(req: NextRequest) {
  const ctx = await requireAdmin(req)
  if (ctx instanceof NextResponse) return ctx
  const { admin, user } = ctx

  const body = await readJson<{ email?: unknown; role?: unknown; display_name?: unknown }>(req)
  const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : ''
  const role = body?.role === 'admin' ? 'admin' : body?.role === 'researcher' || body?.role === undefined ? 'researcher' : null
  const displayName = typeof body?.display_name === 'string' && body.display_name.trim() ? body.display_name.trim().slice(0, 120) : null
  if (!EMAIL_RE.test(email) || email.length > 254) return jsonError(400, 'Enter a valid email address')
  if (!role) return jsonError(400, "Role must be 'admin' or 'researcher'")

  const existing = await findResearcherByEmail(admin, email)
  if (!existing.ok) return jsonError(existing.status, existing.error)
  if (existing.row) return jsonError(409, 'This person already has an account. Find them in the list below to resend their invite or change their access.')

  // Sends the invite, or finds the auth account that already exists (e.g.
  // created by hand) so it can be granted access.
  const invite = await inviteOrFindAuthUser(admin, email, passwordRedirect(req, 'invite'))
  if (!invite.ok) return jsonError(invite.status, invite.error)
  const { userId, existingAccount } = invite

  const inserted = await insertResearcherRow(admin, { userId, email, role, displayName })
  if (!inserted.ok) return jsonError(inserted.status, inserted.error)

  await audit(admin, user.id, 'researcher_invited', 'researcher', userId, { email, role, existing_account: existingAccount })

  return NextResponse.json({
    user_id: userId,
    email,
    role,
    existing_account: existingAccount,
    message: existingAccount
      ? `${email} already had an account and now has researcher access. They can sign in or use "Forgot password?".`
      : `Invite sent to ${email}.`,
  }, { status: 201 })
}
