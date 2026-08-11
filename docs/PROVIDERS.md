# Proveedores DNS incluidos

Dataset fuente: `data/dns_providers.es.json`

Este catálogo es metadata de selección de pruebas: identifica resolvers por
nombre y describe sus características declaradas para que puedas elegir qué
medir. DNSpect no valida, respalda ni recomienda proveedores, y no verifica
declaraciones de privacidad, registro de consultas, cumplimiento normativo ni
calidad de servicio. Los resultados de un benchmark describen la ruta de red
observada desde tu máquina en ese momento.

Referencias de medición disponibles:

- **Cloudflare**: resolver global con tráfico anycast.
- **Google Public DNS**: resolver global con tráfico anycast.
- **Quad9**: resolver con filtrado declarado de dominios maliciosos.
- **OpenDNS**: familia de resolvers con filtrado declarado configurable.
- **AdGuard DNS**: familia de resolvers con filtrado declarado de publicidad/rastreo.
- **CleanBrowsing**: resolvers con perfiles de filtrado declarados.
- **ControlD**: familia de endpoints con distintos perfiles de filtrado declarados.
- **NextDNS**: resolver con opciones declaradas de personalización y filtrado.
- **DNS.Watch**: resolver independiente.
- **Mullvad DNS**: resolver orientado a privacidad según su documentación.
- **UncensoredDNS**: resolver sin filtrado declarado.
- **CZ.NIC**: operado por el registro `.cz`, con filtrado declarado de malware.
- **Digitalcourage**: resolver europeo con política declarada de no registro de consultas.
- **dns0.eu**: resolver europeo con políticas declaradas de filtrado y privacidad.
- **LACNIC**: referencia regional LATAM.
- **NIC.br**: opción regional para comparación sudamericana.
- **AliDNS (Alibaba)**: referencia para rutas Asia/China.
- **DNSPod (Tencent)**: alternativa para desempeño en China.
- **Lumen / Level3**: resolvers históricos `4.2.2.x`.
- **Neustar**: DNS empresarial con protección declarada contra amenazas.
- **Comodo Secure DNS**: énfasis declarado en seguridad.
- **KT DNS (Korea Telecom)**: referencia para rutas hacia Corea del Sur.
- **Bharat DNS (NIC India)**: referencia para rutas hacia India.

Las etiquetas `privacy`, `security`, `family` y similares son categorías del
catálogo para selección de pruebas, no avales ni verificación de políticas del
proveedor.
