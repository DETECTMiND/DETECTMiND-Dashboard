import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

export async function POST(req: NextRequest) {
  let body: Record<string, any>
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { study_id, device_id, label, device_info, permissions } = body

  if (!study_id || !device_id) {
    return NextResponse.json({ error: 'study_id and device_id are required' }, { status: 400 })
  }

  // Find all existing device_ids in this study that start with the base device_id
  const { data: existing } = await supabase
    .from('participants')
    .select('device_id')
    .eq('study_id', study_id)
    .like('device_id', `${device_id}%`)

  const takenIds = new Set((existing || []).map((r: { device_id: string }) => r.device_id))

  // Resolve a free device_id: try the original, then _2, _3, ...
  let resolvedId = device_id
  if (takenIds.has(resolvedId)) {
    let suffix = 2
    while (takenIds.has(`${device_id}_${suffix}`)) suffix++
    resolvedId = `${device_id}_${suffix}`
  }

  const { data, error } = await supabase
    .from('participants')
    .insert({
      study_id,
      device_id: resolvedId,
      label: label ?? null,
      device_info: device_info ?? {},
      permissions: permissions ?? {},
      status: 'active',
    })
    .select()
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({
    ...data,
    // Let the app know if the ID was remapped
    device_id_remapped: resolvedId !== device_id,
    original_device_id: device_id,
  }, { status: 201 })
}
