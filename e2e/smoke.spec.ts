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
