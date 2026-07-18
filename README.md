# Alertas Lluvia Chile

Prototipo de app web que, a partir de la ubicación del usuario, muestra zonas de peligro cercanas durante emergencias por lluvias en Chile: sitios anegados, calles cerradas, zonas de vulnerabilidad reportadas por autoridades, cortes de energía, evacuaciones activas y noticias de contexto. Genera alertas y recomendaciones automáticas (ej. "no salgas", "no uses esta vía") según la distancia entre el usuario y los reportes. También permite ingresar un destino y revisar si el trayecto para llegar ahí pasa cerca de alguna zona de peligro.

> ⚠️ **Las zonas de peligro (`data/zonas.json`) son datos de ejemplo, no oficiales.** Las noticias pueden ser reales (RSS de medios chilenos) cuando el backend está activo — ver más abajo. Esta app no reemplaza a las fuentes oficiales. Para emergencias reales en Chile: [senapred.cl](https://senapred.cl), Bomberos 132, Carabineros 133, SAMU 131.

## Cómo funciona

- El usuario comparte su ubicación (GPS del navegador) o elige una comuna de referencia.
- La app calcula la distancia (fórmula de Haversine) entre el usuario y cada zona reportada.
- Si hay una zona de **riesgo alto** o **medio** a menos de 3 km, se muestra un banner de alerta con recomendación.
- El mapa (Leaflet + OpenStreetMap) muestra todas las zonas coloreadas por nivel de riesgo, y una lista lateral ordenada por cercanía, filtrable por tipo.
- **Noticias**: si el backend (`/server`) está corriendo, el feed muestra noticias reales agregadas desde RSS de medios chilenos (Emol, Cooperativa, BioBioChile, 24 Horas), filtradas por palabras clave de la emergencia (lluvia, temporal, inundación, alerta roja, SENAPRED, evacuación, etc.). Si el backend no está disponible (ej. sitio servido 100% estático), cae automáticamente a `data/noticias.json` de ejemplo y lo indica en pantalla.
- **Fuentes oficiales**: panel con enlaces directos a SENAPRED, Dirección Meteorológica, Bomberos, Carabineros y gob.cl/emergencias. No se scrapea contenido de estos sitios porque no exponen una API pública estable de datos estructurados en tiempo real (zonas de riesgo, calles cortadas) — por eso ese tipo de dato sigue siendo editable a mano en `data/zonas.json`.
- **Planifica tu viaje**: el usuario ingresa una dirección de destino, con autocompletado en vivo (Photon) a medida que escribe. La app geocodifica esa dirección (usa la sugerencia elegida, o Nominatim si el usuario escribe y da submit sin elegir sugerencia), traza la ruta desde su ubicación (OSRM, ruteo por calles reales) y calcula la distancia mínima entre cada zona de peligro y el trayecto. Si alguna zona de riesgo alto o medio queda a menos de 600 m de la ruta, se muestra un banner de alerta ("considera una ruta alternativa") y la tarjeta de esa zona en un panel aparte. Si el servicio de rutas no responde, cae a una línea recta entre origen y destino (avisando que es una aproximación) para que la función no quede inutilizable.
- **Contactos de emergencia**: los números (Bomberos, Carabineros, SAMU) son enlaces `tel:` — al tocarlos en el celular abren directo la app de llamadas con el número marcado.

## Cómo correrlo localmente

### Solo frontend (con noticias de ejemplo)

```bash
cd alertas-lluvia-chile
python3 -m http.server 8080
# abrir http://localhost:8080
```

### Con backend de noticias en tiempo real

```bash
cd alertas-lluvia-chile/server
npm install
npm start
# abrir http://localhost:3000 (el backend sirve también el frontend)
```

El backend expone:
- `GET /api/noticias` → `{ ok, actualizado, mensaje, noticias: [...] }`, agregando y cacheando (5 min) los feeds de `server/feeds.json`.
- `GET /api/fuentes-oficiales` → lista de enlaces oficiales.

> Nota: los feeds en `server/feeds.json` son URLs de RSS conocidas de medios chilenos, pero no pude verificarlas en vivo desde el entorno donde se generó este prototipo (sin salida a internet). Revisa que respondan correctamente al desplegar, y ajusta/agrega feeds según lo que necesites — el código ya maneja feeds caídos sin romper el resto.

### Sobre "Planifica tu viaje" (geocodificación y rutas)

Usa tres servicios públicos y gratuitos, sin necesidad de API key:
- **[Photon](https://photon.komoot.io/)** (komoot, basado en OpenStreetMap) para el autocompletado en vivo mientras el usuario escribe el destino (con debounce de 350 ms y mínimo 3 caracteres, para no disparar una consulta por cada tecla).
- **[Nominatim](https://nominatim.org/release-docs/latest/api/Search/)** (OpenStreetMap) para resolver la dirección solo si el usuario escribe y presiona "Calcular ruta" sin elegir ninguna sugerencia del autocompletado.
- **[OSRM demo server](http://project-osrm.org/)** (`router.project-osrm.org`) para calcular la ruta por calles reales.

Importante: la política de uso de Nominatim **prohíbe explícitamente** usarlo para autocompletado (consultas en cada tecla) — por eso el autocompletado usa Photon, que sí está pensado para ese caso de uso, y Nominatim solo se usa como fallback puntual (una consulta por click, no por tecla).

Los tres son servicios de demostración pensados para uso bajo/moderado, no para tráfico de producción alto, y pueden estar caídos o lentos sin aviso. Si este proyecto crece, conviene:
1. Auto-hospedar Photon/Nominatim/OSRM, o
2. Migrar a un proveedor con SLA (Google Maps Platform, Mapbox, HERE), todos requieren API key y tienen costo por uso alto.

Esta parte tampoco pude probarla contra los servidores reales desde el entorno donde se construyó (sin salida a internet), pero sí quedó validada con pruebas automatizadas que simulan las respuestas de Photon/Nominatim/OSRM (autocompletado con debounce, geocodificación, trazado de ruta, detección de zonas cercanas a la ruta, y el fallback a línea recta cuando el servicio de rutas falla) — igual conviene probarla una vez desplegada con conexión real.

## Estructura

```
index.html               Página principal
css/style.css             Estilos
js/app.js                 Lógica: geolocalización, mapa, distancia, render, fetch de noticias/fuentes
data/zonas.json           Zonas de peligro (editable a mano)
data/noticias.json        Noticias de ejemplo (fallback si no hay backend)
data/fuentesOficiales.json  Enlaces oficiales (SENAPRED, DMC, Bomberos, Carabineros, gob.cl)
server/index.js            Backend Express: agrega RSS reales, expone /api/noticias y /api/fuentes-oficiales
server/feeds.json          Lista configurable de feeds RSS de medios chilenos
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

Ya resuelto:
- ✅ Noticias vía RSS de medios chilenos serios (con fallback si falla).
- ✅ Enlaces directos a fuentes de gobierno (SENAPRED, DMC, Bomberos, Carabineros).

Pendiente / no automatizable con una API pública conocida hoy:
- **SENAPRED / municipalidades**: no tienen una API pública estable para datos estructurados de zonas de riesgo, calles cortadas o albergues en tiempo real. Alternativas si se quiere avanzar: (a) contactar a SENAPRED o a municipios para acceso a datos vía convenio, (b) que un equipo humano cargue manualmente `data/zonas.json` durante la emergencia a partir de lo publicado en fuentes oficiales, (c) explorar **Waze for Cities / Google Maps Platform** para incidentes de tránsito (requiere convenio/API key).
- **Meteorología** (Dirección Meteorológica de Chile) para pronóstico de lluvias por zona — se podría sumar como otro feed/endpoint similar al de noticias si se encuentra una fuente estructurada.

Pasos sugeridos para seguir avanzando:
1. Verificar en un entorno con internet real que los feeds de `server/feeds.json` respondan y ajustar/agregar según resultado.
2. Si se consigue una fuente oficial de zonas de riesgo, reemplazar `fetch("data/zonas.json")` en `js/app.js` por un endpoint del backend que la sirva, igual que se hizo con noticias.
3. Agregar un proceso (cron/job) que refresque `data/zonas.json` desde esa fuente y quitar el disclaimer de "datos de ejemplo" una vez sea información oficial verificada.
4. Agregar autenticación/permisos si se permite que usuarios o municipios reporten zonas directamente.
