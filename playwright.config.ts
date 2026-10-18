import { defineConfig, devices } from '@playwright/test'
import { localSupabaseEnv } from './e2e/support/local-supabase'

// End-to-end tests run the dashboard against a LOCAL Supabase stack
// (`npx supabase start`), never the hosted project. Test accounts exist only there.
const env = localSupabaseEnv()

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'e2e-report' }]],
  globalSetup: './e2e/support/global-setup.ts',
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] }, grepInvert: /@mobile/ },
    { name: 'mobile', use: { ...devices['Pixel 5'] }, grep: /@mobile/ },
  ],
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:3000/login',
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      NEXT_PUBLIC_SUPABASE_URL: env.url,
      NEXT_PUBLIC_SUPABASE_ANON_KEY: env.anonKey,
      SUPABASE_SERVICE_ROLE_KEY: env.serviceRoleKey,
    },
  },
})
