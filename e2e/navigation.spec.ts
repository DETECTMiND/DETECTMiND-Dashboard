import { expect, test } from '@playwright/test'
import { TEAM_STUDY } from './support/accounts'
import { studyId } from './support/data'
import { signIn } from './support/helpers'

test('sidebar has five study items, section tabs, and admin items only for admins', async ({ page }) => {
  await signIn(page, 'admin')
  const id = studyId(TEAM_STUDY)
  await page.goto(`/?study=${id}`)
  const nav = page.getByRole('navigation', { name: 'Main' })
  for (const label of ['Overview', 'Participants', 'Data', 'Surveys', 'Settings', 'Approvals', 'Studies', 'People', 'Activity log']) {
    await expect(nav.getByRole('link', { name: new RegExp(`^${label}`) })).toBeVisible()
  }

  await nav.getByRole('link', { name: /^Data/ }).click()
  await expect(page).toHaveURL(new RegExp(`/studies/${id}/data$`))
  const dataTabs = page.getByRole('navigation', { name: /data sections/i })
  await expect(dataTabs.getByRole('link', { name: 'Raw data' })).toHaveAttribute('aria-current', 'page')
  await dataTabs.getByRole('link', { name: 'Processed' }).click()
  await expect(page).toHaveURL(new RegExp(`/studies/${id}/data/processed`))

  await nav.getByRole('link', { name: /^Settings/ }).click()
  const settingsTabs = page.getByRole('navigation', { name: /settings sections/i })
  for (const tab of ['General', 'Sensors', 'Team']) await expect(settingsTabs.getByRole('link', { name: tab })).toBeVisible()
  await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1)
})

test('owners do not see the admin menu', async ({ page }) => {
  await signIn(page, 'owner')
  await page.goto(`/?study=${studyId(TEAM_STUDY)}`)
  const nav = page.getByRole('navigation', { name: 'Main' })
  await expect(nav.getByRole('link', { name: /^Overview/ })).toBeVisible()
  await expect(nav.getByRole('link', { name: /^Approvals/ })).toHaveCount(0)
  await expect(nav.getByRole('link', { name: /^People/ })).toHaveCount(0)
})

test('old addresses redirect to the new pages', async ({ page }) => {
  await signIn(page, 'admin')
  const id = studyId(TEAM_STUDY)
  const cases: [string, RegExp][] = [
    [`/studies/${id}`, new RegExp(`/\\?study=${id}$`)],
    [`/studies/${id}/config`, new RegExp(`/studies/${id}/settings/sensors$`)],
    [`/studies/${id}/team`, new RegExp(`/studies/${id}/settings/team$`)],
    [`/studies/${id}/esm`, new RegExp(`/studies/${id}/surveys/setup$`)],
    [`/studies/${id}/esm-responses`, new RegExp(`/studies/${id}/surveys$`)],
    [`/studies/${id}/processed`, new RegExp(`/studies/${id}/data/processed$`)],
    ['/admin', /\/admin\/approvals$/],
    ['/admin/researchers', /\/admin\/people$/],
    ['/admin/audit', /\/admin\/activity$/],
    ['/settings', /\/settings\/account$/],
  ]
  for (const [from, to] of cases) {
    await page.goto(from)
    await expect(page, `${from} should redirect`).toHaveURL(to)
  }
})

test('theme switch applies dark mode and remembers it', async ({ page }) => {
  await signIn(page, 'viewer')
  await page.goto(`/?study=${studyId(TEAM_STUDY)}`)
  await page.getByRole('radiogroup', { name: 'Theme' }).first().getByRole('radio', { name: 'Dark' }).click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await page.reload()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await page.screenshot({ path: 'e2e-screenshots/dark_overview.png', fullPage: true })
  await page.getByRole('radiogroup', { name: 'Theme' }).first().getByRole('radio', { name: 'Light' }).click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
})

test('study pages fit a phone screen @mobile', async ({ page }) => {
  await signIn(page, 'owner')
  const id = studyId(TEAM_STUDY)
  const paths = [
    `/?study=${id}`, `/studies/${id}/participants`, `/studies/${id}/data`, `/studies/${id}/data/processed`,
    `/studies/${id}/surveys`, `/studies/${id}/surveys/setup`, `/studies/${id}/settings`,
    `/studies/${id}/settings/sensors`, `/studies/${id}/settings/team`, '/studies', '/studies/new', '/settings/account',
  ]
  for (const path of paths) {
    await page.goto(path)
    await page.waitForLoadState('networkidle')
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    expect(overflow, `${path} scrolls sideways`).toBeLessThanOrEqual(1)
    await page.screenshot({ path: `e2e-screenshots/mobile_study${path.replace(/[/?=]/g, '_')}.png`, fullPage: true })
  }
})
