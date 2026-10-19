import { expect, test } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'
import { ACCOUNTS, OTHER_STUDY, TEAM_STUDY, TEST_PASSWORD } from './support/accounts'
import { q, sql, studyId } from './support/data'
import { addToTeam, openStudy, signIn, teamUrl } from './support/helpers'
import { localSupabaseEnv } from './support/local-supabase'

// Permission table from the plan, checked through the real UI and the database.

test.describe('study approval', () => {
  test('a researcher creates a study; it stays pending until an admin approves it', async ({ page, browser }) => {
    const name = `E2E pending study ${Date.now()}`

    await signIn(page, 'researcher')
    await page.goto('/studies/new')
    await expect(page.getByText(/an admin will review/i)).toBeVisible()
    await page.getByLabel(/study name/i).first().fill(name)
    // Four-step wizard: Basics → Sensors → Surveys → Review
    for (let i = 0; i < 3; i++) await page.getByRole('button', { name: /^continue$/i }).click()
    await page.getByRole('button', { name: /create study/i }).click()
    await expect(page.getByText(/pending approval/i).first()).toBeVisible()

    // Database agrees: draft, unapproved, creator is owner
    expect(sql(`SELECT status || '|' || (approved_at IS NULL) FROM studies WHERE name = ${q(name)}`)).toBe('draft|true')
    expect(sql(`SELECT m.role FROM study_members m JOIN studies s ON s.id = m.study_id
                JOIN auth.users u ON u.id = m.user_id WHERE s.name = ${q(name)} AND u.email = ${q(ACCOUNTS.researcher)}`)).toBe('owner')

    // The owner cannot activate it
    await expect(page.getByRole('button', { name: /^approve$/i })).toHaveCount(0)

    // Admin approves from Admin → Approvals
    const adminCtx = await browser.newContext()
    const admin = await adminCtx.newPage()
    await signIn(admin, 'admin')
    await admin.goto('/admin/approvals')
    const card = admin.getByTestId('approval-card').filter({ hasText: name })
    await expect(card).toContainText(/pending approval/i)
    await card.getByRole('button', { name: /^approve$/i }).click()
    await admin.getByRole('dialog').getByRole('button', { name: /^approve$/i }).click()
    await expect(admin.getByTestId('approval-card').filter({ hasText: name })).toHaveCount(0)
    await expect.poll(() => sql(`SELECT status FROM studies WHERE name = ${q(name)}`)).toBe('active')
    expect(sql(`SELECT count(*) FROM audit_log WHERE action = 'study_approved' AND details->>'study_name' = ${q(name)}`)).toBe('1')
    await adminCtx.close()
  })
})

test.describe('owner powers', () => {
  test('owner manages editors/viewers but cannot assign owners or delete the study', async ({ page }) => {
    await signIn(page, 'owner')
    const id = await openStudy(page, TEAM_STUDY)

    // No study delete for owners
    await expect(page.getByRole('button', { name: /delete study/i })).toHaveCount(0)

    await page.goto(teamUrl(id))
    await expect(page.getByTestId('member-row').first()).toBeVisible()
    // Owner rows are read-only for owners, and "Owner" is never offered (add control or member rows)
    const ownerRow = page.getByTestId('member-row').filter({ hasText: ACCOUNTS.owner })
    await expect(ownerRow.getByRole('combobox')).toHaveCount(0)
    for (const select of await page.getByRole('combobox', { name: /role/i }).all()) {
      await expect(select.locator('option', { hasText: /^owner$/i })).toHaveCount(0)
    }

    // Owner adds the no-access researcher as editor, then changes them to viewer, then removes them
    await addToTeam(page, ACCOUNTS.researcher, 'editor')
    await expect.poll(() => sql(`SELECT role FROM study_members WHERE study_id = ${q(id)}
      AND user_id = (SELECT id FROM auth.users WHERE email = ${q(ACCOUNTS.researcher)})`)).toBe('editor')

    const member = page.getByTestId('member-row').filter({ hasText: ACCOUNTS.researcher })
    await member.getByRole('combobox', { name: /^role for/i }).selectOption('viewer')
    await page.getByRole('dialog').getByRole('button', { name: /change role/i }).click()
    await expect.poll(() => sql(`SELECT role FROM study_members WHERE study_id = ${q(id)}
      AND user_id = (SELECT id FROM auth.users WHERE email = ${q(ACCOUNTS.researcher)})`)).toBe('viewer')

    await member.getByRole('button', { name: /^actions for/i }).click()
    await page.getByRole('menuitem', { name: /remove from study/i }).click()
    await page.getByRole('dialog').getByRole('button', { name: /^remove$/i }).click()
    await expect.poll(() => sql(`SELECT count(*) FROM study_members WHERE study_id = ${q(id)}
      AND user_id = (SELECT id FROM auth.users WHERE email = ${q(ACCOUNTS.researcher)})`)).toBe('0')
  })

  test('the database refuses owner-role changes from an owner even if the UI is bypassed', async () => {
    const env = localSupabaseEnv()
    const client = createClient(env.url, env.anonKey, { auth: { persistSession: false } })
    const { error: signInError } = await client.auth.signInWithPassword({ email: ACCOUNTS.owner, password: TEST_PASSWORD })
    expect(signInError).toBeNull()
    const id = studyId(TEAM_STUDY)
    const researcherId = sql(`SELECT id FROM auth.users WHERE email = ${q(ACCOUNTS.researcher)}`)

    const promote = await client.from('study_members').insert({ study_id: id, user_id: researcherId, role: 'owner' })
    expect(promote.error).not.toBeNull()
    const deleteStudy = await client.from('studies').delete().eq('id', id).select()
    expect(deleteStudy.data ?? []).toHaveLength(0)
    expect(sql(`SELECT count(*) FROM studies WHERE id = ${q(id)}`)).toBe('1')
  })
})

test.describe('editor and viewer', () => {
  test('editors and viewers have no Team tab; the database refuses an editor adding people', async ({ page }) => {
    await signIn(page, 'editor')
    const id = await openStudy(page, TEAM_STUDY)
    await page.goto(`/studies/${id}/settings`)
    await expect(page.getByRole('button', { name: /delete study/i })).toHaveCount(0)
    const tabs = page.getByRole('navigation', { name: /settings sections/i })
    await expect(tabs.getByRole('link', { name: 'General' })).toBeVisible()
    await expect(tabs.getByRole('link', { name: 'Team' })).toHaveCount(0)
    await expect(page.getByText(/owner: owner@detectmind\.test/i)).toBeVisible()
    // The Team address sends them back to General
    await page.goto(teamUrl(id))
    await expect(page).toHaveURL(new RegExp(`/studies/${id}/settings$`))

    const env = localSupabaseEnv()
    const client = createClient(env.url, env.anonKey, { auth: { persistSession: false } })
    expect((await client.auth.signInWithPassword({ email: ACCOUNTS.editor, password: TEST_PASSWORD })).error).toBeNull()
    const researcherId = sql(`SELECT id FROM auth.users WHERE email = ${q(ACCOUNTS.researcher)}`)
    const add = await client.from('study_members').insert({ study_id: id, user_id: researcherId, role: 'viewer' })
    expect(add.error).not.toBeNull()
    expect(sql(`SELECT count(*) FROM study_members WHERE study_id = ${q(id)} AND user_id = ${q(researcherId)}`)).toBe('0')
  })

  test('viewer is read-only', async ({ page }) => {
    await signIn(page, 'viewer')
    const id = await openStudy(page, TEAM_STUDY)
    await expect(page.getByRole('button', { name: /^save|delete study|add to study|invite/i })).toHaveCount(0)
    await page.goto(`/studies/${id}/config`)
    await expect(page.getByRole('button', { name: /^save/i })).toHaveCount(0)
  })

  test('members only see their own studies', async ({ page }) => {
    await signIn(page, 'viewer')
    await page.goto('/studies')
    await expect(page.getByText(TEAM_STUDY).first()).toBeVisible()
    await expect(page.getByText(OTHER_STUDY)).toHaveCount(0)
  })

  test('a researcher with no memberships sees no studies or admin pages', async ({ page }) => {
    await signIn(page, 'researcher')
    await page.goto('/studies')
    await expect(page.getByText(TEAM_STUDY)).toHaveCount(0)
    for (const path of ['/admin/approvals', '/admin/people']) {
      await page.goto(path)
      await expect(page.getByText(/admins only|not authori[sz]ed|only admins/i).first()).toBeVisible()
    }
  })
})

test.describe('admin', () => {
  test('admin assigns a new owner on the Team tab and deletes the study with a reason', async ({ page }) => {
    const name = `E2E deletable ${Date.now()}`
    sql(`INSERT INTO studies (name, status) VALUES (${q(name)}, 'active')`)
    const id = studyId(name)

    await signIn(page, 'admin')
    // Admin → Studies links to the study's team; owners are managed only there
    await page.goto('/admin/studies')
    const row = page.getByTestId('study-row').filter({ hasText: name })
    await expect(row.getByRole('button', { name: /assign owner|delete/i })).toHaveCount(0)
    await row.getByRole('button', { name: /^actions for/i }).click()
    await page.getByRole('menuitem', { name: /manage team/i }).click()
    await expect(page).toHaveURL(new RegExp(teamUrl(id)))

    await addToTeam(page, ACCOUNTS.editor, 'owner')
    await page.getByRole('dialog').getByRole('button', { name: /add as owner/i }).click()
    await expect.poll(() => sql(`SELECT m.role FROM study_members m JOIN studies s ON s.id = m.study_id
      JOIN auth.users u ON u.id = m.user_id WHERE s.name = ${q(name)} AND u.email = ${q(ACCOUNTS.editor)}`)).toBe('owner')
    await expect(page.getByTestId('member-row').filter({ hasText: ACCOUNTS.editor })).toBeVisible()

    // Deleting lives in Settings → General (danger zone)
    await page.goto(`/studies/${id}/settings`)
    await page.getByRole('button', { name: /delete study/i }).click()
    const del = page.getByRole('dialog')
    await del.getByLabel(/reason/i).fill('e2e cleanup')
    await del.getByRole('textbox').last().fill(name)
    await del.getByRole('button', { name: /delete study/i }).click()
    await page.waitForURL(/\/studies\/?$/)
    await expect.poll(() => sql(`SELECT count(*) FROM studies WHERE name = ${q(name)}`)).toBe('0')
    expect(sql(`SELECT details->>'reason' FROM audit_log WHERE action = 'study_deleted' AND details->>'study_name' = ${q(name)}`)).toBe('e2e cleanup')
  })

  test('an admin rejects a pending study with a required reason', async ({ page }) => {
    const name = `E2E reject ${Date.now()}`
    sql(`INSERT INTO studies (name, status) VALUES (${q(name)}, 'draft')`)

    await signIn(page, 'admin')
    await page.goto('/admin/approvals')
    const card = page.getByTestId('approval-card').filter({ hasText: name })
    await card.getByRole('button', { name: /^reject$/i }).click()
    const dialog = page.getByRole('dialog')
    await dialog.getByRole('button', { name: /reject study/i }).click()
    await expect(dialog.getByText(/enter a reason/i)).toBeVisible()
    await dialog.getByLabel(/reason/i).fill('duplicate')
    await dialog.getByRole('button', { name: /reject study/i }).click()
    await expect.poll(() => sql(`SELECT count(*) FROM studies WHERE name = ${q(name)}`)).toBe('0')
    expect(sql(`SELECT details->>'reason' FROM audit_log WHERE action = 'study_deleted' AND details->>'study_name' = ${q(name)}`)).toBe('Rejected: duplicate')
  })

  test('promoting someone to admin asks for confirmation', async ({ page }) => {
    await signIn(page, 'admin')
    await page.goto('/admin/people')
    await page.getByRole('searchbox', { name: /search people/i }).fill(ACCOUNTS.viewer)
    const row = page.getByTestId('researcher-row').filter({ hasText: ACCOUNTS.viewer }).first()
    await row.getByRole('button', { name: /^actions for/i }).click()
    await page.getByRole('menuitem', { name: /make admin/i }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog).toContainText(/admin/i)
    await dialog.getByRole('button', { name: /cancel/i }).click()
    expect(sql(`SELECT r.role FROM researchers r JOIN auth.users u ON u.id = r.user_id WHERE u.email = ${q(ACCOUNTS.viewer)}`)).toBe('researcher')
  })

  test('people list: one-word status and separate invite / password-reset actions', async ({ page }) => {
    await signIn(page, 'admin')
    await page.goto('/admin/people')
    // The owner account: no other test reads its mailbox
    const row = page.getByTestId('researcher-row').filter({ hasText: ACCOUNTS.owner }).first()
    await expect(row).toContainText('Active')
    await row.getByRole('button', { name: /^actions for/i }).click()
    await expect(page.getByRole('menuitem', { name: /resend invite/i })).toHaveCount(0)
    await page.getByRole('menuitem', { name: /send password reset/i }).click()
    await expect(page.getByText(/password reset link sent/i)).toBeVisible()
  })
})
