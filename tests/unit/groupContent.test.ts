import { describe, expect, it } from 'vitest'
import { checkMaterialLink } from '../../src/lib/materialLinks'
import { linkify } from '../../src/lib/linkify'
import { MAX_MATERIAL_BYTES, checkMaterialFile, materialStoragePath, isEdited } from '../../src/lib/materialFiles'
import { groupContentNotice, orphanedMaterialObjects } from '../../netlify/functions/lib/groupContent'

// PRD Feature 8 FR-004/FR-005, TAD ADR-045(e)–(g). The database refuses
// a bad link or file on its own (RLS-151/152); these are the same rules
// on the client, so a tutor gets a message in words instead of an error.

describe('checkMaterialLink — the allow-list (PRD Resolved Decision 28)', () => {
  it.each([
    'https://docs.google.com/document/d/abc/edit',
    'https://docs.google.com/presentation/d/abc/edit?usp=sharing',
    'https://drive.google.com/file/d/abc/view',
    'https://onedrive.live.com/edit?id=ABC&cid=123',
  ])('accepts %s', (url) => {
    expect(checkMaterialLink(url)).toEqual({ ok: true, url, host: new URL(url).host })
  })

  it('trims surrounding whitespace before checking', () => {
    expect(checkMaterialLink('  https://drive.google.com/file/d/abc/view \n')).toMatchObject({ ok: true })
  })

  it.each([
    ['', 'empty'],
    ['https://1drv.ms/p/s!abc', 'shortOneDrive'],
    ['https://contoso.sharepoint.com/:p:/g/abc', 'sharepoint'],
    ['https://contoso-my.sharepoint.com/personal/x', 'sharepoint'],
    ['https://docs.google.com/forms/d/abc/viewform', 'googleForm'],
    ['https://forms.gle/abc', 'googleForm'],
    ['https://drive.google.com/drive/folders/abc', 'driveFolder'],
    ['http://docs.google.com/document/d/abc', 'notHttps'],
    ['javascript:alert(1)', 'notHttps'],
    ['https://docs.google.com/spreadsheets/d/abc', 'notAllowed'],
    ['https://docs.google.com.evil.example/document/d/abc', 'notAllowed'],
    ['https://example.com/slides.pptx', 'notAllowed'],
    ['not a url', 'notHttps'],
  ])('refuses %s as %s', (url, reason) => {
    expect(checkMaterialLink(url)).toEqual({ ok: false, reason })
  })
})

describe('linkify — announcement bodies (ADR-045 rendering rule)', () => {
  it('turns an https URL into a link showing its host', () => {
    expect(linkify('See https://docs.google.com/document/d/x for more')).toEqual([
      { kind: 'text', text: 'See ' },
      { kind: 'link', href: 'https://docs.google.com/document/d/x', host: 'docs.google.com' },
      { kind: 'text', text: ' for more' },
    ])
  })

  it('leaves trailing sentence punctuation out of the link', () => {
    expect(linkify('Open https://example.com/a.')).toEqual([
      { kind: 'text', text: 'Open ' },
      { kind: 'link', href: 'https://example.com/a', host: 'example.com' },
      { kind: 'text', text: '.' },
    ])
  })

  it('never links another scheme', () => {
    for (const text of ['javascript:alert(1)', 'http://example.com', 'data:text/html,<b>x</b>', 'mailto:a@b.c']) {
      expect(linkify(text)).toEqual([{ kind: 'text', text }])
    }
  })

  it('keeps line breaks and plain text as they are', () => {
    expect(linkify('Line 1\nLine 2')).toEqual([{ kind: 'text', text: 'Line 1\nLine 2' }])
    expect(linkify('')).toEqual([])
  })

  it('handles several links', () => {
    const parts = linkify('https://a.example/x and https://b.example/y')
    expect(parts.filter((p) => p.kind === 'link').map((p) => (p.kind === 'link' ? p.host : ''))).toEqual([
      'a.example',
      'b.example',
    ])
  })
})

describe('checkMaterialFile — PDF or PPTX, up to 20 MB (FR-005)', () => {
  const pptx = 'application/vnd.openxmlformats-officedocument.presentationml.presentation'

  it('accepts a PDF and a PPTX, and names the type Storage is told', () => {
    expect(checkMaterialFile({ name: 'a.pdf', size: 1000, type: 'application/pdf' })).toEqual({
      ok: true,
      mimeType: 'application/pdf',
    })
    expect(checkMaterialFile({ name: 'Deck.PPTX', size: 1000, type: pptx })).toEqual({ ok: true, mimeType: pptx })
  })

  it('goes by the extension when the browser reports no type (common for .pptx on phones)', () => {
    expect(checkMaterialFile({ name: 'deck.pptx', size: 10, type: '' })).toEqual({ ok: true, mimeType: pptx })
  })

  it('refuses any other type, including the old .ppt and a renamed file', () => {
    expect(checkMaterialFile({ name: 'a.docx', size: 10, type: 'application/msword' })).toEqual({ ok: false, reason: 'type' })
    expect(checkMaterialFile({ name: 'a.ppt', size: 10, type: 'application/vnd.ms-powerpoint' })).toEqual({ ok: false, reason: 'type' })
    expect(checkMaterialFile({ name: 'a.pdf', size: 10, type: 'image/png' })).toEqual({ ok: false, reason: 'type' })
  })

  it('refuses an empty file and one over 20 MB', () => {
    expect(MAX_MATERIAL_BYTES).toBe(20 * 1024 * 1024)
    expect(checkMaterialFile({ name: 'a.pdf', size: 0, type: 'application/pdf' })).toEqual({ ok: false, reason: 'empty' })
    expect(checkMaterialFile({ name: 'a.pdf', size: MAX_MATERIAL_BYTES + 1, type: 'application/pdf' })).toEqual({
      ok: false,
      reason: 'size',
    })
    expect(checkMaterialFile({ name: 'a.pdf', size: MAX_MATERIAL_BYTES, type: 'application/pdf' })).toMatchObject({ ok: true })
  })
})

describe('materialStoragePath — {class_id}/{material_id}/{file_name}', () => {
  it('puts the file in its group and material folder', () => {
    expect(materialStoragePath('c1', 'm1', 'Slide pertemuan 3.pptx')).toBe('c1/m1/Slide-pertemuan-3.pptx')
  })

  it('cannot escape its folder, whatever the file is called', () => {
    for (const name of ['../../other/x.pdf', 'a/b.pdf', '..\\x.pdf', '.hidden.pdf']) {
      const path = materialStoragePath('c1', 'm1', name)
      expect(path.startsWith('c1/m1/')).toBe(true)
      expect(path.split('/')).toHaveLength(3)
      expect(path.split('/')[2]).not.toMatch(/^\./)
    }
  })

  it('keeps the extension and gives an unnamed file a name', () => {
    expect(materialStoragePath('c1', 'm1', 'ringkasan (final).PDF')).toBe('c1/m1/ringkasan-final.PDF')
    expect(materialStoragePath('c1', 'm1', '.pdf')).toBe('c1/m1/file.pdf')
  })
})

describe('isEdited — the "diubah" label', () => {
  it('is false for a row never edited, true after an edit', () => {
    expect(isEdited({ created_at: '2026-09-20T10:00:00Z', updated_at: '2026-09-20T10:00:00Z' })).toBe(false)
    expect(isEdited({ created_at: '2026-09-20T10:00:00Z', updated_at: '2026-09-21T08:00:00Z' })).toBe(true)
  })
})

describe('groupContentNotice — what notify-group-content sends (ADR-045(g))', () => {
  it('an announcement: one notification per announcement, with its title for the in-app row only', () => {
    expect(
      groupContentNotice({
        table: 'group_announcements',
        id: 'a1',
        classId: 'c1',
        groupName: 'Aqidah 9–11 th',
        title: 'No class Sunday',
        createdAt: '2026-09-20T22:30:00Z',
      }),
    ).toEqual({
      event: 'groupAnnouncement',
      refId: 'a1',
      // Amsterdam date: 22:30 UTC on the 20th is already the 21st there.
      date: '2026-09-21',
      context: { title: 'No class Sunday', group: 'Aqidah 9–11 th' },
      group: 'Aqidah 9–11 th',
    })
  })

  it('a material: one notification per group per day, naming no title, file or link', () => {
    const notice = groupContentNotice({
      table: 'group_materials',
      id: 'm1',
      classId: 'c1',
      groupName: 'Aqidah 9–11 th',
      title: 'Slide 3',
      createdAt: '2026-09-20T09:00:00Z',
    })
    expect(notice).toEqual({
      event: 'newMaterial',
      refId: 'c1',
      date: '2026-09-20',
      context: { group: 'Aqidah 9–11 th' },
      group: 'Aqidah 9–11 th',
    })
  })
})

describe('orphanedMaterialObjects — the daily clean-up (ADR-045(f))', () => {
  const now = new Date('2026-09-26T03:00:00Z')

  it('picks objects no material points at, once they are over a day old', () => {
    const objects = [
      { name: 'c1/m1/a.pdf', created_at: '2026-09-20T10:00:00Z' }, // referenced
      { name: 'c1/m2/b.pdf', created_at: '2026-09-20T10:00:00Z' }, // orphan, old
      { name: 'c1/m3/c.pdf', created_at: '2026-09-26T01:00:00Z' }, // orphan, but may be mid-upload
    ]
    expect(orphanedMaterialObjects(objects, new Set(['c1/m1/a.pdf']), now)).toEqual(['c1/m2/b.pdf'])
  })
})
