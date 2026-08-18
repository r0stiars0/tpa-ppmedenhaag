import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import HttpBackend from 'i18next-http-backend'
import LanguageDetector from 'i18next-browser-languagedetector'

// Bahasa Indonesia is primary (PRD §1 Technical Principles); Dutch is
// secondary. Islamic/Arabic terms (Murajaah, Yanbu'a, Surah, Ayah, ...)
// are intentionally left untranslated in both locale files.
void i18n
  .use(HttpBackend)
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    fallbackLng: 'id',
    supportedLngs: ['id', 'nl'],
    backend: {
      loadPath: '/locales/{{lng}}.json',
    },
    detection: {
      order: ['localStorage', 'navigator'],
      caches: ['localStorage'],
      lookupLocalStorage: 'tpa_locale',
    },
    interpolation: {
      escapeValue: false,
    },
  })

export default i18n
