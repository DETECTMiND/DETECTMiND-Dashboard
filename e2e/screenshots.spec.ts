import { test } from '@playwright/test'
import { TEAM_STUDY } from './support/accounts'
import { enrollTestParticipant, sql, q, studyId } from './support/data'
import { signIn } from './support/helpers'

// Visual review only: SCREENSHOTS=1 npx playwright test e2e/screenshots.spec.ts
// Saves every page in light and dark to e2e-screenshots/review/.
test.skip(!process.env.SCREENSHOTS, 'set SCREENSHOTS=1 to capture review screenshots')

test('capture every page in light and dark', async ({ page }) => {
  test.setTimeout(300_000)
  const id = studyId(TEAM_STUDY)
  for (const d of ['SCR001', 'SCR002', 'SCR003']) {
    const { participantId } = await enrollTestParticipant(TEAM_STUDY, d)
    sql(`INSERT INTO data_battery (participant_id, level, is_charging, temperature, voltage, recorded_at, client_uuid)
         SELECT ${q(participantId)}, 40 + (g % 50), g % 3 = 0, 30, 3900, now() - (g || ' hours')::interval, gen_random_uuid()
         FROM generate_series(1, 48) g`)
  }
  await signIn(page, 'admin')
  const paths = [
    `/?study=${id}`, `/studies/${id}/participants`, `/studies/${id}/data`, `/studies/${id}/data/processed`,
    `/studies/${id}/surveys`, `/studies/${id}/surveys/setup`, `/studies/${id}/settings`, `/studies/${id}/settings/sensors`,
    `/studies/${id}/settings/team`, '/studies', '/studies/new', '/admin/approvals', '/admin/studies', '/admin/people',
    '/admin/activity', '/settings/account',
  ]
  for (const theme of ['light', 'dark']) {
    await page.evaluate(t => localStorage.setItem('theme', t), theme)
    for (const path of paths) {
      await page.goto(path)
      await page.waitForLoadState('networkidle')
      await page.waitForTimeout(400)
      await page.screenshot({ path: `e2e-screenshots/review/${theme}${path.replace(/[/?=]/g, '_')}.png`, fullPage: true })
    }
  }
})
