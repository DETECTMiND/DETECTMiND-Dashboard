'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useParams } from 'next/navigation'
import { Trash2, UserPlus, UsersRound } from 'lucide-react'
import { createClient } from '@/lib/supabase-browser'
import { useMe, useStudyAccess, STUDY_ROLE_HELP, STUDY_ROLE_LABEL } from '@/lib/access'
import { EmptyState, LoadingBlock, Notice, ReadOnlyBanner, errorText, type NoticeState } from '@/components/feedback'

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

const ROLES: MemberRole[] = ['owner', 'editor', 'viewer']

export default function TeamPage() {
  const { id } = useParams<{ id: string }>()
  const studyId = id
  const me = useMe()
  const access = useStudyAccess(studyId)
  const supabase = useMemo(() => createClient(), [])
  const [team, setTeam] = useState<{ study: string; members: Member[]; error: string | null } | null>(null)
  const [directory, setDirectory] = useState<Candidate[]>([])
  const [notice, setNotice] = useState<NoticeState>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [addUser, setAddUser] = useState('')
  const [addRole, setAddRole] = useState<MemberRole>('viewer')

  const fetchTeam = useCallback(async () => {
    const { data, error } = await supabase.rpc('study_team', { p_study: studyId })
    return { study: studyId, members: (data || []) as Member[], error: error ? errorText(error) : null }
  }, [supabase, studyId])

  const reload = useCallback(async () => setTeam(await fetchTeam()), [fetchTeam])

  useEffect(() => {
    let cancelled = false
    fetchTeam().then(t => { if (!cancelled) setTeam(t) })
    return () => { cancelled = true }
  }, [fetchTeam])

  useEffect(() => {
    if (!access.canManage) return
    let cancelled = false
    supabase.rpc('researcher_directory').then(({ data }) => {
      if (!cancelled) setDirectory((data || []) as Candidate[])
    })
    return () => { cancelled = true }
  }, [supabase, access.canManage])

  async function run(key: string, success: string, op: () => PromiseLike<{ error: { message: string } | null }>) {
    setBusy(key)
    setNotice(null)
    const { error } = await op()
    setBusy(null)
    if (error) { setNotice({ tone: 'error', text: errorText(error) }); return }
    setNotice({ tone: 'success', text: success })
    await reload()
  }

  const members = team?.study === studyId ? team.members : null
  const memberIds = new Set((members || []).map(m => m.user_id))
  const candidates = directory.filter(c => !memberIds.has(c.user_id))
  const ownerCount = (members || []).filter(m => m.member_role === 'owner').length

  function add(e: React.FormEvent) {
    e.preventDefault()
    const who = candidates.find(c => c.user_id === addUser)
    if (!who) return
    void run('add', `${who.email ?? 'Researcher'} added as ${STUDY_ROLE_LABEL[addRole].toLowerCase()}.`, () =>
      supabase.from('study_members').insert({ study_id: studyId, user_id: who.user_id, role: addRole }))
    setAddUser('')
  }

  function changeRole(m: Member, role: MemberRole) {
    void run(m.user_id, `${m.email ?? 'Member'} is now ${STUDY_ROLE_LABEL[role].toLowerCase()}.`, () =>
      supabase.from('study_members').update({ role }).eq('study_id', studyId).eq('user_id', m.user_id))
  }

  function remove(m: Member) {
    const self = m.user_id === me?.userId
    if (!window.confirm(self
      ? 'Remove yourself from this study? You will lose access to it.'
      : `Remove ${m.email ?? 'this member'} from the study?`)) return
    void run(m.user_id, `${m.email ?? 'Member'} removed from the study.`, () =>
      supabase.from('study_members').delete().eq('study_id', studyId).eq('user_id', m.user_id))
  }

  return (
    <div className="max-w-4xl space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Team</h1>
        <p className="mt-0.5 text-sm text-gray-500">Who can see and work on this study. Admins always have full access.</p>
      </div>

      {!access.loading && !access.canManage && (
        <ReadOnlyBanner text="Only study owners and admins can change the team." />
      )}
      <Notice notice={notice} onClose={() => setNotice(null)} />

      {access.canManage && (
        <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
          <h2 className="flex items-center gap-2 text-base font-semibold text-gray-800"><UserPlus size={16} /> Add a researcher</h2>
          {candidates.length === 0 ? (
            <p className="mt-2 text-sm text-gray-500">
              Every active researcher is already on this team.{me?.role === 'admin' ? ' Invite new people from Admin → Researchers.' : ' Ask an admin to invite new people.'}
            </p>
          ) : (
            <form onSubmit={add} className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end">
              <label className="flex-1 text-sm font-medium text-gray-700">Researcher
                <select value={addUser} onChange={e => setAddUser(e.target.value)} required
                  className="mt-1.5 block w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-normal">
                  <option value="">Choose…</option>
                  {candidates.map(c => <option key={c.user_id} value={c.user_id}>{c.email ?? c.user_id}{c.display_name ? ` (${c.display_name})` : ''}</option>)}
                </select>
              </label>
              <label className="text-sm font-medium text-gray-700">Role
                <select value={addRole} onChange={e => setAddRole(e.target.value as MemberRole)}
                  className="mt-1.5 block w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-normal sm:w-36">
                  {ROLES.map(r => <option key={r} value={r}>{STUDY_ROLE_LABEL[r]}</option>)}
                </select>
              </label>
              <button type="submit" disabled={!addUser || busy === 'add'}
                className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-500 disabled:opacity-50">
                {busy === 'add' ? 'Adding…' : 'Add to study'}
              </button>
            </form>
          )}
          <p className="mt-3 text-xs text-gray-400">{STUDY_ROLE_LABEL[addRole]}: {STUDY_ROLE_HELP[addRole]}.</p>
        </section>
      )}

      {team?.error && team.study === studyId ? (
        <Notice notice={{ tone: 'error', text: team.error }} />
      ) : members === null ? (
        <LoadingBlock label="Loading team…" />
      ) : members.length === 0 ? (
        <EmptyState icon={<UsersRound size={30} />} title="No members yet" hint="Only admins can access this study until someone is added." />
      ) : (
        <section className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
          <ul className="divide-y divide-gray-100">
            {members.map(m => {
              const lastOwner = m.member_role === 'owner' && ownerCount <= 1
              return (
                <li key={m.user_id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-gray-900">
                      {m.email ?? m.user_id}
                      {m.user_id === me?.userId && <span className="ml-2 rounded bg-blue-50 px-1.5 py-0.5 text-[10px] font-semibold text-blue-700">You</span>}
                      {!m.researcher_active && <span className="ml-2 rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-semibold text-gray-500">Deactivated</span>}
                    </p>
                    {m.display_name && <p className="text-xs text-gray-500">{m.display_name}</p>}
                  </div>
                  {access.canManage ? (
                    <>
                      <select value={m.member_role} disabled={busy === m.user_id}
                        onChange={e => changeRole(m, e.target.value as MemberRole)}
                        title={lastOwner ? 'A study needs at least one owner' : undefined}
                        aria-label={`Role for ${m.email}`}
                        className="rounded-lg border border-gray-200 bg-white px-2 py-1 text-xs">
                        {ROLES.map(r => <option key={r} value={r} disabled={lastOwner && r !== 'owner'}>{STUDY_ROLE_LABEL[r]}</option>)}
                      </select>
                      <button onClick={() => remove(m)} disabled={busy === m.user_id || lastOwner}
                        title={lastOwner ? 'A study needs at least one owner' : 'Remove from study'}
                        className="rounded-lg p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-30" aria-label={`Remove ${m.email}`}>
                        <Trash2 size={15} />
                      </button>
                    </>
                  ) : (
                    <span className="rounded-md bg-gray-100 px-2 py-0.5 text-xs font-semibold text-gray-600">{STUDY_ROLE_LABEL[m.member_role]}</span>
                  )}
                </li>
              )
            })}
          </ul>
        </section>
      )}

      <section className="rounded-xl border border-gray-200 bg-white p-4 text-xs text-gray-500">
        <p className="mb-1 font-semibold text-gray-700">Roles</p>
        <ul className="space-y-0.5">
          {ROLES.map(r => <li key={r}><span className="font-medium text-gray-700">{STUDY_ROLE_LABEL[r]}</span> — {STUDY_ROLE_HELP[r]}</li>)}
        </ul>
      </section>
    </div>
  )
}
