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
Realiza consultas DNS salientes hacia los resolvers configurados por el usuario.
No debe usarse para escaneo de red ni pruebas no autorizadas.

## Security Baseline

- Validación estricta de resolvers (IP literal)
- Validación de dominios (hostname)
- Límites de `runs` y `timeout`
- Subprocess sin `shell=True`
