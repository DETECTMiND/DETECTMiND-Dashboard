// Test accounts that exist ONLY on the local Supabase stack used by the e2e tests.
// The password is a local test value, never used anywhere real.
export const TEST_PASSWORD = 'local-e2e-Passw0rd!'

export const ACCOUNTS = {
  admin: 'admin@detectmind.test',
  owner: 'owner@detectmind.test',
  editor: 'editor@detectmind.test',
  viewer: 'viewer@detectmind.test',
  researcher: 'researcher@detectmind.test', // active researcher with no study access
  outsider: 'outsider@detectmind.test', // signed-in account that is not a researcher
} as const

export type AccountName = keyof typeof ACCOUNTS

// The study the owner/editor/viewer accounts belong to (created by seed_studies.sql)
export const TEAM_STUDY = 'Sleep & Wellbeing Study'
export const OTHER_STUDY = 'Digital Habits & Focus Study'
