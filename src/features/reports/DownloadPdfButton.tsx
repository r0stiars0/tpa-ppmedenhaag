import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { getErrorMessage } from '../../lib/errors'
import { fetchReportPdfUrl } from './api'

/**
 * FR-005 download. The signed URL is fetched on click rather than up
 * front: it lives for 5 minutes (TAD Storage section), so minting one
 * while rendering a list would hand out links that are already stale by
 * the time anyone uses them.
 */
export function DownloadPdfButton({ reportId }: { reportId: string }) {
  const { t } = useTranslation()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleClick() {
    setLoading(true)
    setError(null)
    try {
      const url = await fetchReportPdfUrl(reportId)
      window.open(url, '_blank', 'noopener,noreferrer')
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div>
      <button
        type="button"
        onClick={() => void handleClick()}
        disabled={loading}
        className="min-h-11 w-full rounded-lg border border-ppme-primary px-4 font-semibold text-ppme-primary hover:bg-ppme-bg-alt disabled:opacity-60"
      >
        {loading ? t('reports.generatingPdf') : t('reports.downloadPdf')}
      </button>
      {error && <p className="mt-2 text-sm text-ppme-danger">{error}</p>}
    </div>
  )
}
