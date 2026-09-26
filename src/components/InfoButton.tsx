import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

/**
 * A small ⓘ button that opens a short explanation in a pop-up, for a
 * setting whose label has to stay short (e.g. the group form's
 * "Registratie Yanbu'a"). Tap again, tap outside, or press Escape to
 * close. Keep it out of any <label>: inside one, a tap would also toggle
 * the control the label belongs to.
 */
export function InfoButton({ title, children }: { title: string; children: ReactNode }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const wrapper = useRef<HTMLSpanElement>(null)
  const panelId = useId()

  useEffect(() => {
    if (!open) return
    function onPointer(e: PointerEvent) {
      if (wrapper.current && !wrapper.current.contains(e.target as Node)) setOpen(false)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', onPointer)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <span ref={wrapper} className="relative inline-flex">
      <button
        type="button"
        aria-label={t('common.moreInfo')}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((v) => !v)}
        className="flex h-11 w-11 items-center justify-center rounded-full text-ppme-primary hover:bg-ppme-bg-alt"
      >
        <svg aria-hidden viewBox="0 0 20 20" className="h-5 w-5" fill="currentColor">
          <path
            fillRule="evenodd"
            d="M10 18a8 8 0 1 0 0-16 8 8 0 0 0 0 16Zm.75-11.5a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0ZM9.25 9a.75.75 0 0 1 1.5 0v4.5a.75.75 0 0 1-1.5 0V9Z"
            clipRule="evenodd"
          />
        </svg>
      </button>
      {open && (
        <span
          id={panelId}
          role="note"
          className="absolute right-0 top-11 z-20 block w-72 max-w-[calc(100vw-2rem)] rounded-lg border border-black/10 bg-white p-3 text-left text-sm text-ppme-text shadow-lg"
        >
          <span className="block font-semibold">{title}</span>
          <span className="mt-1 block text-ppme-text/80">{children}</span>
        </span>
      )}
    </span>
  )
}
