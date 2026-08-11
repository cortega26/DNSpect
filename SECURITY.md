# Security Policy

## Reporting a Vulnerability

Si encuentras una vulnerabilidad, por favor repórtala de forma responsable por
canal privado al mantenedor del repositorio (issue privado o contacto directo).
No publiques detalles explotables hasta coordinar una corrección.

Incluye:

- Descripción del problema
- Pasos de reproducción
- Impacto potencial
- Versión afectada

## Scope

Este proyecto está diseñado para ejecutarse localmente y no incluye telemetría.
Realiza consultas DNS salientes hacia los resolvers configurados por el usuario
y, cuando la detección automática de región está activa, un único request a
`https://api.ipify.org?format=json` (solo la IP pública, timeout de 5 s, sin
caché ni reintentos) seguido de una consulta local a `/api/geoip`; la política
aprobada está documentada en `docs/REGION_TARGETING.md`. No debe usarse para
escaneo de red ni pruebas no autorizadas.

## Security Baseline

- Validación estricta de resolvers (IP literal)
- Validación de dominios (hostname)
- Límites de `runs` y `timeout`
- Subprocess sin `shell=True`
