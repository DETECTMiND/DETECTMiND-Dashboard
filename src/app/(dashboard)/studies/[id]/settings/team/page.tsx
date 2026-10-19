'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { studyPaths } from '@/lib/nav'
import { Trash2, UserPlus, UsersRound } from 'lucide-react'
import { createClient } from '@/lib/supabase-browser'
import { useMe, useStudyAccess, STUDY_ROLE_LABEL } from '@/lib/access'
import {
  Badge, Button, Card, CardHeader, EmptyState, ErrorState, Field, Notice, Select, SkeletonRows,
  errorText, useConfirm, type NoticeState,
  ActionMenu,
} from '@/components/ui'
import { SearchSelect, type SearchOption } from '@/components/search-select'
import { RoleBadge } from '@/components/role-badge'
import { RoleHelp } from '@/components/role-help'

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
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const NEW_PREFIX = 'new:'

const ROLE_SUMMARY: Record<MemberRole, string> = {
  owner: 'Can also pause or complete the study, manage editors and viewers, and delete participants.',
  editor: 'Can change study details, sensors, surveys, the PIN and participant labels.',
  viewer: 'Can see the study and its data, but cannot change anything.',
}

function roleWord(role: MemberRole) {
  return role === 'owner' ? 'an owner' : role === 'editor' ? 'an editor' : 'a viewer'
}

// Person | role | menu, shared by the header and rows so they line up
const MEMBER_COLS = 'sm:grid-cols-[minmax(0,1fr)_9rem_2.5rem]'

export default function TeamPage() {
  const { id: studyId } = useParams<{ id: string }>()
  const me = useMe()
  const access = useStudyAccess(studyId)
  const isAdmin = access.isAdmin
  const router = useRouter()
  // The team is managed by owners and admins only; others go to General
  const noAccess = !access.loading && !access.canManage
  useEffect(() => {
    if (noAccess) router.replace(studyPaths(studyId).settings)
  }, [noAccess, router, studyId])
  const supabase = useMemo(() => createClient(), [])
  const { ask, dialog } = useConfirm()
  const [team, setTeam] = useState<{ study: string; members: Member[]; error: string | null } | null>(null)
  const [directory, setDirectory] = useState<{ list: Candidate[]; error: string | null } | null>(null)
  // Owners and admins: who has not accepted their invite yet.
  const [invitedIds, setInvitedIds] = useState<Set<string>>(new Set())
  const [notice, setNotice] = useState<NoticeState>(null)

  const [pick, setPick] = useState<SearchOption | null>(null)
  const [addRole, setAddRole] = useState<MemberRole>('viewer')
  const [adding, setAdding] = useState(false)

  const roleOptions = isAdmin ? ALL_ROLES : TEAM_ROLES

  const fetchTeam = useCallback(async () => {
    const { data, error } = await supabase.rpc('study_team', { p_study: studyId })
    return { study: studyId, members: (data || []) as Member[], error: error ? errorText(error) : null }
  }, [supabase, studyId])

  const fetchDirectory = useCallback(async () => {
    const { data, error } = await supabase.rpc('researcher_directory', { p_study: studyId })
    return { list: (data || []) as Candidate[], error: error ? errorText(error) : null }
  }, [supabase, studyId])

  const fetchInvited = useCallback(async (): Promise<Set<string> | null> => {
    try {
      const res = await fetch(`/api/studies/${studyId}/invite`)
      if (!res.ok) return null
      const body = await res.json() as { members?: { user_id: string; invited: boolean }[] }
      return new Set((body.members ?? []).filter(m => m.invited).map(m => m.user_id))
    } catch {
      return null
    }
  }, [studyId])

  useEffect(() => {
    let cancelled = false
    fetchTeam().then(t => { if (!cancelled) setTeam(t) })
    return () => { cancelled = true }
  }, [fetchTeam])

  useEffect(() => {
    if (!access.canManage) return
    let cancelled = false
    fetchDirectory().then(d => { if (!cancelled) setDirectory(d) })
    fetchInvited().then(ids => { if (!cancelled && ids) setInvitedIds(ids) })
    return () => { cancelled = true }
  }, [fetchDirectory, fetchInvited, access.canManage])

  async function reload() {
    const [t, d, ids] = await Promise.all([
      fetchTeam(),
      access.canManage ? fetchDirectory() : Promise.resolve(null),
      access.canManage ? fetchInvited() : Promise.resolve(null),
    ])
    setTeam(t)
    if (d) setDirectory(d)
    if (ids) setInvitedIds(ids)
  }

  const members = team?.study === studyId ? team.members : null
  const memberIds = new Set((members || []).map(m => m.user_id))
  const memberEmails = useMemo(() => new Set((members || []).map(m => (m.email ?? '').toLowerCase())), [members])
  const candidates: SearchOption[] = (directory?.list ?? [])
    .filter(c => !memberIds.has(c.user_id) && c.email)
    .map(c => ({ value: c.user_id, label: c.email as string, hint: c.display_name }))
  const effectiveRole: MemberRole = roleOptions.includes(addRole) ? addRole : 'viewer'

  const customOption = useCallback((query: string): SearchOption | null => {
    const email = query.trim().toLowerCase()
    if (!EMAIL_RE.test(email) || memberEmails.has(email)) return null
    return { value: `${NEW_PREFIX}${email}`, label: email, hint: 'Not on the dashboard yet: they get an email invite' }
  }, [memberEmails])

  /** Calls the invite API (handles existing accounts and new emails). Returns an error message or null. */
  async function addPerson(email: string, role: MemberRole): Promise<string | null> {
    try {
      const res = await fetch(`/api/studies/${studyId}/invite`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, role }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) return typeof body.error === 'string' ? body.error : `Could not add ${email} (${res.status})`
      setNotice({ tone: 'success', text: typeof body.message === 'string' ? body.message : `${email} is now ${roleWord(role)}.` })
      setPick(null)
      await reload()
      return null
    } catch (err) {
      return err instanceof Error ? err.message : `Could not add ${email}`
    }
  }

  async function submitAdd(e: React.FormEvent) {
    e.preventDefault()
    if (!pick) return
    const email = pick.label
    const role = effectiveRole
    setNotice(null)
    if (role === 'owner') {
      ask({
        title: `Make ${email} an owner?`,
        tone: 'danger',
        confirmLabel: 'Add as owner',
        body: <p>Owners can pause or complete the study, manage editors and viewers, and delete participants and their data.</p>,
        run: () => addPerson(email, role),
      })
      return
    }
    setAdding(true)
    const problem = await addPerson(email, role)
    setAdding(false)
    if (problem) setNotice({ tone: 'error', text: problem })
  }

  /** Runs a membership write; returns an error string for the dialog, or null. */
  async function write(op: () => PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>, success: string): Promise<string | null> {
    const { data, error } = await op()
    if (error) return errorText(error)
    if (Array.isArray(data) && data.length === 0) return 'You do not have permission to make this change.'
    setNotice({ tone: 'success', text: success })
    await reload()
    return null
  }

  function changeRole(m: Member, role: MemberRole) {
    if (role === m.member_role) return
    const who = m.email ?? 'this member'
    const ownerChange = role === 'owner' || m.member_role === 'owner'
    ask({
      title: `Make ${who} ${roleWord(role)}?`,
      tone: ownerChange ? 'danger' : 'default',
      confirmLabel: 'Change role',
      body: <>
        <p>{STUDY_ROLE_LABEL[role]}: {ROLE_SUMMARY[role]}</p>
        {m.member_role === 'owner' && <p>A study must keep at least one owner, so make someone else owner first if this is the only one.</p>}
        {m.user_id === me?.userId && <p><strong className="text-fg">This is your own role.</strong> You may not be able to change it back.</p>}
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
      title: self ? 'Remove yourself from this study?' : `Remove ${who} from this study?`,
      tone: 'danger',
      confirmLabel: 'Remove',
      body: <>
        <p>{self ? 'You will lose access to this study.' : `${who} loses access to this study straight away. Their dashboard account stays active.`}</p>
        {m.member_role === 'owner' && <p>A study must keep at least one owner.</p>}
      </>,
      run: () => write(
        () => supabase.from('study_members').delete().eq('study_id', studyId).eq('user_id', m.user_id).select('user_id'),
        `${who} was removed from the study.`),
    })
  }

  const addHint = isAdmin
    ? 'Pick someone with a dashboard account, or type an email address to invite someone new. As an admin you can also add owners.'
    : 'Pick someone with a dashboard account, or type an email address to invite someone new. Only admins can add owners.'

  if (access.loading || noAccess) return <SkeletonRows rows={4} />

  return (
    <div className="space-y-5">
      {dialog}

      <Notice notice={notice} onClose={() => setNotice(null)} />

      {access.canManage && (
        <Card>
          <CardHeader icon={<UserPlus size={16} />} title="Add people" description="New people get an email invite and only see the studies they are added to." />
          {directory?.error ? (
            <ErrorState title="Could not load the list of people" message={directory.error} onRetry={() => void reload()} />
          ) : (
            <form onSubmit={submitAdd} className="space-y-3">
              <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_11rem_auto] md:items-end">
                <SearchSelect
                  label="Name or email"
                  options={candidates}
                  value={pick?.value ?? null}
                  onChange={(_, option) => setPick(option)}
                  customOption={customOption}
                  disabled={directory === null}
                  placeholder={directory === null ? 'Loading people…' : 'Search, or type an email address'}
                  emptyText="No one matches. Type a full email address to invite someone new."
                />
                <Field label="Study role">
                  {id => (
                    <Select id={id} value={effectiveRole} onChange={e => setAddRole(e.target.value as MemberRole)}>
                      {roleOptions.map(r => <option key={r} value={r}>{STUDY_ROLE_LABEL[r]}</option>)}
                    </Select>
                  )}
                </Field>
                <Button type="submit" loading={adding} disabled={!pick} className="w-full md:w-auto">Add to study</Button>
              </div>
              <p className="text-xs text-subtle">
                {pick?.value.startsWith(NEW_PREFIX)
                  ? `${pick.label} will get an invite email and join as ${roleWord(effectiveRole)}. `
                  : `${addHint} `}
                <span className="text-muted">{STUDY_ROLE_LABEL[effectiveRole]}: {ROLE_SUMMARY[effectiveRole]}</span>
              </p>
            </form>
          )}
        </Card>
      )}

      <Card padded={false}>
        <div className="px-5 pt-5">
          <CardHeader title={<>Members {members && <span className="text-sm font-normal text-subtle">({members.length})</span>}</>}
            description="Admins can open every study, so they are not listed here." className="mb-3" />
        </div>
        {team?.error && team.study === studyId ? (
          <div className="px-5 pb-5"><ErrorState title="Could not load the team" message={team.error} onRetry={() => void reload()} /></div>
        ) : members === null ? (
          <div className="px-5 pb-5"><SkeletonRows rows={3} /></div>
        ) : members.length === 0 ? (
          <div className="px-5 pb-5">
            <EmptyState icon={<UsersRound size={30} aria-hidden="true" />} title="No members yet" hint="Only admins can open this study until someone is added." />
          </div>
        ) : (
          <>
            <div aria-hidden="true" className={`hidden border-y border-line bg-sunken px-5 py-2 text-xs font-medium text-subtle sm:grid ${MEMBER_COLS}`}>
              <span>Person</span><span>Role</span><span />
            </div>
            <ul className="divide-y divide-line border-t border-line sm:border-t-0" aria-label="Members">
              {members.map(m => {
                const who = m.email ?? m.user_id
                const editable = access.canManage && (isAdmin || m.member_role !== 'owner')
                return (
                  <li key={m.user_id} data-testid="member-row" data-user-id={m.user_id}
                    className={`grid grid-cols-[minmax(0,1fr)_auto_2.5rem] items-center gap-3 px-5 py-3 ${MEMBER_COLS}`}>
                    <div className="min-w-0">
                      <p className="flex min-w-0 flex-wrap items-center gap-1.5 text-sm font-medium text-fg">
                        <span className="min-w-0 truncate" title={who}>{m.display_name || who}</span>
                        {m.user_id === me?.userId && <Badge tone="blue">You</Badge>}
                        {invitedIds.has(m.user_id) && <RoleBadge role="pending" />}
                        {!m.researcher_active && <RoleBadge role="deactivated" />}
                      </p>
                      {m.display_name && <p className="truncate text-xs text-subtle">{who}</p>}
                    </div>
                    <div>
                      {editable ? (
                        <Select value={m.member_role} onChange={e => changeRole(m, e.target.value as MemberRole)}
                          aria-label={`Role for ${who}`} className="h-8 w-full text-xs">
                          {roleOptions.map(r => <option key={r} value={r}>{STUDY_ROLE_LABEL[r]}</option>)}
                        </Select>
                      ) : (
                        <span title={access.canManage && m.member_role === 'owner' ? 'Only admins change owners' : undefined}>
                          <RoleBadge role={m.member_role} />
                        </span>
                      )}
                    </div>
                    <div className="flex justify-end">
                      {editable && (
                        <ActionMenu label={`Actions for ${who}`} items={[
                          { label: 'Remove from study…', icon: <Trash2 />, danger: true, onSelect: () => remove(m) },
                        ]} />
                      )}
                    </div>
                  </li>
                )
              })}
            </ul>
          </>
        )}
      </Card>

      <RoleHelp studyOnly />
    </div>
  )
}
