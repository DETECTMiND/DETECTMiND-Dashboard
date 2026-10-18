'use client'

import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase-browser'

// What the signed-in researcher is allowed to do, for showing/hiding
// controls. The database (RLS + SECURITY DEFINER checks) is what actually
// enforces every rule; this only keeps the UI honest.

export type ResearcherRole = 'admin' | 'researcher'
export type StudyRole = 'admin' | 'owner' | 'editor' | 'viewer'

export interface Me {
  userId: string
  email: string | null
  displayName: string | null
  role: ResearcherRole
}

const MeContext = createContext<Me | null>(null)

export function MeProvider({ me, children }: { me: Me; children: React.ReactNode }) {
  return <MeContext.Provider value={me}>{children}</MeContext.Provider>
}

export function useMe(): Me | null {
  return useContext(MeContext)
}

/** True when the signed-in researcher is a dashboard admin. */
export function useIsAdmin(): boolean {
  return useMe()?.role === 'admin'
}

export function isAdminMe(me: Me | null | undefined): boolean {
  return me?.role === 'admin'
}

export interface StudyAccess {
  role: StudyRole | null
  canView: boolean
  canEdit: boolean
  /** Owner or admin: pause/complete an approved study, manage editors and viewers, delete participants. */
  canManage: boolean
  /** Dashboard admin: approve and delete studies, assign or remove owners. */
  isAdmin: boolean
  loading: boolean
}

export function accessFor(role: StudyRole | null): Omit<StudyAccess, 'loading'> {
  return {
    role,
    canView: role !== null,
    canEdit: role === 'admin' || role === 'owner' || role === 'editor',
    canManage: role === 'admin' || role === 'owner',
    isAdmin: role === 'admin',
  }
}

/** The caller's role in one study (admins are 'admin' everywhere). */
export function useStudyAccess(studyId: string | null | undefined): StudyAccess {
  const me = useMe()
  const supabase = useMemo(() => createClient(), [])
  const [result, setResult] = useState<{ key: string; role: StudyRole | null } | null>(null)
  const key = `${me?.userId}:${studyId}`
  const isAdmin = me?.role === 'admin'

  useEffect(() => {
    if (!me || !studyId || isAdmin) return
    let cancelled = false
    supabase.from('study_members').select('role')
      .eq('study_id', studyId).eq('user_id', me.userId).maybeSingle()
      .then(({ data }) => {
        if (!cancelled) setResult({ key, role: (data?.role as StudyRole | undefined) ?? null })
      })
    return () => { cancelled = true }
  }, [me, studyId, isAdmin, key, supabase])

  if (isAdmin) return { ...accessFor('admin'), loading: false }
  if (!me || !studyId) return { ...accessFor(null), loading: !me }
  if (result?.key !== key) return { ...accessFor(null), loading: true }
  return { ...accessFor(result.role), loading: false }
}

/** Map of study id -> role for every study the caller is a member of. */
export function useMyStudyRoles(): { roles: Record<string, StudyRole>; isAdmin: boolean; loading: boolean } {
  const me = useMe()
  const supabase = useMemo(() => createClient(), [])
  const [roles, setRoles] = useState<{ user: string; map: Record<string, StudyRole> } | null>(null)

  useEffect(() => {
    if (!me) return
    let cancelled = false
    supabase.from('study_members').select('study_id, role').eq('user_id', me.userId)
      .then(({ data }) => {
        if (cancelled) return
        const map: Record<string, StudyRole> = {}
        for (const row of (data || []) as { study_id: string; role: StudyRole }[]) map[row.study_id] = row.role
        setRoles({ user: me.userId, map })
      })
    return () => { cancelled = true }
  }, [me, supabase])

  return {
    roles: roles?.map ?? {},
    isAdmin: me?.role === 'admin',
    loading: !me || roles?.user !== me.userId,
  }
}

export const STUDY_ROLE_LABEL: Record<StudyRole, string> = {
  admin: 'Admin',
  owner: 'Owner',
  editor: 'Editor',
  viewer: 'Viewer',
}

export const STUDY_ROLE_HELP: Record<Exclude<StudyRole, 'admin'>, string> = {
  owner: 'Everything an editor can do, plus pause or complete the study, manage editors and viewers, and delete participants. Admins approve and delete studies and assign owners',
  editor: 'Edit study settings, sensors, surveys, PIN and participant labels. Cannot change the study status or the team',
  viewer: 'Read-only access to the study and its data',
}

/** Dashboard-level roles (Admin → Researchers). */
export const RESEARCHER_ROLE_HELP: Record<ResearcherRole, string> = {
  admin: 'Full access to every study. Approves and deletes studies, assigns owners, manages researchers and reads the audit log',
  researcher: 'Can create studies (an admin approves them first) and work on studies they are a member of, with the role they have there',
}

/** One line per study role, for "who can do what" panels. */
export const STUDY_PERMISSIONS: { action: string; admin: boolean; owner: boolean; editor: boolean; viewer: boolean }[] = [
  { action: 'View the study and its data', admin: true, owner: true, editor: true, viewer: true },
  { action: 'Edit settings, sensors, surveys, PIN and labels', admin: true, owner: true, editor: true, viewer: false },
  { action: 'Pause or complete an approved study', admin: true, owner: true, editor: false, viewer: false },
  { action: 'Invite, add, change or remove editors and viewers', admin: true, owner: true, editor: false, viewer: false },
  { action: 'Delete participants', admin: true, owner: true, editor: false, viewer: false },
  { action: 'Approve or delete the study, assign or remove owners', admin: true, owner: false, editor: false, viewer: false },
]
