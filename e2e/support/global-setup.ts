import { execSync } from 'node:child_process'
import { createClient } from '@supabase/supabase-js'
import { ACCOUNTS, TEAM_STUDY, TEST_PASSWORD } from './accounts'
import { localSupabaseEnv } from './local-supabase'

const root = `${__dirname}/../..`

function sql(statement: string) {
  const container = execSync("docker ps --format '{{.Names}}' | grep -m1 '^supabase_db_'").toString().trim()
  execSync(`docker exec -i ${container} psql -v ON_ERROR_STOP=1 -q -U postgres -d postgres`, {
    input: statement,
  })
}

/** Fresh local database + one account per role, before every test run. */
export default async function globalSetup() {
  const env = localSupabaseEnv()
  execSync('./scripts/local-db-reset.sh', { cwd: root, stdio: 'inherit' })

  const admin = createClient(env.url, env.serviceRoleKey, { auth: { persistSession: false } })

  // clear_database.sql leaves auth.users alone, so start from a clean set of test users
  const { data: existing } = await admin.auth.admin.listUsers({ perPage: 1000 })
  for (const user of existing?.users ?? []) {
    await admin.auth.admin.deleteUser(user.id)
  }
  // Clear any invite/reset emails from earlier runs
  await fetch(`${env.mailpitUrl}/api/v1/messages`, { method: 'DELETE' }).catch(() => undefined)

  for (const email of Object.values(ACCOUNTS)) {
    const { error } = await admin.auth.admin.createUser({ email, password: TEST_PASSWORD, email_confirm: true })
    if (error) throw new Error(`createUser ${email}: ${error.message}`)
  }

  const q = (s: string) => `'${s.replace(/'/g, "''")}'`
  sql(`
    INSERT INTO researchers (user_id, email, role, active)
    SELECT id, email, CASE WHEN email = ${q(ACCOUNTS.admin)} THEN 'admin' ELSE 'researcher' END, true
      FROM auth.users WHERE email <> ${q(ACCOUNTS.outsider)}
    ON CONFLICT (user_id) DO UPDATE SET role = EXCLUDED.role, active = true;

    INSERT INTO study_members (study_id, user_id, role)
    SELECT s.id, u.id, m.role
      FROM (VALUES (${q(ACCOUNTS.owner)}, 'owner'), (${q(ACCOUNTS.editor)}, 'editor'), (${q(ACCOUNTS.viewer)}, 'viewer')) AS m(email, role)
      JOIN auth.users u ON u.email = m.email
      JOIN studies s ON s.name = ${q(TEAM_STUDY)}
    ON CONFLICT (study_id, user_id) DO UPDATE SET role = EXCLUDED.role;
  `)
}
