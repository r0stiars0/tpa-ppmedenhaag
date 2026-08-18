import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { getErrorMessage } from '../../lib/errors'
import { fetchYanbuaHistory } from '../yanbua/api'
import { fetchQuranHistory, fetchSurahs } from '../quran/api'
import { fetchAssignmentsForStudent } from '../murajaah/api'
import { findSurah, type SurahRef } from '../../lib/quran'

/**
 * FR-001's "links to that student's Yanbu'a/Quran/Murajaah history for
 * the period", in the form that's actually useful while grading: the
 * student's latest position in each of the three subjects, shown next to
 * the grade selects so the tutor doesn't have to leave the screen and go
 * tab-hopping to remember where the student got to.
 *
 * Read live rather than snapshotted — unlike the attendance numbers,
 * these aren't report fields, they're context for the person filling the
 * report in. Tutor-only: every query behind it is scoped by RLS to the
 * tutor's own class students.
 */
export function ProgressContextCard({ studentId }: { studentId: string }) {
  const { t } = useTranslation()
  const [lines, setLines] = useState<{ label: string; value: string }[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    setLines(null)
    Promise.all([
      fetchYanbuaHistory(studentId),
      fetchQuranHistory(studentId),
      fetchAssignmentsForStudent(studentId),
      fetchSurahs(),
    ])
      .then(([yanbua, quran, murajaah, surahs]) => {
        if (!active) return
        setLines([
          {
            label: t('reports.subjectYanbua'),
            value: yanbua[0]
              ? `Jilid ${yanbua[0].jilid} · ${t('common.page')} ${yanbua[0].page}`
              : '—',
          },
          {
            label: t('reports.subjectQuran'),
            value: quran[0] ? formatQuranPosition(quran[0].surah_num, quran[0].ayah_to, surahs) : '—',
          },
          {
            label: t('reports.subjectMurajaah'),
            value: t('reports.murajaahTargets', {
              active: murajaah.filter((m) => m.active).length,
              total: murajaah.length,
            }),
          },
        ])
      })
      .catch((err) => {
        if (active) setError(getErrorMessage(err))
      })
    return () => {
      active = false
    }
  }, [studentId, t])

  return (
    <section className="rounded-lg bg-white p-4 shadow-sm">
      <h3 className="text-sm font-semibold text-ppme-text/70">{t('reports.progressContext')}</h3>
      {error ? (
        <p className="mt-2 text-sm text-ppme-danger">{error}</p>
      ) : !lines ? (
        <p className="mt-2 text-sm text-ppme-text/60">{t('common.loading')}</p>
      ) : (
        <dl className="mt-2 space-y-1">
          {lines.map(({ label, value }) => (
            <div key={label} className="flex justify-between gap-3 text-sm">
              <dt className="text-ppme-text/60">{label}</dt>
              <dd className="text-right font-medium text-ppme-text">{value}</dd>
            </div>
          ))}
        </dl>
      )}
    </section>
  )
}

function formatQuranPosition(surahNum: number, ayahTo: number, surahs: SurahRef[]): string {
  const surah = findSurah(surahNum, surahs)
  return `${surah?.transliteration ?? `#${surahNum}`} : ${ayahTo}`
}
