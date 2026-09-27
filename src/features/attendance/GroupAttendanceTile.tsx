import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { groupSessionSeries, sparklinePoints, type SessionPoint } from '../../lib/attendanceStats'
import { fetchGroupSessionStats } from './api'

const WIDTH = 120
const HEIGHT = 44
const PAD = 5

/**
 * "Kehadiran santri" — the selected group's student attendance at a
 * glance, above the register (TAD ADR-046(a)). One number (the latest
 * recorded session), one sparkline (the last 8 recorded sessions), one
 * colour. Tapping it lists those sessions with their pooled average.
 *
 * Tutors and admins see it; it never includes tutor attendance. It is an
 * extra on a recording screen, so a failed read hides it rather than
 * showing an error next to the register. `refreshKey` changes after a
 * successful submit so the tile catches up with what was just recorded.
 */
export function GroupAttendanceTile({ classId, refreshKey }: { classId: string; refreshKey: number }) {
  const { t, i18n } = useTranslation()
  const [series, setSeries] = useState<ReturnType<typeof groupSessionSeries> | null>(null)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    let active = true
    fetchGroupSessionStats(classId)
      .then((rows) => {
        if (active) setSeries(groupSessionSeries(rows))
      })
      .catch(() => {
        if (active) setSeries(null)
      })
    return () => {
      active = false
    }
  }, [classId, refreshKey])

  useEffect(() => setOpen(false), [classId])

  const formatDate = useMemo(() => {
    const fmt = new Intl.DateTimeFormat(i18n.language === 'nl' ? 'nl-NL' : 'id-ID', {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
    })
    return (date: string) => fmt.format(new Date(`${date}T00:00:00`))
  }, [i18n.language])

  if (!series) return null

  if (!series.latest) {
    return (
      <div className="rounded-lg bg-white p-4 shadow-sm">
        <p className="text-sm font-semibold text-ppme-text/70">{t('attendance.groupTile')}</p>
        <p className="mt-1 text-sm text-ppme-text/60">{t('attendance.groupTileEmpty')}</p>
      </div>
    )
  }

  const latest: SessionPoint = series.latest
  const points = sparklinePoints(
    series.points.map((p) => p.rate),
    WIDTH,
    HEIGHT,
    PAD,
  )
  const [lx, ly] = points[points.length - 1]

  return (
    <div className="rounded-lg bg-white shadow-sm">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-3 rounded-lg p-4 text-left"
      >
        <span className="flex flex-col">
          <span className="text-sm font-semibold text-ppme-text/70">{t('attendance.groupTile')}</span>
          <span className="text-3xl font-bold leading-tight text-ppme-text">{latest.rate}%</span>
          <span className="text-xs text-ppme-text/70">
            {t('attendance.groupTileLatest', {
              date: formatDate(latest.date),
              attended: latest.attended,
              total: latest.total,
            })}
          </span>
        </span>
        <svg width={WIDTH} height={HEIGHT} viewBox={`0 0 ${WIDTH} ${HEIGHT}`} aria-hidden="true" className="shrink-0">
          {points.length > 1 && (
            <polyline
              points={points.map((p) => p.join(',')).join(' ')}
              fill="none"
              stroke="var(--color-ppme-primary)"
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          )}
          <circle cx={lx} cy={ly} r={4} fill="var(--color-ppme-primary)" stroke="#ffffff" strokeWidth={2} />
        </svg>
      </button>

      {open && (
        <div className="border-t border-black/5 px-4 pb-4 pt-3">
          <p className="text-xs font-semibold text-ppme-text/70">
            {t('attendance.groupTileAverage', { count: series.points.length, rate: series.average })}
          </p>
          <ul className="mt-2 space-y-1">
            {[...series.points].reverse().map((p) => (
              <li key={p.date} className="flex items-center justify-between text-sm">
                <span className="text-ppme-text/80">{formatDate(p.date)}</span>
                <span className="text-ppme-text/70">
                  <span className="font-semibold text-ppme-text">{p.rate}%</span>
                  {' · '}
                  {t('attendance.groupTileSessionRow', { attended: p.attended, total: p.total })}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
