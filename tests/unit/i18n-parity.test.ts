import { describe, expect, it } from 'vitest'
import id from '../../public/locales/id.json'
import nl from '../../public/locales/nl.json'
import { ROLE_I18N_KEY } from '../../src/lib/roleLabels'

// test-plan.md §7 "i18n completeness": CI asserts id.json/nl.json have
// identical key sets, so a missing translation fails the build instead of
// shipping a blank string in production.
function flattenKeys(obj: unknown, prefix = ''): Set<string> {
  const keys = new Set<string>()
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    const path = prefix ? `${prefix}.${key}` : key
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      for (const nested of flattenKeys(value, path)) keys.add(nested)
    } else {
      keys.add(path)
    }
  }
  return keys
}

describe('i18n locale parity', () => {
  it('id.json and nl.json expose the same key set', () => {
    const idKeys = flattenKeys(id)
    const nlKeys = flattenKeys(nl)

    const onlyInId = [...idKeys].filter((k) => !nlKeys.has(k))
    const onlyInNl = [...nlKeys].filter((k) => !idKeys.has(k))

    expect(onlyInId, `keys missing from nl.json: ${onlyInId.join(', ')}`).toEqual([])
    expect(onlyInNl, `keys missing from id.json: ${onlyInNl.join(', ')}`).toEqual([])
  })

  it('every database role resolves to a key both locale files carry', () => {
    // `ROLE_I18N_KEY` exists because the schema's role names and the
    // community-facing terms are not the same words — the enum says
    // `tutor` and the app says Ustadz. That indirection is exactly where
    // a key can go stale without anything failing: the parity test above
    // compares the two files against each other, and would stay green
    // with a mapping that points at a key neither of them has. Rendering
    // one is a raw `roles.ustadz` on an admin screen.
    const idKeys = flattenKeys(id)
    const nlKeys = flattenKeys(nl)
    for (const [role, key] of Object.entries(ROLE_I18N_KEY)) {
      expect(idKeys, `${role} → ${key} missing from id.json`).toContain(key)
      expect(nlKeys, `${role} → ${key} missing from nl.json`).toContain(key)
    }
  })

  it('covers every role the database enum can hold, with no two sharing a label', () => {
    // The map is a `Record<UserRole, string>`, so a new enum value fails
    // to typecheck — but only once someone adds the enum value to
    // `database.types.ts`. This states the same thing at runtime, and
    // adds the part types cannot: four distinct roles must not collapse
    // onto three labels.
    expect(Object.keys(ROLE_I18N_KEY).sort()).toEqual(['admin', 'parent', 'student', 'tutor'])
    expect(new Set(Object.values(ROLE_I18N_KEY)).size).toBe(4)
  })
})
