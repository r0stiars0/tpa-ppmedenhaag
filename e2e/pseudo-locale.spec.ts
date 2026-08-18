import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test } from '@playwright/test'

const __dirname = dirname(fileURLToPath(import.meta.url))

// test-plan.md §7 "i18n completeness": pseudo-locale render test — no
// truncation at 44px tap targets with longer strings than either shipped
// locale has. Scoped to the sign-in screen, the one screen this project's
// E2E harness can reach without a mocked Supabase session (see
// sign-in.spec.ts's own comment on why the rest of the suite isn't built
// yet) — the same reason `pseudo-locale` isn't yet exercised against the
// family/tutor/admin screens.
//
// The pseudo-locale isn't invented text: for every key it takes whichever
// of the two real, shipped translations (id/nl) is longer, then pads it
// further so the check exercises something worse than either real locale
// ever will, rather than merely replaying today's longest string back at
// itself.
const PAD_RATIO = 0.35
const PAD_CHAR = '•' // bullet — wide in most UI fonts, and not a character either locale uses

type LocaleTree = { [key: string]: string | LocaleTree }

function pad(value: string): string {
  if (value.includes('{{')) return value // never corrupt an interpolation token
  const extra = Math.max(4, Math.ceil(value.length * PAD_RATIO))
  return `${value} ${PAD_CHAR.repeat(extra)}`
}

function buildPseudoLocale(id: LocaleTree, nl: LocaleTree): LocaleTree {
  const out: LocaleTree = {}
  for (const key of Object.keys(id)) {
    const idVal = id[key]
    const nlVal = nl[key]
    if (typeof idVal === 'object' && typeof nlVal === 'object') {
      out[key] = buildPseudoLocale(idVal, nlVal)
    } else if (typeof idVal === 'string' && typeof nlVal === 'string') {
      out[key] = pad(idVal.length >= nlVal.length ? idVal : nlVal)
    }
  }
  return out
}

const idLocale = JSON.parse(readFileSync(join(__dirname, '../public/locales/id.json'), 'utf8')) as LocaleTree
const nlLocale = JSON.parse(readFileSync(join(__dirname, '../public/locales/nl.json'), 'utf8')) as LocaleTree
const pseudoLocale = buildPseudoLocale(idLocale, nlLocale)

test('sign-in screen does not clip or overflow under a pseudo-locale worse than either shipped language', async ({
  page,
}) => {
  // 390px: the width test-plan.md's other manual verifications use for
  // family-screen tap targets.
  await page.setViewportSize({ width: 390, height: 844 })
  await page.addInitScript(() => localStorage.setItem('tpa_locale', 'id'))
  await page.route('**/locales/id.json', (route) => route.fulfill({ json: pseudoLocale }))

  await page.goto('/')

  const heading = page.locator('h1')
  const tagline = heading.locator('xpath=following-sibling::p[1]')
  const signInButton = page.getByRole('button').first()

  await expect(heading).toBeVisible()
  await expect(signInButton).toBeVisible()

  for (const locator of [heading, tagline, signInButton]) {
    const overflow = await locator.evaluate((el) => ({
      clipsHorizontally: el.scrollWidth > el.clientWidth + 1,
      clipsVertically: el.scrollHeight > el.clientHeight + 1,
      text: el.textContent,
    }))
    expect(overflow.clipsHorizontally, `"${overflow.text}" clips horizontally`).toBe(false)
    expect(overflow.clipsVertically, `"${overflow.text}" clips vertically`).toBe(false)
  }

  // The 44px tap target itself (`min-h-11` = 2.75rem): padding a real
  // string longer must never shrink it below the accessible minimum.
  const buttonBox = await signInButton.boundingBox()
  expect(buttonBox?.height ?? 0).toBeGreaterThanOrEqual(44)

  const pageOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
  )
  expect(pageOverflow, 'page has horizontal scroll under the pseudo-locale').toBe(false)
})
