import { useTranslation } from 'react-i18next'
import type { Mark } from '../../lib/attendanceStats'

/**
 * One mark on an attendance strip (TAD ADR-046(c)). Shape carries the
 * meaning, colour only says whose attendance it is — students in primary
 * blue, tutors in the tutor orange — and every strip shows
 * `AttendanceLegend`, so nothing depends on colour alone. Absent is a
 * neutral grey cross: red stays for errors.
 */
export function AttendanceMark({
  mark,
  tone,
  size = 12,
}: {
  mark: Mark
  tone: 'student' | 'tutor'
  size?: number
}) {
  const color = tone === 'student' ? 'var(--color-ppme-primary)' : 'var(--color-ppme-tutor)'
  const c = size / 2
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true" className="shrink-0">
      {mark === 'present' && <circle cx={c} cy={c} r={c - 1} fill={color} />}
      {mark === 'late' && <circle cx={c} cy={c} r={c - 2} fill="#ffffff" stroke={color} strokeWidth={2} />}
      {mark === 'absent' && (
        <path
          d={`M${2} ${2} L${size - 2} ${size - 2} M${size - 2} ${2} L${2} ${size - 2}`}
          stroke="#4b5563"
          strokeWidth={2}
          strokeLinecap="round"
        />
      )}
      {mark === 'notRecorded' && (
        <circle cx={c} cy={c} r={c - 2} fill="none" stroke="#6b7280" strokeWidth={1.5} strokeDasharray="2 2" />
      )}
      {mark === 'noSession' && <circle cx={c} cy={c} r={1.5} fill="#d1d5db" />}
    </svg>
  )
}

/** The worded key under every strip. */
export function AttendanceLegend({
  tone,
  marks,
}: {
  tone: 'student' | 'tutor'
  marks: readonly Mark[]
}) {
  const { t } = useTranslation()
  return (
    <ul className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-ppme-text/70">
      {marks.map((mark) => (
        <li key={mark} className="flex items-center gap-1">
          <AttendanceMark mark={mark} tone={tone} />
          {markLabel(mark, t)}
        </li>
      ))}
    </ul>
  )
}

export function markLabel(mark: Mark, t: (key: string) => string): string {
  switch (mark) {
    case 'present':
      return t('attendance.present')
    case 'late':
      return t('attendance.late')
    case 'absent':
      return t('attendance.notPresent')
    case 'notRecorded':
      return t('attendance.markNotRecorded')
    case 'noSession':
      return t('attendance.markNoSession')
  }
}
