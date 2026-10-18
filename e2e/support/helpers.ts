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
  // Navigate by id: the study name also appears in the sidebar switcher
  const id = studyId(name)
  await page.goto(`/studies/${id}`)
  await expect(page).toHaveURL(new RegExp(`/studies/${id}`))
  return id
}
