import { expect, test } from '@playwright/test'
import { ACCOUNTS, OTHER_STUDY, TEAM_STUDY, TEST_PASSWORD } from './support/accounts'
import { enrollTestParticipant, q, sql, studyId } from './support/data'
import { latestEmailLink, openStudy, signIn, signOut } from './support/helpers'

const NEW_PASSWORD = 'local-e2e-Changed1!'

test('owner invites a new person as viewer; they set a password and see only that study, read-only', async ({ page, browser }) => {
  const invitee = `invitee-${Date.now()}@detectmind.test`
  await signIn(page, 'owner')
  const id = await openStudy(page, TEAM_STUDY)
  await page.goto(`/studies/${id}/team`)
  await page.getByLabel(/^email$/i).fill(invitee)
  await page.getByLabel(/invite role/i).selectOption('viewer')
  await page.getByRole('button', { name: /^invite$/i }).click()
  await expect(page.getByText(/invite sent|invited/i).first()).toBeVisible()

  expect(sql(`SELECT r.role FROM researchers r WHERE r.email = ${q(invitee)}`)).toBe('researcher')
  expect(sql(`SELECT m.role FROM study_members m JOIN researchers r ON r.user_id = m.user_id
              WHERE r.email = ${q(invitee)} AND m.study_id = ${q(id)}`)).toBe('viewer')

  // The invitee follows the emailed link and sets a password
  const link = await latestEmailLink(invitee)
  const ctx = await browser.newContext()
  const guest = await ctx.newPage()
  await guest.goto(link)
  await expect(guest).toHaveURL(/reset-password/)
  await guest.getByLabel(/^new password/i).fill(NEW_PASSWORD)
  await guest.getByLabel(/confirm/i).fill(NEW_PASSWORD)
  await guest.getByRole('button', { name: /set password|save|update/i }).click()
  await guest.waitForURL((url) => !url.pathname.includes('reset-password'))

  await guest.goto('/studies')
  await expect(guest.getByText(TEAM_STUDY).first()).toBeVisible()
  await expect(guest.getByText(OTHER_STUDY)).toHaveCount(0)
  await guest.goto(`/studies/${id}/config`)
  await expect(guest.getByRole('button', { name: /^save/i })).toHaveCount(0)
  await ctx.close()
})

test('change password on the Account page, then sign in with the new one', async ({ page }) => {
  await signIn(page, 'editor')
  await page.goto('/settings/account')
  await page.getByLabel(/current password/i).fill(TEST_PASSWORD)
  await page.getByLabel(/^new password/i).fill(NEW_PASSWORD)
  await page.getByLabel(/confirm/i).fill(NEW_PASSWORD)
  await page.getByRole('button', { name: /change password/i }).click()
  await expect(page.getByText(/password (changed|updated)/i).first()).toBeVisible()

  await signOut(page)
  await signIn(page, 'editor', NEW_PASSWORD)
  await expect(page).not.toHaveURL(/login/)

  // Put it back for other tests
  await page.goto('/settings/account')
  await page.getByLabel(/current password/i).fill(NEW_PASSWORD)
  await page.getByLabel(/^new password/i).fill(TEST_PASSWORD)
  await page.getByLabel(/confirm/i).fill(TEST_PASSWORD)
  await page.getByRole('button', { name: /change password/i }).click()
  await expect(page.getByText(/password (changed|updated)/i).first()).toBeVisible()
})

test('wrong current password is rejected', async ({ page }) => {
  await signIn(page, 'viewer')
  await page.goto('/settings/account')
  await page.getByLabel(/current password/i).fill('not-the-password-123')
  await page.getByLabel(/^new password/i).fill(NEW_PASSWORD)
  await page.getByLabel(/confirm/i).fill(NEW_PASSWORD)
  await page.getByRole('button', { name: /change password/i }).click()
  await expect(page.getByText(/current password (is )?(incorrect|wrong)|incorrect/i).first()).toBeVisible()
})

test('forgot password: email link lets the user set a new password', async ({ page }) => {
  await page.goto('/login')
  await page.getByLabel(/email/i).fill(ACCOUNTS.viewer)
  await page.getByRole('button', { name: /forgot password/i }).click()
  await page.getByRole('button', { name: /send|reset/i }).last().click().catch(() => undefined)
  await expect(page.getByText(/if an account exists|check your email|sent/i).first()).toBeVisible()

  const link = await latestEmailLink(ACCOUNTS.viewer)
  await page.goto(link)
  await expect(page).toHaveURL(/reset-password/)
  await page.getByLabel(/^new password/i).fill(NEW_PASSWORD)
  await page.getByLabel(/confirm/i).fill(NEW_PASSWORD)
  await page.getByRole('button', { name: /set password|save|update/i }).click()
  await page.waitForURL((url) => !url.pathname.includes('reset-password'))

  await signOut(page)
  await signIn(page, 'viewer', NEW_PASSWORD)
  // Restore for later tests (direct DB write of the original password)
  sql(`UPDATE auth.users SET encrypted_password = crypt(${q(TEST_PASSWORD)}, gen_salt('bf'))
       WHERE email = ${q(ACCOUNTS.viewer)}`)
})

test('owner deletes a participant: data removed and audited', async ({ page }) => {
  const device = `E2E${Date.now().toString().slice(-3)}`
  const { participantId } = await enrollTestParticipant(TEAM_STUDY, device)
  expect(sql(`SELECT count(*) FROM data_battery WHERE participant_id = ${q(participantId)}`)).toBe('1')

  await signIn(page, 'owner')
  await page.goto(`/studies/${studyId(TEAM_STUDY)}/participants`)
  const card = page.getByText(device, { exact: true }).first()
  await expect(card).toBeVisible()
  await page.getByRole('button', { name: /delete/i }).filter({ hasNotText: /study/i }).first().click()
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('textbox').fill(device)
  await dialog.getByRole('button', { name: /delete/i }).click()

  await expect.poll(() => sql(`SELECT count(*) FROM participants WHERE id = ${q(participantId)}`)).toBe('0')
  expect(sql(`SELECT count(*) FROM data_battery WHERE participant_id = ${q(participantId)}`)).toBe('0')
  expect(sql(`SELECT count(*) FROM audit_log WHERE action = 'participant_deleted' AND target_id = ${q(participantId)}`)).toBe('1')
})

test('a deactivated researcher is locked out; the last admin cannot be deactivated', async ({ page }) => {
  sql(`UPDATE researchers SET active = false WHERE email = ${q(ACCOUNTS.researcher)}`)
  await page.goto('/login')
  await page.getByLabel(/email/i).fill(ACCOUNTS.researcher)
  await page.getByLabel(/^password/i).fill(TEST_PASSWORD)
  await page.getByRole('button', { name: /sign in/i }).click()
  await expect(page.getByText(/deactivated|not authori[sz]ed/i).first()).toBeVisible()
  sql(`UPDATE researchers SET active = true WHERE email = ${q(ACCOUNTS.researcher)}`)

  expect(() => sql(`UPDATE researchers SET active = false WHERE email = ${q(ACCOUNTS.admin)}`)).toThrow()
})

test('admin pages fit a phone screen @mobile', async ({ page }) => {
  await signIn(page, 'admin')
  for (const path of ['/admin', '/admin/studies', '/admin/researchers', '/admin/audit']) {
    await page.goto(path)
    await page.waitForLoadState('networkidle')
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    expect(overflow, `${path} scrolls sideways`).toBeLessThanOrEqual(1)
    await page.screenshot({ path: `e2e-screenshots/mobile${path.replace(/\//g, '_')}.png`, fullPage: true })
  }
})
