import { expect, type Page } from '@playwright/test'
import { ACCOUNTS, TEST_PASSWORD, type AccountName } from './accounts'
import { studyId } from './data'
import { localSupabaseEnv } from './local-supabase'

export async function signIn(page: Page, who: AccountName | string, password = TEST_PASSWORD) {
  const email = who in ACCOUNTS ? ACCOUNTS[who as AccountName] : who
  await page.goto('/login')
  await page.getByLabel(/email/i).fill(email)
  await page.getByLabel(/^password/i).fill(password)
  await page.getByRole('button', { name: /sign in/i }).click()
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 20_000 })
}

export async function signOut(page: Page) {
  await page.context().clearCookies()
  await page.goto('/login')
}

/** The newest email Mailpit caught for an address, with the first link in it. */
export async function latestEmailLink(to: string, timeoutMs = 20_000): Promise<string> {
  const { mailpitUrl } = localSupabaseEnv()
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const search = await fetch(`${mailpitUrl}/api/v1/search?query=${encodeURIComponent(`to:${to}`)}`)
    const { messages } = (await search.json()) as { messages?: { ID: string }[] }
    if (messages?.length) {
      const msg = await (await fetch(`${mailpitUrl}/api/v1/message/${messages[0].ID}`)).json() as { HTML?: string; Text?: string }
      const body = msg.HTML || msg.Text || ''
      const link = body.match(/https?:\/\/[^"'\s<>]+/g)?.find((l) => l.includes('/auth/v1/verify') || l.includes('/auth/callback'))
      if (link) return link.replace(/&amp;/g, '&')
    }
    await new Promise((r) => setTimeout(r, 1000))
  }
  throw new Error(`No email with a link arrived for ${to}`)
}

export async function openStudy(page: Page, name: string) {
  // Navigate by id: the study name also appears in the sidebar switcher.
  // A study's overview lives at /?study=<id> (/studies/<id> redirects there).
  const id = studyId(name)
  await page.goto(`/?study=${id}`)
  await expect(page).toHaveURL(new RegExp(`study=${id}`))
  return id
}

/** Address of a study's Team tab (Settings → Team). */
export const teamUrl = (id: string) => `/studies/${id}/settings/team`

/**
 * Adds someone on the Team tab through the one "Add people" control: search
 * (or type a new email), pick the match, choose the study role, submit.
 */
export async function addToTeam(page: Page, email: string, role: 'owner' | 'editor' | 'viewer') {
  await page.getByRole('combobox', { name: /name or email/i }).fill(email)
  await page.getByRole('option', { name: new RegExp(email.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) }).click()
  await page.getByLabel('Study role', { exact: true }).selectOption(role)
  await page.getByRole('button', { name: /add to study/i }).click()
}
