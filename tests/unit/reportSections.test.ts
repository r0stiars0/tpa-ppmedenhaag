import { describe, expect, it } from 'vitest'
import { planSections, publishDecision, sectionComplete } from '../../netlify/functions/lib/reportSections'

// PRD Feature 8 FR-008, TAD ADR-045(h), Resolved Decisions 27 and 34.

describe('planSections — which groups get a section on a draft report', () => {
  const groups = new Map([
    ['ga', { name: 'Aqidah 9–11 th', tracks_progress: false, tutor_ids: ['ta', 'tb'] }],
    ['gold', { name: 'Aqidah 7–9 th', tracks_progress: false, tutor_ids: ['tf'] }],
    ['gy', { name: 'Grup A', tracks_progress: true, tutor_ids: ['ty'] }],
    ['gnone', { name: 'Aqidah 12+', tracks_progress: false, tutor_ids: [] }],
  ])
  const base = {
    reports: [{ id: 'r1', student_id: 'ali', status: 'draft' as const }],
    groups,
    currentMemberships: new Map([['ali', ['gy', 'ga']]]),
    attendance: [
      { student_id: 'ali', class_id: 'ga', status: 'present' as const },
      { student_id: 'ali', class_id: 'ga', status: 'absent' as const },
      { student_id: 'ali', class_id: 'gold', status: 'late' as const },
      { student_id: 'ali', class_id: 'gy', status: 'present' as const },
    ],
    existing: new Set<string>(),
  }

  it('adds a section per non-tracking group the student attended this year or is in now', () => {
    const rows = planSections(base)
    expect(rows.map((r) => r.class_id).sort()).toEqual(['ga', 'gold'])
  })

  it('keeps a section for a group the child left mid-year (attendance in the year, no current membership)', () => {
    expect(planSections(base).find((r) => r.class_id === 'gold')).toMatchObject({ report_id: 'r1', tutor_id: 'tf' })
  })

  it('adds a section for a current non-tracking group even with no attendance yet', () => {
    const rows = planSections({ ...base, attendance: [], currentMemberships: new Map([['ali', ['gy', 'gnone']]]) })
    expect(rows).toEqual([
      expect.objectContaining({ class_id: 'gnone', tutor_id: null, attendance_present: 0, attendance_rate: 0 }),
    ])
  })

  it('never adds a section for a tracking group: that part is the report itself', () => {
    expect(planSections(base).some((r) => r.class_id === 'gy')).toBe(false)
  })

  it('counts attendance per group, not over the whole year', () => {
    expect(planSections(base).find((r) => r.class_id === 'ga')).toMatchObject({
      attendance_present: 1,
      attendance_absent: 1,
      attendance_late: 0,
      attendance_rate: 50,
    })
  })

  it('adds only missing sections on a re-run, and only to draft reports', () => {
    expect(planSections({ ...base, existing: new Set(['r1:ga']) }).map((r) => r.class_id)).toEqual(['gold'])
    expect(planSections({ ...base, reports: [{ id: 'r1', student_id: 'ali', status: 'published' }] })).toEqual([])
  })
})

describe('sectionComplete', () => {
  it('needs both a grade and a narrative', () => {
    expect(sectionComplete({ grade: 'jayyid', narrative: 'Baik' })).toBe(true)
    expect(sectionComplete({ grade: null, narrative: 'Baik' })).toBe(false)
    expect(sectionComplete({ grade: 'jayyid', narrative: '  ' })).toBe(false)
  })
})

describe('publishDecision — who publishes, and with which sections', () => {
  const filled = { class_name: 'Aqidah 9–11 th', tutor_name: 'Maryam', grade: 'mumtaz' as const, narrative: 'Hafal' }
  const empty = { class_name: 'Aqidah 7–9 th', tutor_name: 'Fauziah', grade: null, narrative: null }

  it('lets the author or an admin publish, and nobody else (Resolved Decision 34)', () => {
    expect(publishDecision({ isAuthor: true, isAdmin: false, sections: [filled], omitEmpty: false })).toMatchObject({ ok: true })
    expect(publishDecision({ isAuthor: false, isAdmin: true, sections: [filled], omitEmpty: false })).toMatchObject({ ok: true })
    expect(publishDecision({ isAuthor: false, isAdmin: false, sections: [filled], omitEmpty: false })).toEqual({
      ok: false,
      status: 403,
      missing: [],
    })
  })

  it('refuses while a section is empty, naming it', () => {
    expect(publishDecision({ isAuthor: true, isAdmin: false, sections: [filled, empty], omitEmpty: false })).toEqual({
      ok: false,
      status: 409,
      missing: ['Aqidah 7–9 th'],
    })
  })

  it('lets only an admin publish without the empty sections, which are then left out', () => {
    expect(publishDecision({ isAuthor: false, isAdmin: true, sections: [filled, empty], omitEmpty: true })).toEqual({
      ok: true,
      include: [filled],
      omitted: ['Aqidah 7–9 th'],
    })
    expect(publishDecision({ isAuthor: true, isAdmin: false, sections: [filled, empty], omitEmpty: true })).toMatchObject({
      ok: false,
      status: 409,
    })
  })
})
