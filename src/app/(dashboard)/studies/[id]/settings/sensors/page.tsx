'use client'

import { createClient } from '@/lib/supabase-browser'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useParams } from 'next/navigation'
import { ClipboardList } from 'lucide-react'
import { useStudyAccess } from '@/lib/access'
import { studyPaths } from '@/lib/nav'
import {
  ButtonLink, ErrorState, Notice, ReadOnlyBanner, SaveBar, SectionHeader, SkeletonRows, errorText,
  useUnsavedChangesGuard, type NoticeState,
} from '@/components/ui'
import {
  SensorSettingsEditor, draftsFromRows, rowsFromDrafts, type SensorConfigRow, type SensorDrafts,
} from '@/components/study/sensor-settings'

export default function SensorSettingsPage() {
  const { id: studyId } = useParams<{ id: string }>()
  const supabase = useMemo(() => createClient(), [])
  const access = useStudyAccess(studyId)
  const [saved, setSaved] = useState<SensorDrafts | null>(null)
  const [drafts, setDrafts] = useState<SensorDrafts | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState<NoticeState>(null)

  const fetchConfigs = useCallback(async () => {
    const { data, error } = await supabase.from('sensor_configs')
      .select('sensor_type, enabled, interval_seconds, config').eq('study_id', studyId)
    return { rows: (data || []) as SensorConfigRow[], error: error ? errorText(error) : null }
  }, [supabase, studyId])

  const apply = useCallback((res: Awaited<ReturnType<typeof fetchConfigs>>) => {
    setLoadError(res.error)
    if (res.error) return
    const d = draftsFromRows(res.rows)
    setSaved(d)
    setDrafts(d)
  }, [])

  useEffect(() => {
    let cancelled = false
    fetchConfigs().then(res => { if (!cancelled) apply(res) })
    return () => { cancelled = true }
  }, [fetchConfigs, apply])

  const dirty = !!drafts && !!saved && JSON.stringify(drafts) !== JSON.stringify(saved)
  const { dialog } = useUnsavedChangesGuard(dirty)
  const canEdit = access.canEdit

  async function save() {
    if (!drafts) return
    setSaving(true)
    setNotice(null)
    const { data, error } = await supabase.from('sensor_configs')
      .upsert(rowsFromDrafts(studyId, drafts), { onConflict: 'study_id,sensor_type' })
      .select('sensor_type')
    setSaving(false)
    if (error || !data?.length) {
      setNotice({ tone: 'error', text: `Could not save sensor settings: ${error ? errorText(error) : 'you do not have permission to edit this study.'}` })
      return
    }
    setSaved(drafts)
    setNotice({ tone: 'success', text: 'Sensor settings saved. Phones pick them up at their next sync.' })
  }

  return (
    <div>
      {dialog}
      <SectionHeader title="Sensors"
        description="Phones only collect from sensors that are switched on."
        actions={<ButtonLink variant="secondary" href={studyPaths(studyId).surveySetup}><ClipboardList size={15} aria-hidden="true" /> Survey setup</ButtonLink>} />

      <div className="space-y-4">
        {!access.loading && !canEdit && <ReadOnlyBanner />}
        <Notice notice={notice} onClose={() => setNotice(null)} />

        {loadError ? (
          <ErrorState title="Could not load sensor settings" message={loadError}
            onRetry={async () => { setLoadError(null); apply(await fetchConfigs()) }} />
        ) : !drafts ? (
          <SkeletonRows rows={8} />
        ) : (
          <SensorSettingsEditor value={drafts} onChange={setDrafts} disabled={!canEdit} />
        )}
      </div>

      {canEdit && <SaveBar dirty={dirty} saving={saving} onSave={save} onDiscard={() => setDrafts(saved)} />}
    </div>
  )
}
