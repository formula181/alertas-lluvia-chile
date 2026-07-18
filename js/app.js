const TIPO_LABEL = {
  sitio_anegado: "Sitio anegado",
  calle_cerrada: "Calle cerrada",
  vulnerabilidad: "Zona vulnerable",
  corte_energia: "Corte de energía",
  evacuacion: "Evacuación activa",
};

const NIVEL_LABEL = { alto: "Riesgo alto", medio: "Riesgo medio", bajo: "Riesgo bajo" };

const RADIO_ALERTA_KM = 3; // distancia dentro de la cual una zona se considera "cercana"
const RUTA_ALERTA_KM = 0.6; // distancia al trayecto dentro de la cual una zona se considera "en tu ruta"
const COMUNAS_FALLBACK = [
  { nombre: "Santiago Centro", lat: -33.4489, lng: -70.6693 },
  { nombre: "Maipú", lat: -33.5183, lng: -70.7581 },
  { nombre: "La Florida", lat: -33.5231, lng: -70.5972 },
  { nombre: "Viña del Mar", lat: -33.0245, lng: -71.5518 },
  { nombre: "Rancagua", lat: -34.1708, lng: -70.7444 },
  { nombre: "Talca", lat: -35.4264, lng: -71.6554 },
  { nombre: "Concepción", lat: -36.8201, lng: -73.0444 },
];

let map, userMarker, userAccuracyCircle, rutaLayer, destinoMarker;
const zonaLayer = { markers: [] };
let zonas = [];
let noticias = [];
let fuentesOficiales = [];
let userLatLng = null;
let tipoFiltro = "todos";

function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// --- Ruta: geocodificación (Nominatim) y trazado (OSRM demo), ambos servicios públicos gratuitos ---

// Photon (komoot) está pensado para autocompletado en vivo (a diferencia de Nominatim,
// cuya política de uso prohíbe explícitamente enviar una consulta por cada tecla presionada).
const CHILE_BBOX = "-76.0,-56.0,-66.0,-17.3"; // minLon,minLat,maxLon,maxLat — limita resultados a Chile
let destinoSeleccionado = null; // {lat, lng, label} cuando el usuario elige una sugerencia
let sugerenciasAbortController = null;

async function buscarSugerenciasDireccion(query) {
  if (sugerenciasAbortController) sugerenciasAbortController.abort();
  sugerenciasAbortController = new AbortController();
  const url = `https://photon.komoot.io/api/?q=${encodeURIComponent(query)}&lang=es&limit=5&bbox=${CHILE_BBOX}`;
  const res = await fetch(url, { signal: sugerenciasAbortController.signal });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  return (data.features || []).map((f) => {
    const p = f.properties || {};
    const partes = [p.name, p.street, p.housenumber].filter(Boolean);
    const principal = partes.length ? partes.join(" ") : p.street || p.name || "Ubicación";
    const secundaria = [p.city, p.state, p.country].filter(Boolean).join(", ");
    return {
      label: secundaria ? `${principal}, ${secundaria}` : principal,
      lat: f.geometry.coordinates[1],
      lng: f.geometry.coordinates[0],
    };
  });
}

function ocultarSugerencias() {
  const list = document.getElementById("destinoSugerencias");
  list.classList.remove("show");
  list.innerHTML = "";
}

function renderSugerencias(items) {
  const list = document.getElementById("destinoSugerencias");
  list.innerHTML = "";
  if (items.length === 0) {
    list.innerHTML = '<li class="empty">Sin resultados. Intenta con más detalle.</li>';
    list.classList.add("show");
    return;
  }
  items.forEach((item) => {
    const li = document.createElement("li");
    li.textContent = item.label;
    li.addEventListener("click", () => {
      destinoSeleccionado = item;
      document.getElementById("destinoInput").value = item.label;
      ocultarSugerencias();
    });
    list.appendChild(li);
  });
  list.classList.add("show");
}

function initAutocompleteDestino() {
  const input = document.getElementById("destinoInput");
  let debounceTimer = null;

  input.addEventListener("input", () => {
    destinoSeleccionado = null;
    const query = input.value.trim();
    if (debounceTimer) clearTimeout(debounceTimer);
    if (query.length < 3) {
      ocultarSugerencias();
      return;
    }
    debounceTimer = setTimeout(async () => {
      try {
        const items = await buscarSugerenciasDireccion(query);
        renderSugerencias(items);
      } catch (err) {
        if (err.name !== "AbortError") ocultarSugerencias();
      }
    }, 350);
  });

  document.addEventListener("click", (e) => {
    if (!e.target.closest(".autocomplete-wrap")) ocultarSugerencias();
  });
}

async function geocodeDireccion(direccion) {
  const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=cl&q=${encodeURIComponent(direccion)}`;
  const res = await fetch(url, { headers: { "Accept-Language": "es" }, signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  if (!data.length) throw new Error("No se encontró esa dirección.");
  return { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon), label: data[0].display_name };
}

async function obtenerRutaOSRM(origen, destino) {
  const url = `https://router.project-osrm.org/route/v1/driving/${origen.lng},${origen.lat};${destino.lng},${destino.lat}?overview=full&geometries=geojson`;
  const res = await fetch(url, { signal: AbortSignal.timeout(9000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  if (data.code !== "Ok" || !data.routes || !data.routes.length) throw new Error("No se encontró una ruta.");
  const coords = data.routes[0].geometry.coordinates.map(([lng, lat]) => [lat, lng]);
  return {
    coords,
    distanciaKm: data.routes[0].distance / 1000,
    duracionMin: data.routes[0].duration / 60,
    aproximada: false,
  };
}

function rutaLineaRecta(origen, destino) {
  return {
    coords: [
      [origen.lat, origen.lng],
      [destino.lat, destino.lng],
    ],
    distanciaKm: haversineKm(origen.lat, origen.lng, destino.lat, destino.lng),
    duracionMin: null,
    aproximada: true,
  };
}

// Proyección equirectangular a metros (suficientemente precisa a escala de ciudad) para
// poder medir distancia punto-a-segmento sin resolver geometría esférica en cada tramo.
function proyectarXY(lat, lng, refLat) {
  const R = 6371000;
  const radRefLat = (refLat * Math.PI) / 180;
  return {
    x: R * ((lng * Math.PI) / 180) * Math.cos(radRefLat),
    y: R * ((lat * Math.PI) / 180),
  };
}

function distanciaPuntoASegmentoMetros(p, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const largoCuadrado = dx * dx + dy * dy;
  if (largoCuadrado === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / largoCuadrado;
  t = Math.max(0, Math.min(1, t));
  const projX = a.x + t * dx;
  const projY = a.y + t * dy;
  return Math.hypot(p.x - projX, p.y - projY);
}

function distanciaPuntoARutaKm(punto, rutaCoords) {
  const refLat = punto.lat;
  const p = proyectarXY(punto.lat, punto.lng, refLat);
  let min = Infinity;
  for (let i = 0; i < rutaCoords.length - 1; i++) {
    const a = proyectarXY(rutaCoords[i][0], rutaCoords[i][1], refLat);
    const b = proyectarXY(rutaCoords[i + 1][0], rutaCoords[i + 1][1], refLat);
    const d = distanciaPuntoASegmentoMetros(p, a, b);
    if (d < min) min = d;
  }
  return min / 1000;
}

function calcularAlertasRuta(rutaCoords) {
  return zonas
    .map((z) => ({ ...z, distKmRuta: distanciaPuntoARutaKm({ lat: z.lat, lng: z.lng }, rutaCoords) }))
    .filter((z) => z.distKmRuta <= RUTA_ALERTA_KM)
    .sort((a, b) => a.distKmRuta - b.distKmRuta);
}

function nivelColor(nivel) {
  return nivel === "alto" ? "#ff5252" : nivel === "medio" ? "#f6c453" : "#3ecf8e";
}

function initMap() {
  map = L.map("map", { zoomControl: true }).setView([-33.45, -70.66], 6);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "&copy; OpenStreetMap contributors",
    maxZoom: 19,
  }).addTo(map);
}

function renderZonaMarkers() {
  zonaLayer.markers.forEach((m) => map.removeLayer(m));
  zonaLayer.markers = [];

  zonas.forEach((z) => {
    const marker = L.circleMarker([z.lat, z.lng], {
      radius: 9,
      color: nivelColor(z.nivel),
      fillColor: nivelColor(z.nivel),
      fillOpacity: 0.7,
      weight: 2,
    }).addTo(map);
    marker.bindPopup(
      `<b>${z.nombre}</b><br>${TIPO_LABEL[z.tipo] || z.tipo} · ${NIVEL_LABEL[z.nivel]}<br>${z.descripcion}`
    );
    zonaLayer.markers.push(marker);
  });
}

function setStatus(msg) {
  document.getElementById("status").textContent = msg;
}

function updateUserMarker(lat, lng, accuracy) {
  userLatLng = { lat, lng };
  if (userMarker) map.removeLayer(userMarker);
  if (userAccuracyCircle) map.removeLayer(userAccuracyCircle);

  userMarker = L.marker([lat, lng], {
    icon: L.divIcon({
      className: "",
      html: '<div style="width:16px;height:16px;border-radius:50%;background:#5ea2ff;border:3px solid white;box-shadow:0 0 0 4px rgba(94,162,255,.35)"></div>',
      iconSize: [16, 16],
    }),
  }).addTo(map);
  userMarker.bindPopup("Tu ubicación").openPopup();

  if (accuracy) {
    userAccuracyCircle = L.circle([lat, lng], {
      radius: accuracy,
      color: "#5ea2ff",
      fillOpacity: 0.08,
      weight: 1,
    }).addTo(map);
  }

  map.setView([lat, lng], 13);
}

function dibujarRuta(coords) {
  if (rutaLayer) map.removeLayer(rutaLayer);
  rutaLayer = L.polyline(coords, { color: "#5ea2ff", weight: 5, opacity: 0.85 }).addTo(map);
  map.fitBounds(rutaLayer.getBounds(), { padding: [30, 30] });
}

function marcarDestino(lat, lng, label) {
  if (destinoMarker) map.removeLayer(destinoMarker);
  destinoMarker = L.marker([lat, lng], {
    icon: L.divIcon({ className: "", html: '<div style="font-size:26px;line-height:26px">🏁</div>', iconSize: [26, 26] }),
  }).addTo(map);
  destinoMarker.bindPopup(label || "Destino");
}

function limpiarRuta() {
  if (rutaLayer) { map.removeLayer(rutaLayer); rutaLayer = null; }
  if (destinoMarker) { map.removeLayer(destinoMarker); destinoMarker = null; }
  destinoSeleccionado = null;
  ocultarSugerencias();
  document.getElementById("destinoInput").value = "";
  document.getElementById("rutaEstado").textContent = "";
  document.getElementById("rutaBanner").classList.remove("show", "alto", "medio", "bajo");
  document.getElementById("rutaAlertasList").innerHTML = "";
  document.getElementById("btnLimpiarRuta").style.display = "none";
  if (userLatLng) map.setView([userLatLng.lat, userLatLng.lng], 13);
}

function renderRutaAlertas(lista) {
  const list = document.getElementById("rutaAlertasList");
  list.innerHTML = "";
  lista.forEach((z) => {
    const card = document.createElement("div");
    card.className = `card ${z.nivel}`;
    card.innerHTML = `
      <div class="top-row">
        <h3>${z.nombre}</h3>
        <span class="badge">${NIVEL_LABEL[z.nivel]}</span>
      </div>
      <div class="top-row">
        <span class="badge">${TIPO_LABEL[z.tipo] || z.tipo}</span>
        <span class="dist">${z.distKmRuta < 0.1 ? "cruza tu ruta" : `${z.distKmRuta.toFixed(2)} km de tu ruta`}</span>
      </div>
      <p>${z.descripcion}</p>
      <div class="reco">➡ ${z.recomendacion}</div>
      <div class="meta">${z.comuna}, ${z.region} · Fuente: ${z.fuente}</div>
    `;
    list.appendChild(card);
  });
}

function actualizarBannerRuta(lista, ruta) {
  const banner = document.getElementById("rutaBanner");
  banner.classList.remove("alto", "medio", "bajo");
  banner.classList.add("show");
  const hayAlto = lista.some((z) => z.nivel === "alto");
  const hayMedio = lista.some((z) => z.nivel === "medio");
  const nota = ruta.aproximada
    ? " (ruta aproximada en línea recta — el servicio de trazado de rutas no respondió, así que esto no sigue las calles reales)."
    : "";

  if (hayAlto) {
    const zona = lista.find((z) => z.nivel === "alto");
    banner.classList.add("alto");
    banner.innerHTML = `⚠️ Tu ruta pasa cerca de una zona de riesgo alto: <b>${zona.nombre}</b> (a ${zona.distKmRuta.toFixed(
      2
    )} km del trayecto). Considera una ruta alternativa.${nota}`;
  } else if (hayMedio) {
    const zona = lista.find((z) => z.nivel === "medio");
    banner.classList.add("medio");
    banner.innerHTML = `⚠️ Precaución: tu ruta pasa cerca de una zona de riesgo medio: <b>${zona.nombre}</b>.${nota}`;
  } else {
    banner.classList.add("bajo");
    banner.innerHTML = `✅ No se detectaron zonas de riesgo alto o medio a menos de ${Math.round(
      RUTA_ALERTA_KM * 1000
    )} m de tu ruta (datos de ejemplo).${nota}`;
  }
}

async function handleCalcularRuta() {
  const input = document.getElementById("destinoInput");
  const estadoEl = document.getElementById("rutaEstado");
  const btn = document.getElementById("btnCalcularRuta");
  const direccion = input.value.trim();

  if (!direccion) {
    estadoEl.textContent = "Escribe una dirección de destino.";
    return;
  }
  if (!userLatLng) {
    estadoEl.textContent = "Primero obtén tu ubicación o elige una comuna de referencia (arriba).";
    return;
  }

  btn.disabled = true;
  ocultarSugerencias();
  estadoEl.textContent = "Buscando dirección…";
  try {
    const destino =
      destinoSeleccionado && destinoSeleccionado.label === direccion
        ? destinoSeleccionado
        : await geocodeDireccion(`${direccion}, Chile`);
    marcarDestino(destino.lat, destino.lng, destino.label);

    estadoEl.textContent = "Calculando ruta…";
    let ruta;
    try {
      ruta = await obtenerRutaOSRM(userLatLng, destino);
    } catch (err) {
      ruta = rutaLineaRecta(userLatLng, destino);
    }
    dibujarRuta(ruta.coords);

    const alertas = calcularAlertasRuta(ruta.coords);
    renderRutaAlertas(alertas);
    actualizarBannerRuta(alertas, ruta);

    const durTxt = ruta.duracionMin ? `, ~${Math.round(ruta.duracionMin)} min` : "";
    estadoEl.textContent = `Ruta a "${destino.label}": ${ruta.distanciaKm.toFixed(1)} km${durTxt}.`;
    document.getElementById("btnLimpiarRuta").style.display = "";
  } catch (err) {
    estadoEl.textContent = `No se pudo calcular la ruta: ${err.message}`;
  } finally {
    btn.disabled = false;
  }
}

function zonasConDistancia() {
  if (!userLatLng) return zonas.map((z) => ({ ...z, distKm: null }));
  return zonas
    .map((z) => ({ ...z, distKm: haversineKm(userLatLng.lat, userLatLng.lng, z.lat, z.lng) }))
    .sort((a, b) => a.distKm - b.distKm);
}

function renderZonaList() {
  const list = document.getElementById("zonaList");
  list.innerHTML = "";

  let items = zonasConDistancia();
  if (tipoFiltro !== "todos") items = items.filter((z) => z.tipo === tipoFiltro);

  if (items.length === 0) {
    list.innerHTML = '<p class="section-title">No hay zonas para este filtro.</p>';
    return;
  }

  items.forEach((z) => {
    const card = document.createElement("div");
    card.className = `card ${z.nivel}`;
    card.innerHTML = `
      <div class="top-row">
        <h3>${z.nombre}</h3>
        <span class="badge">${NIVEL_LABEL[z.nivel]}</span>
      </div>
      <div class="top-row">
        <span class="badge">${TIPO_LABEL[z.tipo] || z.tipo}</span>
        ${z.distKm !== null ? `<span class="dist">${z.distKm.toFixed(1)} km de ti</span>` : ""}
      </div>
      <p>${z.descripcion}</p>
      <div class="reco">➡ ${z.recomendacion}</div>
      <div class="meta">${z.comuna}, ${z.region} · Fuente: ${z.fuente}</div>
    `;
    card.addEventListener("click", () => {
      map.setView([z.lat, z.lng], 14);
      const marker = zonaLayer.markers.find(
        (m) => m.getLatLng().lat === z.lat && m.getLatLng().lng === z.lng
      );
      if (marker) marker.openPopup();
    });
    list.appendChild(card);
  });
}

function renderNoticias() {
  const list = document.getElementById("noticiaList");
  list.innerHTML = "";
  noticias
    .slice()
    .sort((a, b) => new Date(b.fecha) - new Date(a.fecha))
    .forEach((n) => {
      const card = document.createElement("div");
      card.className = "card";
      const fecha = new Date(n.fecha);
      const tituloHtml = n.url
        ? `<a href="${n.url}" target="_blank" rel="noopener" style="color:inherit">${n.titulo}</a>`
        : n.titulo;
      card.innerHTML = `
        <div class="top-row">
          <h3>${tituloHtml}</h3>
        </div>
        <p>${n.resumen}</p>
        <div class="meta">${n.fuente} · ${n.region} · ${fecha.toLocaleTimeString("es-CL", { hour: "2-digit", minute: "2-digit" })}</div>
      `;
      list.appendChild(card);
    });
}

function renderFuentesOficiales() {
  const list = document.getElementById("fuentesList");
  if (!list) return;
  list.innerHTML = "";
  fuentesOficiales.forEach((f) => {
    const a = document.createElement("a");
    a.href = f.url;
    a.target = "_blank";
    a.rel = "noopener";
    a.className = "card";
    a.style.display = "block";
    a.style.textDecoration = "none";
    a.style.color = "inherit";
    a.innerHTML = `
      <div class="top-row"><h3>${f.nombre} ↗</h3></div>
      <p>${f.descripcion}</p>
    `;
    list.appendChild(a);
  });
}

async function cargarNoticias() {
  const estadoEl = document.getElementById("noticiasEstado");
  try {
    const res = await fetch("/api/noticias", { signal: AbortSignal.timeout(6000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const payload = await res.json();
    if (payload.ok && payload.noticias.length > 0) {
      noticias = payload.noticias;
      if (estadoEl) {
        estadoEl.textContent = `🟢 Noticias en tiempo real de medios chilenos (actualizado ${new Date(
          payload.actualizado
        ).toLocaleTimeString("es-CL", { hour: "2-digit", minute: "2-digit" })}).`;
      }
      return;
    }
    throw new Error(payload.mensaje || "Backend sin noticias relevantes por ahora.");
  } catch (err) {
    // Backend no disponible (ej. sitio servido de forma 100% estática) o sin resultados: usar datos de ejemplo.
    const res = await fetch("data/noticias.json");
    noticias = await res.json();
    if (estadoEl) {
      estadoEl.textContent =
        "🟡 Mostrando noticias de ejemplo (backend de RSS en tiempo real no disponible). Corre el servidor en /server para noticias reales.";
    }
  }
}

function actualizarRiesgo() {
  const banner = document.getElementById("riskBanner");
  if (!userLatLng) {
    banner.classList.remove("show", "alto", "medio", "bajo");
    return;
  }

  const cercanas = zonasConDistancia().filter((z) => z.distKm <= RADIO_ALERTA_KM);
  const hayAlto = cercanas.some((z) => z.nivel === "alto");
  const hayMedio = cercanas.some((z) => z.nivel === "medio");

  banner.classList.remove("alto", "medio", "bajo");
  banner.classList.add("show");

  if (hayAlto) {
    const zona = cercanas.find((z) => z.nivel === "alto");
    banner.classList.add("alto");
    banner.innerHTML = `⚠️ ALERTA ALTA: hay reportes de riesgo alto a ${zona.distKm.toFixed(
      1
    )} km de tu ubicación (${zona.nombre}). Recomendación: evita salir de tu sector y no uses esta vía. Verifica en fuentes oficiales.`;
  } else if (hayMedio) {
    const zona = cercanas.find((z) => z.nivel === "medio");
    banner.classList.add("medio");
    banner.innerHTML = `⚠️ Precaución: reporte de riesgo medio a ${zona.distKm.toFixed(
      1
    )} km (${zona.nombre}). Circula con cuidado y mantente informado.`;
  } else if (cercanas.length > 0) {
    banner.classList.add("bajo");
    banner.innerHTML = `✅ No hay alertas de riesgo alto o medio registradas a menos de ${RADIO_ALERTA_KM} km de tu ubicación (datos de muestra). Mantente igualmente atento a fuentes oficiales.`;
  } else {
    banner.classList.add("bajo");
    banner.innerHTML = `✅ No hay zonas de peligro registradas cerca de tu ubicación (datos de muestra).`;
  }
}

function refrescarTodo() {
  renderZonaMarkers();
  renderZonaList();
  actualizarRiesgo();
}

function usarUbicacion(lat, lng, accuracy) {
  updateUserMarker(lat, lng, accuracy);
  refrescarTodo();
}

function pedirGeolocalizacion() {
  if (!("geolocation" in navigator)) {
    setStatus("Tu navegador no soporta geolocalización. Elige tu comuna manualmente.");
    return;
  }
  setStatus("Obteniendo tu ubicación…");
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      setStatus(
        `Ubicación obtenida (precisión ~${Math.round(pos.coords.accuracy)} m).`
      );
      usarUbicacion(pos.coords.latitude, pos.coords.longitude, pos.coords.accuracy);
    },
    (err) => {
      setStatus(
        `No se pudo obtener tu ubicación (${err.message}). Elige tu comuna manualmente.`
      );
    },
    { enableHighAccuracy: true, timeout: 10000 }
  );
}

function poblarComunasFallback() {
  const sel = document.getElementById("comunaSelect");
  COMUNAS_FALLBACK.forEach((c) => {
    const opt = document.createElement("option");
    opt.value = `${c.lat},${c.lng}`;
    opt.textContent = c.nombre;
    sel.appendChild(opt);
  });
}

function initTabs() {
  document.querySelectorAll(".tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      document.querySelectorAll(".tab").forEach((t) => t.classList.remove("active"));
      tab.classList.add("active");
      tipoFiltro = tab.dataset.tipo;
      renderZonaList();
    });
  });
}

async function cargarDatos() {
  const [zonasRes, fuentesRes] = await Promise.all([
    fetch("data/zonas.json"),
    fetch("data/fuentesOficiales.json"),
  ]);
  zonas = await zonasRes.json();
  fuentesOficiales = await fuentesRes.json();
  renderZonaMarkers();
  renderZonaList();
  renderFuentesOficiales();

  await cargarNoticias();
  renderNoticias();
}

function main() {
  initMap();
  initTabs();
  poblarComunasFallback();
  cargarDatos();

  document.getElementById("btnUbicacion").addEventListener("click", pedirGeolocalizacion);
  document.getElementById("comunaSelect").addEventListener("change", (e) => {
    if (!e.target.value) return;
    const [lat, lng] = e.target.value.split(",").map(Number);
    setStatus(`Usando ubicación aproximada de ${e.target.selectedOptions[0].textContent}.`);
    usarUbicacion(lat, lng, null);
  });

  document.getElementById("btnCalcularRuta").addEventListener("click", handleCalcularRuta);
  document.getElementById("btnLimpiarRuta").addEventListener("click", limpiarRuta);
  document.getElementById("destinoInput").addEventListener("keydown", (e) => {
    if (e.key === "Enter") handleCalcularRuta();
    if (e.key === "Escape") ocultarSugerencias();
  });
  initAutocompleteDestino();
}

document.addEventListener("DOMContentLoaded", main);
