import { createContext, useContext, useMemo, useState, type ReactNode } from 'react'

export type Language = 'es' | 'en' | 'pt'

const STORAGE_KEY = 'dns-speed-lab-language'

const esTranslations = {
  'app.title': 'DNSpect',
  'app.subtitle':
    'Benchmark local de DNS real para elegir el resolver mas rapido y estable en minutos.',

  'header.themeLight': 'Tema claro',
  'header.themeDark': 'Tema oscuro',
  'header.themeToggleToLight': 'Cambiar a claro',
  'header.themeToggleToDark': 'Cambiar a oscuro',
  'header.language': 'Idioma',

  'controls.title': 'Flujo guiado',
  'controls.subtitle': 'Inicia rapido y abre opciones avanzadas solo cuando las necesites.',
  'controls.mode': 'Modo',
  'controls.timeoutPreset': 'Timeout',
  'controls.timeoutLow': 'Bajo',
  'controls.timeoutMedium': 'Medio',
  'controls.timeoutHigh': 'Alto',
  'controls.modeQuick': 'Rapido',
  'controls.modeStandard': 'Estandar',
  'controls.modeExhaustive': 'Exhaustivo',
  'controls.start': 'Iniciar benchmark',
  'controls.selectedResolvers': 'Resolvers incluidos: {{count}}',
  'controls.openAdvanced': 'Mostrar opciones avanzadas',
  'controls.closeAdvanced': 'Ocultar opciones avanzadas',
  'controls.advancedTitle': 'Opciones avanzadas',
  'controls.advancedSubtitle': 'Ajusta parametros, consultas y seleccion de resolvers sin salir de esta vista.',
  'controls.runs': 'Runs',
  'controls.timeoutSeconds': 'Timeout (s)',
  'controls.queries': 'Consultas (una por linea)',
  'controls.queriesPlaceholder': 'example.com\ncloudflare.com\nwikipedia.org',

  'group.global': 'Global',
  'group.privacy': 'Privacidad',
  'group.latam': 'LATAM/Chile',
  'group.isp': 'ISP detectados',

  'systemDns.title': 'DNS detectados del sistema',
  'systemDns.method': 'Metodo',
  'systemDns.platform': 'Plataforma',
  'systemDns.none': 'No se detectaron resolvers locales.',

  'error.initialData': 'Error cargando datos iniciales',
  'error.benchmarkPoll': 'Error consultando benchmark',
  'error.benchmarkStart': 'No se pudo iniciar benchmark',
  'error.samples': 'No se pudieron cargar las muestras',
  'error.title': 'No se pudo completar la accion:',
  'error.hint1': 'Verifica que el backend este activo y sin bloqueo de red.',
  'error.hint2': 'Reduce timeout o cantidad de resolvers si el equipo esta saturado.',
  'error.hint3': 'Reintenta la prueba en unos segundos.',

  'status.title': 'Estado del benchmark',
  'status.label': 'Estado',
  'status.engine': 'Motor',
  'status.pending': 'pendiente',
  'status.runningHint': 'Ejecutando consultas. Manten esta ventana abierta hasta completar el 100%.',
  'status.errorHint': 'El benchmark reporto error: {{error}}',
  'status.progress': 'Progreso: {{current}}/{{total}} ({{pct}}%)',
  'status.currentResolver': 'Resolver actual: {{resolver}}',

  'nextActions.title': 'Siguientes acciones',
  'nextActions.applyRecommendation': 'Aplicar recomendacion',
  'nextActions.downloadSummary': 'Descargar resumen',
  'nextActions.viewDetail': 'Ver detalle',

  'recommendation.title': 'Recomendacion',
  'recommendation.primary': 'Primario sugerido: {{resolver}}',
  'recommendation.secondary': 'Secundario sugerido: {{resolver}}',
  'recommendation.copy': 'Recomendado para un equilibrio entre velocidad, estabilidad y fallos minimos.',

  'summary.title': 'Resumen rapido',
  'summary.fast': 'Rapido',
  'summary.stable': 'Estable',
  'summary.reliable': 'Confiable',
  'summary.na': 'NA',

  'guide.title': 'Como leer los resultados',
  'guide.line1': 'Mediana: latencia tipica. p95: estabilidad en escenarios malos. Timeouts: fallos por demora.',
  'guide.line2': 'Nota: hacer ping al DNS no mide resolucion DNS; esta app si mide tiempo real de consulta.',

  'filters.title': 'Filtros de ranking',
  'filters.searchLabel': 'Buscar (IP, proveedor, tags)',
  'filters.searchPlaceholder': 'ej: cloudflare, 1.1.1.1, privacidad',
  'filters.onlyReliable': 'Solo confiables (timeout_rate <= 0.20)',
  'filters.naLast': 'Mostrar NA al final',
  'filters.empty': 'No hay resultados para los filtros aplicados. Ajusta busqueda o desactiva filtros.',

  'results.title': 'Ranking',
  'results.subtitle': 'Ordenado por mediana, luego p95 y cantidad de timeouts.',
  'results.empty': 'No hay resultados para mostrar.',
  'results.colDns': 'DNS',
  'results.colProvider': 'Proveedor',
  'results.colMedian': 'Mediana',
  'results.colP95': 'p95',
  'results.colAverage': 'Promedio',
  'results.colTimeouts': 'Timeouts',
  'results.colOk': 'OK',
  'results.colDetail': 'Detalle',
  'results.recommendedPrimary': 'Primario recomendado',
  'results.recommendedSecondary': 'Secundario recomendado',
  'results.viewDetail': 'Ver detalle',

  'charts.title': 'Graficos',
  'charts.subtitle': 'Comparativa Top-N por mediana.',
  'charts.show': 'Mostrar',
  'charts.top10': 'Top 10',
  'charts.top15': 'Top 15',
  'charts.all': 'Todos',
  'charts.resolversByMedian': 'resolvers por mediana',
  'charts.empty': 'No hay datos para graficar con los filtros actuales.',
  'charts.medianByResolver': 'Mediana por resolver',

  'exports.title': 'Exportar',
  'exports.csv': 'Descargar CSV',
  'exports.jsonSummary': 'Descargar JSON (resumen)',
  'exports.jsonSamples': 'Descargar JSON (con muestras)',

  'noRanking.title': 'Sin datos de ranking',
  'noRanking.text': 'La prueba termino sin resultados utilizables. Reintenta con mas timeout o menos resolvers.',

  'modal.title': 'Detalle del resolver {{resolver}}',
  'modal.close': 'Cerrar',
  'modal.provider': 'Proveedor',
  'modal.noDescription': 'Sin descripcion.',
  'modal.median': 'Mediana',
  'modal.p95': 'p95',
  'modal.average': 'Promedio',
  'modal.minMax': 'Min/Max',
  'modal.ok': 'OK',
  'modal.timeouts': 'Timeouts',
  'modal.samplesSummary': 'Este benchmark se cargo en modo resumen, por eso no hay muestras detalladas todavia.',
  'modal.loadSamples': 'Cargar muestras',
  'modal.loadingSamples': 'Cargando muestras...',
  'modal.timeSeries': 'Serie temporal por corrida',
  'modal.histogram': 'Distribucion (histograma)',
} as const

export type TranslationKey = keyof typeof esTranslations

type TranslationParams = Record<string, number | string>
type TranslationDict = Partial<Record<TranslationKey, string>>

export const translations: { es: Record<TranslationKey, string>; en: TranslationDict; pt: TranslationDict } = {
  es: esTranslations,
  en: {
    'app.subtitle': 'Local DNS resolution benchmark (not ping). Compare latency, consistency, and timeouts clearly.',
    'header.themeLight': 'Light theme',
    'header.themeDark': 'Dark theme',
    'header.themeToggleToLight': 'Switch to light',
    'header.themeToggleToDark': 'Switch to dark',
    'header.language': 'Language',
    'controls.start': 'Start benchmark',
    'controls.openAdvanced': 'Show advanced options',
    'controls.closeAdvanced': 'Hide advanced options',
    'nextActions.applyRecommendation': 'Apply recommendation',
    'results.viewDetail': 'View details',
    'charts.title': 'Charts',
  },
  pt: {
    'app.subtitle': 'Benchmark local de resolucao DNS real (sem ping). Compare latencia, consistencia e timeouts.',
    'header.themeLight': 'Tema claro',
    'header.themeDark': 'Tema escuro',
    'header.themeToggleToLight': 'Mudar para claro',
    'header.themeToggleToDark': 'Mudar para escuro',
    'header.language': 'Idioma',
    'controls.start': 'Iniciar benchmark',
    'controls.openAdvanced': 'Mostrar opcoes avancadas',
    'controls.closeAdvanced': 'Ocultar opcoes avancadas',
  },
}

interface I18nContextValue {
  language: Language
  setLanguage: (language: Language) => void
  t: (key: TranslationKey, params?: TranslationParams) => string
}

const I18nContext = createContext<I18nContextValue | undefined>(undefined)

function interpolate(template: string, params?: TranslationParams): string {
  if (!params) return template
  return template.replace(/{{\s*([a-zA-Z0-9_]+)\s*}}/g, (_, token: string) => {
    const value = params[token]
    return value === undefined ? '' : String(value)
  })
}

function detectInitialLanguage(): Language {
  const stored = window.localStorage.getItem(STORAGE_KEY)
  if (stored === 'es' || stored === 'en' || stored === 'pt') return stored
  const candidate = window.navigator.language.slice(0, 2).toLowerCase()
  if (candidate === 'en' || candidate === 'pt') return candidate
  return 'es'
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [language, setLanguage] = useState<Language>(() => detectInitialLanguage())

  const value = useMemo<I18nContextValue>(
    () => ({
      language,
      setLanguage: (nextLanguage) => {
        setLanguage(nextLanguage)
        window.localStorage.setItem(STORAGE_KEY, nextLanguage)
      },
      t: (key, params) => {
        const localized = translations[language][key] ?? translations.es[key]
        return interpolate(localized, params)
      },
    }),
    [language],
  )

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

export function useI18n(): I18nContextValue {
  const context = useContext(I18nContext)
  if (!context) throw new Error('useI18n must be used within I18nProvider')
  return context
}
