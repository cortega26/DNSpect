# Troubleshooting

## 1) `drill` no encontrado en Linux

Síntoma: benchmark usa `dnspython` en vez de `drill`.

Solución:

```bash
sudo apt update
sudo apt install -y ldnsutils
```

## 2) Firewall en Windows bloquea la app

Síntoma: no responde `http://127.0.0.1:8000`.

Solución:

- Permitir ejecución local del binario/Python.
- Verificar que el puerto no esté bloqueado por políticas corporativas.

## 3) Conflicto de puertos

Síntoma: backend no inicia (`Address already in use`).

Solución:

- Dev:
  - Linux/macOS: `BACKEND_PORT=8010 bash scripts/dev.sh`
  - Windows: `$env:BACKEND_PORT="8010"; .\scripts\dev.ps1`
- Binario:
  - `DNS_SPEED_LAB_PORT=8010 ./dns-speed-lab-linux`

## 4) `python3` existe pero no `pip`

Síntoma: scripts fallan instalando dependencias.

Solución:

- Los scripts intentan `ensurepip` automáticamente.
- Si falla, usa `PYTHON_BIN` apuntando a un Python con pip:
  - `PYTHON_BIN=/ruta/python bash scripts/dev.sh`

## 5) Benchmark con muchos timeouts

Causas comunes:

- Resolver caído o filtrado por red.
- DNS candidato obsoleto.
- Latencia intercontinental alta.

Qué hacer:

- Usar modo `standard` inicialmente.
- Revisar `timeout_rate` y `p95` además de la mediana.

## 6) El JSON no trae muestras

Comportamiento esperado por defecto para reducir payload.

Para incluir muestras:

- API status: `?include_samples=1`
- Export JSON: `?include_samples=1`
