# Screenshots / GIF

Placeholders sugeridos (crear dentro de `docs/screenshots/`):

- `dashboard.png`
- `ranking.png`
- `detail.png`
- `flow.gif` (opcional)
- `guided-apply-modal.png`
- `guided-apply-verify.png`

## Cómo generarlas

1. Ejecuta la app (`scripts/dev.sh` o `scripts/dev.ps1`).
2. Corre un benchmark corto (`quick`, 12 runs).
3. Captura:
   - Dashboard con configuración
   - Ranking con filtros y recomendación
   - Modal de detalle de un resolver
4. Si deseas GIF, graba un flujo corto con Peek/ScreenToGif.

## Verificación de Motion / Reduced Motion

1. Estado normal:
   - Ejecuta un benchmark en curso y captura `docs/screenshots/live-motion-normal.png`.
2. Reduced motion:
   - En Chrome DevTools: `Rendering` -> `Emulate CSS media feature prefers-reduced-motion: reduce`.
   - En Playwright: `page.emulateMedia({ reducedMotion: 'reduce' })`.
   - Captura `docs/screenshots/live-motion-reduced.png`.
3. Revisa que:
   - El chip LIVE no pulse.
   - No haya heartbeat en filas lideres.
   - No haya animaciones FLIP/reveal.
   - El panel siga funcional y sin cambios de layout.
4. Presupuesto de motion por volumen:
   - Simula un ranking con más de 30 filas visibles.
   - Verifica que se desactiven animaciones de reorder/highlights y que los deltas permanezcan solo como texto.
   - Verifica que `Updated ago` refresque cada 1000 ms.
