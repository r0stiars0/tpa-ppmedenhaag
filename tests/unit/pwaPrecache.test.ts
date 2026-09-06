import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// The workbox `globPatterns` in vite.config.ts decides what the service
// worker precaches. It must include `json`, because `i18next-http-backend`
// fetches `/locales/{{lng}}.json` at runtime (src/i18n/index.ts) — leave
// them out and an offline or installed PWA paints the shell but renders
// every `t()` key raw. See TAD ADR-015(f) and test-plan §6.
const viteConfig = readFileSync(
  fileURLToPath(new URL('../../vite.config.ts', import.meta.url)),
  'utf8',
)

describe('workbox precache — vite.config.ts globPatterns', () => {
  const match = viteConfig.match(/globPatterns:\s*\[\s*'([^']+)'/)

  it('has a single glob pattern in an array literal', () => {
    expect(match, 'globPatterns should be a `[ "..." ]` literal').not.toBeNull()
  })

  it('precaches json (the i18n locale files)', () => {
    const glob = match![1]
    // e.g. **/*.{js,css,html,svg,png,ico,json}
    const exts = glob.match(/\{([^}]+)\}/)?.[1].split(',').map((s) => s.trim())
    expect(exts, `parsed extensions from ${JSON.stringify(glob)}`).toContain('json')
  })

  it('still precaches the app shell (js/css/html)', () => {
    const exts = match![1].match(/\{([^}]+)\}/)?.[1].split(',').map((s) => s.trim()) ?? []
    for (const shell of ['js', 'css', 'html']) expect(exts).toContain(shell)
  })
})
