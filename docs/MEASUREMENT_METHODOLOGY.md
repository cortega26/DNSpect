# Metodología de medición

Este documento fija qué mide realmente DNSpect y, sobre todo, qué **no** mide.
Las herramientas que publican números de DNS (GRC DNS Benchmark, VeloDNS,
taihen/dns-benchmark) separan explícitamente la latencia con caché de la
latencia en frío. DNSpect no hace esa separación, y publicarla sin decirlo
sería el peor error posible en un proyecto cuya premisa es la integridad de
la medición. Este documento existe para que eso quede escrito.

## Qué se mide

Para cada resolver objetivo, se ejecutan `runs` consultas en un schedule
cíclico sobre la lista de `data/queries.txt`, más sondas de blocking efficacy
y dos sondas de integridad (NXDOMAIN hijacking y validación DNSSEC). Las
consultas consecutivas se separan 20 ms (`DNS_SPEED_LAB_QUERY_PACE_MS`, `0`
desactiva), porque una ráfaga propia mide encolado y no latencia aislada.

Las métricas por resolver son latencia (mediana, p95, p99, desviación
muestral), fiabilidad (tasas de éxito, timeout y fallo) y blocking
efficacy.

## Qué NO se mide: caché en frío

**El corpus no fuerza consultas en caché fría, y ninguna métrica debe leerse
como si lo hiciera.**

Motivo, medido: una encuesta de TTL sobre los 54 dominios del corpus contra
1.1.1.1, 8.8.8.8 y 9.9.9.9 (156 resoluciones, 6 timeouts) devuelve **95
valores de TTL distintos**, en un continuo de 1 a 85719 segundos, con solo 2
de 156 por debajo de 5 s. No hay bimodalidad: no existe ningún umbral de TTL
que separe "caché" de "sin caché" sin confundir el estado de caché con la
heterogeneidad de TTL entre dominios (los CDNs publican TTL de 30 a 300 s).

Por qué esto no es un umbral mal elegido sino un problema de fondo: para
clasificar bien haría falta conocer el TTL autoritativo de cada nombre, y ese
solo se obtiene consultando en frío. Clasificar por TTL presupone lo que se
quiere medir.

La consecuencia práctica: para dominios de alto tráfico, la probabilidad de
que la consulta sea un cache miss en un recursivo público es aproximadamente
cero. **Lo que DNSpect mide es latencia de lookup en caliente contra el edge
del resolver**, no tiempo de resolución autoritativa. Esto es una limitación
del approach público-recursivo, no un bug, y se declara en lugar de
etiquetarse como "cache miss".

## Lo que sí se controla: auto-calentamiento

El auto-calentamiento (consultar dos veces el mismo nombre dentro de una
corrida) sí es propiedad de DNSpect y está controlado por diseño del schedule:

| Modo | runs | Dominios | Nombres distintos | Repeticiones |
|------|-----:|---------:|------------------:|-------------:|
| quick | 12 | 54 | 12 | 0 |
| standard (por defecto) | 30 | 54 | 30 | 0 |
| exhaustive | 80 | 54 | 54 | 26 |

En quick y standard no se repite **ningún** nombre, así que no hay
auto-calentamiento en los dos modos que la interfaz recomienda. Solo
exhaustive repite, y las repeticiones son las últimas 26 consultas del ciclo
sobre la cabecera del corpus (bloque global/CDN-backed), no una muestra
representativa.

Conclusión: el sesgo de caché que importa aquí es de **población** (otros
usuarios ya cachearon esos nombres en ese resolver), no propio. El primero es
observable pero no está bajo nuestro control sin inventar nombres sintéticos;
el segundo ya está resuelto.

## Opciones evaluadas y rechazadas

- **Nombres sintéticos o aleatorios** (prefijo aleatorio sobre un dominio real)
  para forzar misses. Descartado: muchos autoritativos responden con wildcard
  o NXDOMAIN redirigido, lo que interactúa mal con la detección de NXDOMAIN
  hijacking y con los dominios de ad-blocking, y cambiaría el significado de
  "latencia", rompiendo la comparabilidad con el historial.
- **Clasificación por TTL.** Descartado empíricamente, por la ausencia de
  bimodalidad documentada arriba. El coste de implementación era bajo (drill ya
  parsea la columna TTL y la descarta; DoT/DoH/DoQ iteran el RRset en mano),
  pero el defecto es de validez, no de coste.
- **Clasificación posicional** (primera pasada "fría", repeticiones "calientes").
  Descartado: en quick y standard la columna de "calientes" sería
  estructuralmente vacía, porque no hay repeticiones. Etiquetar como "frío" un
  bucket que es cache hit con probabilidad casi uno es precisamente el
  artificio que este proyecto existe para evitar. Además, el primer bloque de
  cada serie de resolver queda confundido con la posición temporal en el reloj.

## Consecuencias para el scoring

El scoring (`stats.py`) opera sobre las muestras combinadas y **no** recibe
información de caché. No se separan pesos ni se añaden penalizaciones por
"calidez", porque:

- `score_latency` es la media de las muestras exitosas; dividirla obligaría a
  cambiar `normalized_latency`, `score_total` y el orden de ranking, con el
  coste de comparabilidad que eso implica.
- Cualquier contabilidad de fallos por bucket desincronizaría `failure_rate`
  y `timeout_rate`, que hoy dividen por `total_runs`, y esos valores alimentan
  la guarda `is_unreliable`. Es decir, un split mal hecho hace que las guardas
  mientan en silencio.

Conclusión operativa: **el score mide lookup en caliente y es válido para
comparar resolvers entre sí bajo el mismo método.** No es válido como medida de
resolución en frío, y la interfaz no debe presentarlo como tal.

## Límite conocido adyacente

Para DoT, DoH y DoQ la conexión se establece **por muestra**
(`runner.py`, llamadas a `dns.query.tls` / `https` / `quic`). Esas muestras
están dominadas por el handshake, no por la resolución. Es un problema de
comparabilidad entre protocolos mayor que el encuadre frío/caliente, y también
es observable. Queda como trabajo pendiente.
