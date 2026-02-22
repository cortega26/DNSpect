# Contributing

Gracias por contribuir a `dns-speed-lab`.

## Flujo de desarrollo

1. Haz fork y crea una rama descriptiva (`feat/...`, `fix/...`, `docs/...`).
2. Ejecuta calidad local antes de abrir PR:
   - Backend: `ruff check . && ruff format --check . && black --check . && mypy && bandit -q -c pyproject.toml -r app && pytest -q`
   - Backend (SAST adicional): `make backend-semgrep`
   - Frontend: `npm run lint && npm run typecheck && npm run build`
3. Escribe cambios pequeños y enfocados.
4. Actualiza documentación y tests cuando aplique.
5. Abre PR con descripción clara, motivación y evidencia de pruebas.

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
