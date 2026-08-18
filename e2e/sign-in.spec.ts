import { test, expect } from '@playwright/test'

// Scaffold only — the full E2E-01..E2E-10 suite (test-plan.md §5) needs
// fixture data and mocked Supabase JWTs, wired up alongside the features
// they exercise. This confirms the unauthenticated shell renders correctly.
test('unauthenticated visitor sees the Google sign-in screen', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('button', { name: /Google/i })).toBeVisible()
})
