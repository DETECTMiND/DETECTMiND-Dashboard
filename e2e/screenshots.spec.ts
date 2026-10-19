import { test } from '@playwright/test'
import { TEAM_STUDY } from './support/accounts'
import { enrollTestParticipant, sql, q, studyId } from './support/data'
import { signIn } from './support/helpers'

// Visual review only: SCREENSHOTS=1 npx playwright test e2e/screenshots.spec.ts
// Saves every page in light and dark to e2e-screenshots/review/.
test.skip(!process.env.SCREENSHOTS, 'set SCREENSHOTS=1 to capture review screenshots')

const VIEWPORTS = [
  { name: 'phone', width: 375, height: 812 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'tablet-landscape', width: 1024, height: 768 },
]

test('every page fits phone and tablet widths', async ({ browser }) => {
  test.setTimeout(600_000)
  const id = studyId(TEAM_STUDY)
  const { participantId } = await enrollTestParticipant(TEAM_STUDY, 'RESP01')
  void participantId
  const paths = [
    `/?study=${id}`, `/studies/${id}/participants`, `/studies/${id}/data`, `/studies/${id}/data/processed`,
    `/studies/${id}/surveys`, `/studies/${id}/surveys/setup`, `/studies/${id}/settings`, `/studies/${id}/settings/sensors`,
    `/studies/${id}/settings/team`, '/studies', '/studies/new', '/admin/approvals', '/admin/studies', '/admin/people',
    '/admin/activity', '/settings/account',
  ]
  const problems: string[] = []
  for (const vp of VIEWPORTS) {
    const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, hasTouch: vp.width < 800 })
    const page = await ctx.newPage()
    await page.goto('/login')
    await page.screenshot({ path: `e2e-screenshots/responsive/${vp.name}_login.png`, fullPage: true })
    await signIn(page, 'admin')
    for (const path of paths) {
      await page.goto(path)
      await page.waitForLoadState('networkidle')
      await page.waitForTimeout(300)
      const overflow = await page.evaluate(() => {
        const doc = document.documentElement
        const wide = [...document.querySelectorAll<HTMLElement>('main *')]
          .filter(el => el.getBoundingClientRect().right > doc.clientWidth + 1 && getComputedStyle(el).position !== 'fixed')
          .filter(el => !el.closest('.overflow-auto, .overflow-x-auto, [class*="overflow-x"], table'))
          .slice(0, 3).map(el => `${el.tagName.toLowerCase()}.${(el.className || '').toString().slice(0, 60)}`)
        return { page: doc.scrollWidth - doc.clientWidth, wide }
      })
      if (overflow.page > 1 || overflow.wide.length) problems.push(`${vp.name} ${path}: scroll ${overflow.page}px ${overflow.wide.join(' | ')}`)
      await page.screenshot({ path: `e2e-screenshots/responsive/${vp.name}${path.replace(/[/?=]/g, '_')}.png`, fullPage: true })
    }
    await ctx.close()
  }
  console.log(problems.length ? `PROBLEMS:\n${problems.join('\n')}` : 'No overflow found')
})

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
