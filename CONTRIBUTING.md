# Contributing

Gracias por contribuir a `DNSpect`.

## Flujo de desarrollo

1. Haz fork y crea una rama descriptiva (`feat/...`, `fix/...`, `docs/...`).
2. Ejecuta los controles de calidad locales antes de abrir el PR:
   - Backend: `make backend-check` (ruff, formato, mypy, bandit y pytest)
   - Backend (SAST adicional): `make backend-semgrep`
   - Auditoría de dependencias: `make dependency-audit`
   - Frontend: `npm run lint && npm run typecheck && npm test && npm run build`
3. Escribe cambios pequeños y enfocados.
4. Actualiza documentación y tests cuando aplique.
5. Abre PR con descripción clara, motivación y evidencia de pruebas.

## Flatpak / Flathub

DNSpect se distribuye como Flatpak. La política de empaquetado y el runbook de
publicación están en `docs/distribution/flathub-readiness.md`; la regeneración
de módulos generados y los comandos de bootstrap del generador están descritos
ahí, no duplicados aquí.

### Regenerar dependencias npm para Flatpak

```bash
make flatpak-deps
```

Esto actualiza `packaging/flatpak/generated-sources.json` desde el `package-lock.json`.

### Regenerar el módulo Python para Flatpak

```bash
make flatpak-python-deps
```

Requiere `flatpak-pip-generator` (ver bootstrap del generador en el runbook).
Actualiza `packaging/flatpak/python3-requirements.json` desde
`packaging/flatpak/requirements.txt`.

### Validar build Flatpak

```bash
make flatpak-validate
```

Requiere `flatpak-builder` y `flatpak-builder-lint` instalados. Corre el build
y luego el lint del manifest/builddir (el lint `builddir` reporta el ítem
`appstream-external-screenshot-url` antes de la publicación, que Flathub
resuelve al espejar las capturas; ver el runbook).

## Configuración rápida

- Linux/macOS: `scripts/dev.sh`
- Windows: `scripts/dev.ps1`
- Requisitos: Python `>=3.13` y Node `24.x`.

## Checklist de Pull Request

- [ ] El cambio resuelve un problema real y está acotado.
- [ ] No hay `shell=True` ni ejecución arbitraria.
- [ ] Validaciones de entrada se mantienen estrictas.
- [ ] Tests y checks pasan localmente.
- [ ] README/docs actualizados si cambió comportamiento.
- [ ] No se añadieron secretos, telemetría o dependencias cloud no solicitadas.
