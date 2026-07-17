const TIPO_LABEL = {
  sitio_anegado: "Sitio anegado",
  calle_cerrada: "Calle cerrada",
  vulnerabilidad: "Zona vulnerable",
  corte_energia: "Corte de energía",
  evacuacion: "Evacuación activa",
};

const NIVEL_LABEL = { alto: "Riesgo alto", medio: "Riesgo medio", bajo: "Riesgo bajo" };

const RADIO_ALERTA_KM = 3; // distancia dentro de la cual una zona se considera "cercana"
const COMUNAS_FALLBACK = [
  { nombre: "Santiago Centro", lat: -33.4489, lng: -70.6693 },
  { nombre: "Maipú", lat: -33.5183, lng: -70.7581 },
  { nombre: "La Florida", lat: -33.5231, lng: -70.5972 },
  { nombre: "Viña del Mar", lat: -33.0245, lng: -71.5518 },
  { nombre: "Rancagua", lat: -34.1708, lng: -70.7444 },
  { nombre: "Talca", lat: -35.4264, lng: -71.6554 },
  { nombre: "Concepción", lat: -36.8201, lng: -73.0444 },
];

let map, userMarker, userAccuracyCircle;
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
}

document.addEventListener("DOMContentLoaded", main);
