import type { Provider } from '../../src/lib/types'

/**
 * The provider catalog fixture — the single fixture source for the e2e
 * provider trio. A third copy of this data lives in `App.tsx`'s
 * `FALLBACK_PROVIDERS` (the runtime fallback when the providers API is
 * unavailable); generating it from `data/dns_providers.es.json` at build
 * time is the recorded follow-up (plan 038, TD-09 second half).
 */
export const providersFixture: Provider[] = [
  {
    id: 'cloudflare',
    name: 'Cloudflare',
    dns: ['1.1.1.1', '1.0.0.1'],
    tags: ['global', 'anycast', 'privacidad'],
    region: 'global',
    country: null,
    goals: ['speed', 'privacy'],
    features: { filtering: 'no', malware_protection: 'no', family: 'no', doh: 'yes', dot: 'yes' },
    notes_es: 'DNS global rápido y muy usado.',
  },
  {
    id: 'google',
    name: 'Google Public DNS',
    dns: ['8.8.8.8', '8.8.4.4'],
    tags: ['global', 'anycast'],
    region: 'global',
    country: null,
    goals: ['speed'],
    features: { filtering: 'no', malware_protection: 'no', family: 'no', doh: 'yes', dot: 'yes' },
    notes_es: 'Servicio DNS global con amplia infraestructura.',
  },
  {
    id: 'quad9',
    name: 'Quad9',
    dns: ['9.9.9.9', '149.112.112.112'],
    tags: ['global', 'privacidad', 'seguridad'],
    region: 'global',
    country: null,
    goals: ['security', 'privacy', 'speed'],
    features: { filtering: 'yes', malware_protection: 'yes', family: 'no', doh: 'yes', dot: 'yes' },
    notes_es: 'Prioriza bloqueo de dominios maliciosos.',
  },
]
