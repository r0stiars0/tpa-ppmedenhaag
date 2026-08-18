import { useTranslation } from 'react-i18next'

const LANGUAGES = [
  { code: 'id', label: 'ID' },
  { code: 'nl', label: 'NL' },
] as const

export function LanguageToggle() {
  const { i18n, t } = useTranslation()

  return (
    <div className="flex items-center gap-1" role="group" aria-label={t('common.language')}>
      {LANGUAGES.map(({ code, label }) => (
        <button
          key={code}
          type="button"
          onClick={() => void i18n.changeLanguage(code)}
          aria-pressed={i18n.resolvedLanguage === code}
          className={`min-h-11 min-w-11 rounded-md px-3 text-sm font-semibold transition-colors ${
            i18n.resolvedLanguage === code
              ? 'bg-white text-ppme-primary'
              : 'text-white/80 hover:text-white'
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  )
}
