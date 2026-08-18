import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { parse } from '@babel/parser'
import { describe, expect, it } from 'vitest'
import id from '../../public/locales/id.json'
import nl from '../../public/locales/nl.json'

// test-plan.md §7 "i18n completeness": grep for literal Indonesian or
// Dutch text in components, so a translated string pasted straight into
// JSX instead of routed through t(...) fails the build instead of
// shipping untranslatable text.
//
// `src/dev/**` is exempt: it is a local-only fixture sign-in switcher
// (see its own module comment) that is stripped from production builds
// and deliberately never localized.
const SRC_ROOT = join(__dirname, '../../src')
const EXCLUDED_DIRS = new Set(['dev'])
const MIN_MATCH_LENGTH = 4

function flattenLocaleValues(obj: unknown, out: Set<string>): Set<string> {
  for (const value of Object.values(obj as Record<string, unknown>)) {
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      flattenLocaleValues(value, out)
    } else if (typeof value === 'string') {
      const trimmed = value.trim()
      // Strings carrying a `{{placeholder}}` cannot appear verbatim as a
      // literal in source — only their interpolated result could, which
      // this check cannot predict — so they would never match anything
      // and are skipped rather than asserting nothing.
      if (trimmed.length >= MIN_MATCH_LENGTH && !trimmed.includes('{{')) {
        out.add(trimmed)
      }
    }
  }
  return out
}

function collectSourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (EXCLUDED_DIRS.has(entry)) continue
    const full = join(dir, entry)
    const stat = statSync(full)
    if (stat.isDirectory()) {
      collectSourceFiles(full, out)
    } else if (/\.(ts|tsx)$/.test(entry) && !entry.endsWith('.d.ts') && entry !== 'database.types.ts') {
      out.push(full)
    }
  }
  return out
}

interface Hit {
  file: string
  line: number
  text: string
}

// Babel's node shape is untyped here on purpose — this walks whatever the
// parser hands back rather than pulling in `@babel/types` for a handful of
// node kinds.
interface BabelNode {
  type?: string
  value?: string
  loc?: { start: { line: number } }
  [key: string]: unknown
}

function findHardcodedLocaleText(filePath: string, localeValues: Set<string>): Hit[] {
  const sourceText = readFileSync(filePath, 'utf8')
  const ast = parse(sourceText, {
    sourceType: 'module',
    plugins: ['jsx', 'typescript'],
  })
  const hits: Hit[] = []
  const seen = new Set<BabelNode>()

  function check(node: BabelNode, rawText: string) {
    const trimmed = rawText.trim()
    if (trimmed.length >= MIN_MATCH_LENGTH && localeValues.has(trimmed)) {
      hits.push({ file: filePath, line: node.loc?.start.line ?? 0, text: trimmed })
    }
  }

  function visit(node: unknown) {
    if (node === null || typeof node !== 'object') return
    if (Array.isArray(node)) {
      for (const item of node) visit(item)
      return
    }
    const n = node as BabelNode
    if (typeof n.type !== 'string' || seen.has(n)) return
    seen.add(n)

    if ((n.type === 'JSXText' || n.type === 'StringLiteral') && typeof n.value === 'string') {
      check(n, n.value)
    }

    for (const key of Object.keys(n)) {
      if (key === 'loc' || key === 'start' || key === 'end' || key === 'range') continue
      visit(n[key])
    }
  }

  visit(ast.program)
  return hits
}

describe('no hardcoded locale text in components', () => {
  it('every component string that matches a translated value is routed through t(...)', () => {
    const localeValues = flattenLocaleValues(id, flattenLocaleValues(nl, new Set()))
    const files = collectSourceFiles(SRC_ROOT)

    const hits = files.flatMap((file) => findHardcodedLocaleText(file, localeValues))

    const message = hits
      .map((h) => `${h.file.replace(SRC_ROOT, 'src')}:${h.line} — "${h.text}"`)
      .join('\n')

    expect(hits, `found translated text pasted directly into source instead of t(...):\n${message}`).toEqual([])
  })
})
