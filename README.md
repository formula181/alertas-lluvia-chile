# Alertas Lluvia Chile

Prototipo de app web que, a partir de la ubicación del usuario, muestra zonas de peligro cercanas durante emergencias por lluvias en Chile: sitios anegados, calles cerradas, zonas de vulnerabilidad reportadas por autoridades, cortes de energía, evacuaciones activas y noticias de contexto. Genera alertas y recomendaciones automáticas (ej. "no salgas", "no uses esta vía") según la distancia entre el usuario y los reportes.

> ⚠️ **Este prototipo usa datos de ejemplo (`data/zonas.json`, `data/noticias.json`), no información oficial ni en tiempo real.** No debe usarse para tomar decisiones reales de seguridad. Para emergencias reales en Chile: [senapred.cl](https://senapred.cl), Bomberos 132, Carabineros 133, SAMU 131.

## Cómo funciona

- El usuario comparte su ubicación (GPS del navegador) o elige una comuna de referencia.
- La app calcula la distancia (fórmula de Haversine) entre el usuario y cada zona reportada.
- Si hay una zona de **riesgo alto** o **medio** a menos de 3 km, se muestra un banner de alerta con recomendación.
- El mapa (Leaflet + OpenStreetMap) muestra todas las zonas coloreadas por nivel de riesgo, y una lista lateral ordenada por cercanía, filtrable por tipo.
- Se muestra también un feed de noticias/contexto y números de emergencia.

## Cómo correrlo localmente

Es un sitio estático (HTML/CSS/JS sin build), pero necesita servirse por HTTP (no `file://`) para que el `fetch` de los JSON funcione:

```bash
cd alertas-lluvia-chile
python3 -m http.server 8080
# abrir http://localhost:8080
```

## Estructura

```
index.html          Página principal
css/style.css        Estilos
js/app.js            Lógica: geolocalización, mapa, cálculo de distancia, render
data/zonas.json      Zonas de peligro (editable a mano por ahora)
data/noticias.json   Noticias/contexto (editable a mano por ahora)
```

## Editar los datos de zonas

Cada zona en `data/zonas.json` tiene esta forma:

```json
{
  "id": "z1",
  "tipo": "sitio_anegado | calle_cerrada | vulnerabilidad | corte_energia | evacuacion",
  "nombre": "Nombre o dirección de referencia",
  "comuna": "...",
  "region": "...",
  "lat": -33.52,
  "lng": -70.60,
  "nivel": "alto | medio | bajo",
  "descripcion": "...",
  "recomendacion": "Texto que ve el usuario como acción sugerida",
  "fuente": "...",
  "fecha": "ISO 8601"
}
```

## Roadmap hacia datos reales

Este prototipo está pensado para conectarse a fuentes reales cuando estén disponibles:

- **SENAPRED** (reportes oficiales de emergencia, alertas por región/comuna).
- **Municipalidades** (calles cerradas, anegamientos, albergues) — muchas no tienen API pública; podría requerir formulario de carga manual o scraping de sus canales oficiales.
- **Waze for Cities / Google Maps Platform** (incidentes de tránsito en tiempo real, requiere convenio/API key).
- **APIs de noticias o RSS de medios chilenos** para el feed de contexto.
- **Meteorología** (Dirección Meteorológica de Chile) para pronóstico de lluvias por zona.

Pasos sugeridos para migrar de datos de ejemplo a datos reales:
1. Reemplazar `fetch("data/zonas.json")` en `js/app.js` por una llamada a un backend propio que agregue y normalice las fuentes reales.
2. Agregar un proceso (cron/job) que actualice periódicamente esos datos y los sirva vía API.
3. Quitar o actualizar el disclaimer de "datos de ejemplo" una vez la fuente sea oficial y verificada.
4. Agregar autenticación/permisos si se permite que usuarios o municipios reporten zonas directamente.
