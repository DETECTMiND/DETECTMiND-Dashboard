import { execSync } from 'node:child_process'
import { randomBytes, randomUUID } from 'node:crypto'
import { localSupabaseEnv } from './local-supabase'

/** Runs SQL as postgres in the local Supabase DB container and returns psql's tuples-only output. */
export function sql(statement: string): string {
  const container = execSync("docker ps --format '{{.Names}}' | grep -m1 '^supabase_db_'").toString().trim()
  return execSync(`docker exec -i ${container} psql -v ON_ERROR_STOP=1 -qtA -U postgres -d postgres`, {
    input: statement,
  }).toString().trim()
}

export const q = (s: string) => `'${s.replace(/'/g, "''")}'`

export function studyId(name: string): string {
  return sql(`SELECT id FROM studies WHERE name = ${q(name)}`)
}

/**
 * Enrolls a participant the way the Android app does (anon key + device token through
 * the enroll RPC) and uploads one battery row, so participant-level flows have real data.
 */
export async function enrollTestParticipant(study: string, deviceId: string) {
  const env = localSupabaseEnv()
  const token = randomBytes(32).toString('hex')
  const headers = {
    apikey: env.anonKey,
    Authorization: `Bearer ${env.anonKey}`,
    'Content-Type': 'application/json',
  }
  const enroll = await fetch(`${env.url}/rest/v1/rpc/enroll_participant`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      p_study: studyId(study),
      p_device_id: deviceId,
      p_pin: null,
      p_request_id: randomUUID(),
      p_device_token: token,
      p_consent_version: '2026-10-v2',
    }),
  })
  if (!enroll.ok) throw new Error(`enroll_participant HTTP ${enroll.status}: ${await enroll.text()}`)
  const [{ participant_id: participantId, error_message: err }] = await enroll.json()
  if (err) throw new Error(`enroll_participant: ${err}`)

  const upload = await fetch(`${env.url}/rest/v1/data_battery?on_conflict=client_uuid`, {
    method: 'POST',
    headers: { ...headers, 'x-device-token': token, Prefer: 'return=minimal,resolution=ignore-duplicates' },
    body: JSON.stringify([{
      participant_id: participantId, level: 80, is_charging: false,
      recorded_at: new Date().toISOString(), client_uuid: randomUUID(),
    }]),
  })
  if (!upload.ok) throw new Error(`battery upload HTTP ${upload.status}: ${await upload.text()}`)
  return { participantId: participantId as string, token }
}
