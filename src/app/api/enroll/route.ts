import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'

type EnrollBody = {
  study_id?: unknown
  device_id?: unknown
  pin?: unknown
  device_info?: unknown
  request_id?: unknown
}

type EnrollResult = {
  participant_id: string | null
  device_id: string | null
  error_message: string | null
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const DEVICE_ID = /^[A-Za-z0-9_-]{1,64}$/

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: EnrollBody
  try {
    body = await req.json() as EnrollBody
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const studyId = typeof body.study_id === 'string' ? body.study_id.trim() : ''
  const deviceId = typeof body.device_id === 'string' ? body.device_id.trim() : ''
  const pin = typeof body.pin === 'string' ? body.pin : null
  const requestId = typeof body.request_id === 'string' && UUID.test(body.request_id) ? body.request_id : null
  const deviceInfo = body.device_info && typeof body.device_info === 'object' && !Array.isArray(body.device_info)
    ? body.device_info
    : {}

  if (!UUID.test(studyId) || !DEVICE_ID.test(deviceId)) {
    return NextResponse.json({ error: 'A valid study_id and device_id are required' }, { status: 400 })
  }

  // Keep PIN verification, throttling and ID collision handling in the single
  // canonical database transaction used by the Android app.
  const { data, error } = await supabase
    .rpc('enroll_participant', {
      p_study: studyId,
      p_device_id: deviceId,
      p_pin: pin,
      p_device_info: deviceInfo,
      p_request_id: requestId,
    })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 })
  }

  const result = (data as EnrollResult[] | null)?.[0]
  if (!result) return NextResponse.json({ error: 'Enrollment returned no result' }, { status: 502 })
  if (result.error_message) {
    return NextResponse.json({ error: result.error_message }, { status: 400 })
  }

  return NextResponse.json({
    participant_id: result.participant_id,
    device_id: result.device_id,
    device_id_remapped: result.device_id !== deviceId,
    original_device_id: deviceId,
  }, { status: 201 })
}
