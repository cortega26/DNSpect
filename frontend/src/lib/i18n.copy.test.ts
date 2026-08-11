import { describe, expect, it } from 'vitest'

import { translations } from './i18n-translations'

const COPY_REGRESSION = 'Copy regression: diacritics removed or altered'

type Locale = 'es' | 'pt'

describe('i18n completeness gate', () => {
  const esKeys = Object.keys(translations.es).sort()

  it('all ES keys exist in EN', () => {
    const enKeys = new Set(Object.keys(translations.en))
    const missing = esKeys.filter((k) => !enKeys.has(k))
    expect(missing, `EN missing ${missing.length} keys from ES`).toEqual([])
  })

  it('all ES keys exist in PT', () => {
    const ptKeys = new Set(Object.keys(translations.pt))
    const missing = esKeys.filter((k) => !ptKeys.has(k))
    expect(missing, `PT missing ${missing.length} keys from ES`).toEqual([])
  })

  it('no stale keys in EN that no longer exist in ES', () => {
    const esSet = new Set(esKeys)
    const extra = Object.keys(translations.en).filter((k) => !esSet.has(k))
    expect(extra, `EN has ${extra.length} stale keys`).toEqual([])
  })

  it('no stale keys in PT that no longer exist in ES', () => {
    const esSet = new Set(esKeys)
    const extra = Object.keys(translations.pt).filter((k) => !esSet.has(k))
    expect(extra, `PT has ${extra.length} stale keys`).toEqual([])
  })
})
type ContractEntry = [key: string, expected: string]

function assertCopyContract(locale: Locale, entries: ContractEntry[]) {
  const dict = translations[locale] as Record<string, string>
  entries.forEach(([key, expected]) => {
    expect(dict[key], 'Missing translation key in copy contract').toBeDefined()
    expect(dict[key], COPY_REGRESSION).toBe(expected)
  })
}

describe('i18n copy contract gate', () => {
  it('protects apply-in-system guide copy (ES/PT)', () => {
    assertCopyContract('es', [
      ['applyGuide.title', 'Aplicar en el sistema'],
      ['applyGuide.lead', 'Cambia tu DNS en el sistema o router para que el cambio sea real.'],
      ['applyGuide.detectedPlatform', 'Plataforma detectada: {{platform}}'],
      ['applyGuide.windowsTitle', 'Windows'],
      ['applyGuide.windowsStep1', 'Abre Configuración > Red e Internet.'],
      ['applyGuide.windowsStep2', 'Entra a Ethernet o Wi-Fi y edita la asignación DNS.'],
      ['applyGuide.windowsStep3', 'Ingresa DNS primario/secundario y guarda los cambios.'],
      ['applyGuide.macosTitle', 'macOS'],
      ['applyGuide.macosStep1', 'Abre Configuración del Sistema > Red.'],
      ['applyGuide.macosStep2', 'Selecciona tu red y abre Detalles > DNS.'],
      ['applyGuide.macosStep3', 'Agrega los DNS sugeridos, aplica y reconecta.'],
      ['applyGuide.linuxTitle', 'Linux'],
      ['applyGuide.linuxStep1', 'Abre la configuración de red de tu entorno.'],
      ['applyGuide.linuxStep2', 'Edita DNS en la conexión activa (IPv4/IPv6).'],
      ['applyGuide.linuxStep3', 'Guarda, reconecta y confirma la resolución DNS.'],
      ['applyGuide.routerTitle', 'Router'],
      ['applyGuide.routerStep1', 'Abre el panel del router en el navegador.'],
      ['applyGuide.routerStep2', 'Busca Internet/WAN y ubica los campos DNS.'],
      ['applyGuide.routerStep3', 'Guarda DNS primario/secundario y reinicia clientes.'],
    ])

    assertCopyContract('pt', [
      ['applyGuide.title', 'Aplicar no sistema'],
      ['applyGuide.lead', 'Altere seu DNS no sistema ou no roteador para que a mudança seja real.'],
      ['applyGuide.detectedPlatform', 'Plataforma detectada: {{platform}}'],
      ['applyGuide.windowsTitle', 'Windows'],
      ['applyGuide.windowsStep1', 'Abra Configurações > Rede e Internet.'],
      ['applyGuide.windowsStep2', 'Entre em Ethernet ou Wi-Fi e edite a atribuição de DNS.'],
      ['applyGuide.windowsStep3', 'Informe DNS primário/secundário e salve as alterações.'],
      ['applyGuide.macosTitle', 'macOS'],
      ['applyGuide.macosStep1', 'Abra Ajustes do Sistema > Rede.'],
      ['applyGuide.macosStep2', 'Selecione sua rede e abra Detalhes > DNS.'],
      ['applyGuide.macosStep3', 'Adicione os DNS sugeridos, aplique e reconecte.'],
      ['applyGuide.linuxTitle', 'Linux'],
      ['applyGuide.linuxStep1', 'Abra as configurações de rede do seu ambiente.'],
      ['applyGuide.linuxStep2', 'Edite DNS na conexão ativa (IPv4/IPv6).'],
      ['applyGuide.linuxStep3', 'Salve, reconecte e confirme a resolução DNS.'],
      ['applyGuide.routerTitle', 'Roteador'],
      ['applyGuide.routerStep1', 'Abra o painel do roteador no navegador.'],
      ['applyGuide.routerStep2', 'Procure Internet/WAN e os campos de DNS.'],
      ['applyGuide.routerStep3', 'Salve DNS primário/secundário e reinicie os clientes.'],
    ])
  })

  it('protects mode/timeout helper copy (ES/PT)', () => {
    assertCopyContract('es', [
      [
        'controls.modeHelp',
        'Rápido: resultados más rápidos, menor confianza. Estándar: equilibrio. Exhaustivo: más lento, mayor confianza.',
      ],
      [
        'controls.timeoutHelp',
        'Timeout bajo: más rápido, más falsos timeouts. Timeout alto: más lento, menos falsos timeouts.',
      ],
    ])

    assertCopyContract('pt', [
      [
        'controls.modeHelp',
        'Rápido: resultados mais rápidos, menor confiança. Padrão: equilíbrio. Exaustivo: mais lento, maior confiança.',
      ],
      [
        'controls.timeoutHelp',
        'Timeout baixo: mais rápido, mais falsos timeouts. Timeout alto: mais lento, menos falsos timeouts.',
      ],
    ])
  })

  it('protects workload summary terminology (ES/PT)', () => {
    assertCopyContract('es', [
      ['controls.workloadSummary', 'Alcance: {{resolvers}} resolvers × {{runs}} corridas · Timeout: {{timeout}}s · Estimado: {{eta}}'],
      ['controls.workloadSummaryNoEta', 'Alcance: {{resolvers}} resolvers × {{runs}} corridas · Timeout: {{timeout}}s'],
    ])

    assertCopyContract('pt', [
      ['controls.workloadSummary', 'Escopo: {{resolvers}} resolvers × {{runs}} execuções · Timeout: {{timeout}}s · Est: {{eta}}'],
      ['controls.workloadSummaryNoEta', 'Escopo: {{resolvers}} resolvers × {{runs}} execuções · Timeout: {{timeout}}s'],
    ])
  })

  it('protects export purpose labels (ES/PT)', () => {
    assertCopyContract('es', [
      ['exports.csvPurpose', 'Ideal para hojas de cálculo e informes.'],
      ['exports.jsonSummaryPurpose', 'Ideal para automatización y comparaciones reproducibles.'],
      ['exports.jsonSamplesPurpose', 'Ideal para análisis profundo y depuración de valores atípicos.'],
    ])

    assertCopyContract('pt', [
      ['exports.csvPurpose', 'Ideal para planilhas e relatórios.'],
      ['exports.jsonSummaryPurpose', 'Ideal para automação e comparações reproduzíveis.'],
      ['exports.jsonSamplesPurpose', 'Ideal para análise profunda e depuração de valores atípicos.'],
    ])
  })

  it('protects accessibility, region-scope, chart, and ranking copy (ES/PT)', () => {
    assertCopyContract('es', [
      ['accessibility.loading', 'Cargando'],
      ['region.auto', 'Auto'],
      ['region.global', 'Global'],
      ['region.europe', 'Europa'],
      ['region.southAmerica', 'Sudamérica'],
      ['region.northAmerica', 'Norteamérica'],
      ['region.asia', 'Asia'],
      ['charts.failureRate', 'Tasa de fallos: {{value}}%'],
      ['ranking.score', 'Puntuación {{value}}'],
      ['ranking.blocking', 'Bloqueo {{value}}%'],
      ['modal.descriptionSpanishOnly', 'La descripción de este proveedor solo está disponible en español.'],
    ])

    assertCopyContract('pt', [
      ['accessibility.loading', 'Carregando'],
      ['region.auto', 'Automático'],
      ['region.global', 'Global'],
      ['region.europe', 'Europa'],
      ['region.southAmerica', 'América do Sul'],
      ['region.northAmerica', 'América do Norte'],
      ['region.asia', 'Ásia'],
      ['charts.failureRate', 'Taxa de falhas: {{value}}%'],
      ['ranking.score', 'Pontuação {{value}}'],
      ['ranking.blocking', 'Bloqueio {{value}}%'],
      ['modal.descriptionSpanishOnly', 'A descrição deste provedor está disponível apenas em espanhol.'],
    ])
  })

  it('protects run-comparison manifest and reason-code copy (ES/PT)', () => {
    assertCopyContract('es', [
      ['comparison.title', 'Comparación de ejecuciones'],
      ['comparison.notComparable', 'No comparable'],
      ['comparison.reason.target_snapshot_mismatch', 'Conjunto de resolvers distinto'],
      ['comparison.reason.provider_catalog_mismatch', 'Catálogo de proveedores distinto'],
      ['comparison.manifestUnavailable', 'El manifest de esta ejecución no está disponible.'],
      ['comparison.metricSuccessRate', 'Tasa de éxito'],
    ])

    assertCopyContract('pt', [
      ['comparison.title', 'Comparação de execuções'],
      ['comparison.notComparable', 'Não comparável'],
      ['comparison.reason.target_snapshot_mismatch', 'Conjunto de resolvers diferente'],
      ['comparison.reason.provider_catalog_mismatch', 'Catálogo de provedores diferente'],
      ['comparison.manifestUnavailable', 'O manifest desta execução não está disponível.'],
      ['comparison.metricSuccessRate', 'Taxa de sucesso'],
    ])
  })
})
