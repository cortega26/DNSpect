# Contributing

Gracias por contribuir a `DNSpect`.

## Flujo de desarrollo

1. Haz fork y crea una rama descriptiva (`feat/...`, `fix/...`, `docs/...`).
2. Ejecuta los controles de calidad locales antes de abrir el PR:
   - Backend: `ruff check . && ruff format --check . && black --check . && mypy && bandit -q -c pyproject.toml -r app && pytest -q`
   - Backend (SAST adicional): `make backend-semgrep`
   - Frontend: `npm run lint && npm run typecheck && npm run build`
3. Escribe cambios pequeños y enfocados.
4. Actualiza documentación y tests cuando aplique.
5. Abre PR con descripción clara, motivación y evidencia de pruebas.

## Flatpak / Flathub

DNSpect se distribuye como Flatpak. Ver `.agents/flathub-compliance.md` para reglas de empaquetado.

### Regenerar dependencias npm para Flatpak

```bash
make flatpak-deps
```

Esto actualiza `packaging/flatpak/generated-sources.json` desde el `package-lock.json`.

### Validar build Flatpak

```bash
make flatpak-validate
```

Requiere `flatpak-builder` instalado. Corre el build y luego `flatpak-builder-lint`.

### Verificar metainfo localmente

```bash
flatpak-builder-lint manifest io.github.cortega26.DNSpect.yaml
```

### Checklist pre-submit

```bash
make flatpak-validate     # build + lint
npm run -C frontend test  # 32+ tests
npm run -C frontend build # production build
```

## Configuración rápida

- Linux/macOS: `scripts/dev.sh`
- Windows: `scripts/dev.ps1`

## Checklist de Pull Request

- [ ] El cambio resuelve un problema real y está acotado.
- [ ] No hay `shell=True` ni ejecución arbitraria.
- [ ] Validaciones de entrada se mantienen estrictas.
- [ ] Tests y checks pasan localmente.
- [ ] README/docs actualizados si cambió comportamiento.
- [ ] No se añadieron secretos, telemetría o dependencias cloud no solicitadas.
