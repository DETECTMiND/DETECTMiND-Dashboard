'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useParams } from 'next/navigation'
import { Check, Mail, Minus, Send, Trash2, UserPlus, UsersRound } from 'lucide-react'
import { createClient } from '@/lib/supabase-browser'
import { useMe, useStudyAccess, STUDY_PERMISSIONS, STUDY_ROLE_HELP, STUDY_ROLE_LABEL } from '@/lib/access'
import { EmptyState, LoadingBlock, Notice, ReadOnlyBanner, errorText, type NoticeState } from '@/components/feedback'
import { useConfirm } from '@/components/confirm-dialog'
import { SearchSelect } from '@/components/search-select'
import { RoleBadge } from '@/components/role-badge'

type MemberRole = 'owner' | 'editor' | 'viewer'
type Member = {
  user_id: string
  email: string | null
  display_name: string | null
  member_role: MemberRole
  researcher_active: boolean
  added_at: string
}
type Candidate = { user_id: string; email: string | null; display_name: string | null }

const ALL_ROLES: MemberRole[] = ['owner', 'editor', 'viewer']
const TEAM_ROLES: MemberRole[] = ['editor', 'viewer']
const inputCls = 'w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-normal focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-500/30'

function roleWord(role: MemberRole) {
  return role === 'owner' ? 'an owner' : role === 'editor' ? 'an editor' : 'a viewer'
}

export default function TeamPage() {
  const { id } = useParams<{ id: string }>()
  const studyId = id
  const me = useMe()
  const access = useStudyAccess(studyId)
  const isAdmin = access.isAdmin
  const supabase = useMemo(() => createClient(), [])
  const { ask, dialog } = useConfirm()
  const [team, setTeam] = useState<{ study: string; members: Member[]; error: string | null } | null>(null)
  const [directory, setDirectory] = useState<Candidate[]>([])
  const [directoryError, setDirectoryError] = useState<string | null>(null)
  // Admins only: user ids that were invited but never signed in.
  const [pendingIds, setPendingIds] = useState<Set<string>>(new Set())
  const [notice, setNotice] = useState<NoticeState>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [addUser, setAddUser] = useState<string | null>(null)
  const [addRole, setAddRole] = useState<MemberRole>('viewer')
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRole, setInviteRole] = useState<'editor' | 'viewer'>('viewer')
  const [inviting, setInviting] = useState(false)

  const roleOptions = isAdmin ? ALL_ROLES : TEAM_ROLES

  const fetchTeam = useCallback(async () => {
    const { data, error } = await supabase.rpc('study_team', { p_study: studyId })
    return { study: studyId, members: (data || []) as Member[], error: error ? errorText(error) : null }
  }, [supabase, studyId])

  const fetchDirectory = useCallback(async () => {
    const { data, error } = await supabase.rpc('researcher_directory', { p_study: studyId })
    return { list: (data || []) as Candidate[], error: error ? errorText(error) : null }
  }, [supabase, studyId])

  const reload = useCallback(async () => {
    setTeam(await fetchTeam())
  }, [fetchTeam])

  useEffect(() => {
    let cancelled = false
    fetchTeam().then(t => { if (!cancelled) setTeam(t) })
    return () => { cancelled = true }
  }, [fetchTeam])

  useEffect(() => {
    if (!access.canManage) return
    let cancelled = false
    fetchDirectory().then(d => {
      if (cancelled) return
      setDirectory(d.list)
      setDirectoryError(d.error)
    })
    return () => { cancelled = true }
  }, [fetchDirectory, access.canManage])

  // Invite state needs auth.users, which only the admin API can read.
  useEffect(() => {
    if (!isAdmin) return
    let cancelled = false
    fetch('/api/admin/researchers').then(r => r.ok ? r.json() : null).then(body => {
      if (cancelled || !body?.researchers) return
      const ids = (body.researchers as { user_id: string; accepted: boolean }[]).filter(r => !r.accepted).map(r => r.user_id)
      setPendingIds(new Set(ids))
    }).catch(() => {})
    return () => { cancelled = true }
  }, [isAdmin, team])

  const members = team?.study === studyId ? team.members : null
  const memberIds = new Set((members || []).map(m => m.user_id))
  const candidates = directory.filter(c => !memberIds.has(c.user_id))
  const effectiveAddRole: MemberRole = roleOptions.includes(addRole) ? addRole : 'viewer'

  /** Runs a membership write; returns an error string for the dialog, or null. */
  async function write(op: () => PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>, success: string): Promise<string | null> {
    const { data, error } = await op()
    if (error) return errorText(error)
    if (Array.isArray(data) && data.length === 0) return 'You do not have permission to make this change.'
    setNotice({ tone: 'success', text: success })
    await reload()
    return null
  }

  async function add(e: React.FormEvent) {
    e.preventDefault()
    const who = candidates.find(c => c.user_id === addUser)
    if (!who) return
    const role = effectiveAddRole
    const label = who.email ?? 'Researcher'
    const doAdd = () => write(
      () => supabase.from('study_members').insert({ study_id: studyId, user_id: who.user_id, role }).select('user_id'),
      `${label} added as ${STUDY_ROLE_LABEL[role].toLowerCase()}.`)
    if (role === 'owner') {
      ask({
        title: `Make ${label} an owner?`,
        tone: 'danger',
        confirmLabel: 'Add as owner',
        body: <p>Owners can pause or complete the study, manage editors and viewers, and delete participants and their data.</p>,
        run: async () => { const err = await doAdd(); if (!err) setAddUser(null); return err },
      })
      return
    }
    setBusy('add')
    setNotice(null)
    const err = await doAdd()
    setBusy(null)
    if (err) setNotice({ tone: 'error', text: err })
    else setAddUser(null)
  }

  async function invite(e: React.FormEvent) {
    e.preventDefault()
    setInviting(true)
    setNotice(null)
    try {
      const res = await fetch(`/api/studies/${studyId}/invite`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: inviteEmail.trim(), role: inviteRole }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        setNotice({ tone: 'error', text: typeof body.error === 'string' ? body.error : `Invite failed (${res.status})` })
        return
      }
      const email = typeof body.email === 'string' ? body.email : inviteEmail.trim()
      const fallback = body.status === 'invited'
        ? `Invite sent to ${email}. They join as ${roleWord(inviteRole)} once they set a password.`
        : body.status === 'updated' ? `${email} is now ${roleWord(inviteRole)}.`
        : `${email} already had an account and was added as ${roleWord(inviteRole)}.`
      setNotice({ tone: 'success', text: typeof body.message === 'string' ? body.message : fallback })
      setInviteEmail('')
      await reload()
      if (access.canManage) {
        const d = await fetchDirectory()
        setDirectory(d.list)
      }
    } catch (err) {
      setNotice({ tone: 'error', text: err instanceof Error ? err.message : 'Invite failed' })
    } finally {
      setInviting(false)
    }
  }

  function changeRole(m: Member, role: MemberRole) {
    if (role === m.member_role) return
    const who = m.email ?? 'this member'
    const ownerChange = role === 'owner' || m.member_role === 'owner'
    ask({
      title: `Change ${who} to ${STUDY_ROLE_LABEL[role].toLowerCase()}?`,
      tone: ownerChange ? 'danger' : 'default',
      confirmLabel: 'Change role',
      body: <>
        <p>{STUDY_ROLE_LABEL[role]}: {STUDY_ROLE_HELP[role]}.</p>
        {m.member_role === 'owner' && <p>A study must keep at least one owner, so add another owner first if this is the only one.</p>}
        {m.user_id === me?.userId && <p><strong>This is your own role.</strong> You may lose the ability to change it back.</p>}
      </>,
      run: () => write(
        () => supabase.from('study_members').update({ role }).eq('study_id', studyId).eq('user_id', m.user_id).select('user_id'),
        `${who} is now ${roleWord(role)}.`),
    })
  }

  function remove(m: Member) {
    const self = m.user_id === me?.userId
    const who = m.email ?? 'this member'
    ask({
      title: self ? 'Remove yourself from this study?' : `Remove ${who} from the study?`,
      tone: 'danger',
      confirmLabel: 'Remove',
      body: <>
        <p>{self ? 'You will lose access to this study.' : `${who} will lose access to this study immediately. Their account stays active.`}</p>
        {m.member_role === 'owner' && <p>A study must keep at least one owner.</p>}
      </>,
      run: () => write(
        () => supabase.from('study_members').delete().eq('study_id', studyId).eq('user_id', m.user_id).select('user_id'),
        `${who} removed from the study.`),
    })
  }

  return (
    <div className="max-w-4xl space-y-5">
      {dialog}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Team</h1>
        <p className="mt-0.5 text-sm text-gray-500">Who can see and work on this study. Admins always have full access.</p>
      </div>

      {!access.loading && !access.canManage && (
        <ReadOnlyBanner text="Only study owners and admins can change the team." />
      )}
      <Notice notice={notice} onClose={() => setNotice(null)} />

      {access.canManage && (
        <div className="grid gap-4 md:grid-cols-2">
          <section className="min-w-0 rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
            <h2 className="flex items-center gap-2 text-base font-semibold text-gray-800"><Mail size={16} /> Invite by email</h2>
            <p className="mt-1 text-xs text-gray-500">New people get an email to set a password and land in this study only. People who already have an account are added straight away.</p>
            <form onSubmit={invite} className="mt-4 space-y-3">
              <div>
                <label htmlFor="team-invite-email" className="block text-sm font-medium text-gray-700">Email</label>
                <input id="team-invite-email" type="email" required value={inviteEmail} onChange={e => setInviteEmail(e.target.value)}
                  placeholder="name@university.ac.uk" className={`${inputCls} mt-1.5`} />
              </div>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
                <div className="flex-1">
                  <label htmlFor="team-invite-role" className="block text-sm font-medium text-gray-700">Invite role</label>
                  <select id="team-invite-role" value={inviteRole} onChange={e => setInviteRole(e.target.value as 'editor' | 'viewer')} className={`${inputCls} mt-1.5`}>
                    <option value="viewer">Viewer</option>
                    <option value="editor">Editor</option>
                  </select>
                </div>
                <button type="submit" disabled={inviting || !inviteEmail.trim()}
                  className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-500 disabled:opacity-50">
                  <Send size={14} /> {inviting ? 'Sending…' : 'Invite'}
                </button>
              </div>
              <p className="text-xs text-gray-400">{STUDY_ROLE_LABEL[inviteRole]}: {STUDY_ROLE_HELP[inviteRole]}.</p>
            </form>
          </section>

          <section className="min-w-0 rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
            <h2 className="flex items-center gap-2 text-base font-semibold text-gray-800"><UserPlus size={16} /> Add existing researcher</h2>
            {directoryError ? (
              <p className="mt-2 text-sm text-red-600" role="alert">{directoryError}</p>
            ) : (
              <form onSubmit={add} className="mt-4 space-y-3">
                <SearchSelect
                  label="Search researchers"
                  options={candidates.map(c => ({ value: c.user_id, label: c.email ?? c.user_id, hint: c.display_name }))}
                  value={addUser}
                  onChange={setAddUser}
                  placeholder="Email or name"
                  emptyText={candidates.length === 0 ? 'Every active researcher is already on this team' : 'No researcher matches'}
                />
                <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
                  <div className="flex-1">
                    <label htmlFor="team-add-role" className="block text-sm font-medium text-gray-700">Role for new member</label>
                    <select id="team-add-role" value={effectiveAddRole} onChange={e => setAddRole(e.target.value as MemberRole)} className={`${inputCls} mt-1.5`}>
                      {roleOptions.map(r => <option key={r} value={r}>{STUDY_ROLE_LABEL[r]}</option>)}
                    </select>
                  </div>
                  <button type="submit" disabled={!addUser || busy === 'add'}
                    className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-500 disabled:opacity-50">
                    {busy === 'add' ? 'Adding…' : 'Add to study'}
                  </button>
                </div>
                <p className="text-xs text-gray-400">
                  {isAdmin ? 'As an admin you can also assign owners.' : 'Only admins can assign or remove owners.'}
                </p>
              </form>
            )}
          </section>
        </div>
      )}

      {team?.error && team.study === studyId ? (
        <Notice notice={{ tone: 'error', text: team.error }} />
      ) : members === null ? (
        <LoadingBlock label="Loading team…" />
      ) : members.length === 0 ? (
        <EmptyState icon={<UsersRound size={30} />} title="No members yet" hint="Only admins can access this study until someone is added." />
      ) : (
        <section className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm" aria-labelledby="members-heading">
          <h2 id="members-heading" className="border-b border-gray-100 px-4 py-3 text-sm font-semibold text-gray-700">
            Members <span className="font-normal text-gray-400">({members.length})</span>
          </h2>
          <ul className="divide-y divide-gray-100">
            {members.map(m => {
              const editable = access.canManage && (isAdmin || m.member_role !== 'owner')
              const pending = pendingIds.has(m.user_id)
              return (
                <li key={m.user_id} data-testid="member-row" className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-1.5 text-sm font-medium text-gray-900">
                      <span className="min-w-0 break-all">{m.email ?? m.user_id}</span>
                      {m.user_id === me?.userId && <span className="rounded bg-blue-50 px-1.5 py-0.5 text-[10px] font-semibold text-blue-700">You</span>}
                      {pending && <RoleBadge role="pending" />}
                      {!m.researcher_active && <RoleBadge role="deactivated" />}
                    </p>
                    {m.display_name && <p className="text-xs text-gray-500">{m.display_name}</p>}
                  </div>
                  {editable ? (
                    <div className="flex items-center gap-2">
                      <select value={m.member_role} onChange={e => changeRole(m, e.target.value as MemberRole)}
                        aria-label="Role"
                        className="rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-xs">
                        {(isAdmin ? ALL_ROLES : TEAM_ROLES).map(r => <option key={r} value={r}>{STUDY_ROLE_LABEL[r]}</option>)}
                      </select>
                      <button onClick={() => remove(m)}
                        className="inline-flex items-center gap-1 rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs font-medium text-gray-600 hover:border-red-200 hover:bg-red-50 hover:text-red-600">
                        <Trash2 size={13} aria-hidden="true" /> Remove
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      <RoleBadge role={m.member_role} />
                      {access.canManage && m.member_role === 'owner' && <span className="text-[11px] text-gray-400">Only admins change owners</span>}
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
          {!isAdmin && access.canManage && (
            <p className="border-t border-gray-100 px-4 py-2.5 text-[11px] text-gray-400">Invite status (pending or accepted) is visible to admins.</p>
          )}
        </section>
      )}

      <section className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm" aria-labelledby="who-can-heading">
        <h2 id="who-can-heading" className="text-sm font-semibold text-gray-700">Who can do what</h2>
        <table className="mt-3 w-full table-fixed text-xs">
          <thead>
            <tr className="text-left text-[10px] font-semibold uppercase tracking-wide text-gray-500">
              <th scope="col" className="pb-2 pr-2">Action</th>
              {(['Admin', 'Owner', 'Editor', 'Viewer'] as const).map(r => <th key={r} scope="col" className="w-11 pb-2 text-center sm:w-16">{r}</th>)}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {STUDY_PERMISSIONS.map(p => (
              <tr key={p.action}>
                <th scope="row" className="py-2 pr-2 text-left font-normal text-gray-700">{p.action}</th>
                {([p.admin, p.owner, p.editor, p.viewer]).map((ok, i) => (
                  <td key={i} className="py-2 text-center">
                    {ok ? <Check size={14} className="mx-auto text-emerald-600" aria-label="Yes" /> : <Minus size={14} className="mx-auto text-gray-300" aria-label="No" />}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-3 text-[11px] text-gray-500">Admins are dashboard-wide and are not listed as members. New studies need an admin&apos;s approval before participants can join.</p>
      </section>
    </div>
  )
}
