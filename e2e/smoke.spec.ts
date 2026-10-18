import { expect, test } from '@playwright/test'
import { signIn } from './support/helpers'

// Infrastructure check: every role can sign in against the local stack.
for (const who of ['admin', 'owner', 'editor', 'viewer', 'researcher'] as const) {
  test(`${who} can sign in`, async ({ page }) => {
    await signIn(page, who)
    await expect(page.getByText(/not authori[sz]ed/i)).toHaveCount(0)
  })
}

test('an account that is not a researcher sees the not-authorised screen', async ({ page }) => {
  await page.goto('/login')
  await page.getByLabel(/email/i).fill('outsider@detectmind.test')
  await page.getByLabel(/^password/i).fill('local-e2e-Passw0rd!')
  await page.getByRole('button', { name: /sign in/i }).click()
  await expect(page.getByText(/not authori[sz]ed/i).first()).toBeVisible()
})

test('an expired invite link explains who to ask', async ({ page }) => {
  await page.goto('/reset-password?mode=invite&error=link')
  await expect(page.getByRole('heading', { name: /invite link has expired/i })).toBeVisible()
  await expect(page.getByText(/ask the person who invited you to send a new invite/i)).toBeVisible()
})

test('an expired password reset link points back to sign in', async ({ page }) => {
  await page.goto('/reset-password?mode=recovery&error=link')
  await expect(page.getByRole('heading', { name: /reset link has expired/i })).toBeVisible()
  await expect(page.getByRole('link', { name: /request a new link/i })).toBeVisible()
})
