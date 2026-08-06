import { createContext, useContext, useState, useCallback } from 'react'

type Locale = 'zh' | 'en'

import zhData from './locales/zh.json'
import enData from './locales/en.json'

const locales: Record<string, any> = { zh: zhData, en: enData }

interface I18nContextType {
  t: (key: string) => string
  locale: Locale
  switchLocale: () => void
}

const I18nContext = createContext<I18nContextType>({
  t: (key: string) => key,
  locale: 'zh',
  switchLocale: () => {},
})

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocale] = useState<Locale>('zh')

  const t = useCallback((key: string) => {
    const localeData = locales[locale]
    return localeData[key] || key
  }, [locale])

  const switchLocale = useCallback(() => {
    setLocale(prev => prev === 'zh' ? 'en' : 'zh')
  }, [])

  return (
    <I18nContext.Provider value={{ t, locale, switchLocale }}>
      {children}
    </I18nContext.Provider>
  )
}

export function useI18n() {
  return useContext(I18nContext)
}
