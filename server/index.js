const path = require("path");
const express = require("express");
const { XMLParser } = require("fast-xml-parser");
const feeds = require("./feeds.json");

const PORT = process.env.PORT || 3000;
const CACHE_MS = 5 * 60 * 1000;
const FETCH_TIMEOUT_MS = 8000;

const PALABRAS_CLAVE = [
  "lluvia", "lluvias", "temporal", "inundaci", "anegad", "aluvi", "desborde",
  "evacuaci", "alerta roja", "alerta amarilla", "alerta temprana", "emergencia",
  "corte de tránsito", "corte de transito", "calle cerrada", "senapred", "onemi",
  "bomberos", "deslizamiento", "crecida", "sistema frontal", "río", "rio",
];

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_" });

let cache = { data: [], timestamp: 0, ultimoError: null };

function textoPlano(valor) {
  if (valor == null) return "";
  const s = typeof valor === "object" ? valor["#text"] ?? "" : String(valor);
  return s.replace(/<[^>]+>/g, "").trim();
}

function esRelevante(texto) {
  const t = texto.toLowerCase();
  return PALABRAS_CLAVE.some((clave) => t.includes(clave));
}

async function obtenerFeed(feed) {
  try {
    const res = await fetch(feed.url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const xml = await res.text();
    const json = parser.parse(xml);

    const itemsRss = json?.rss?.channel?.item;
    const itemsAtom = json?.feed?.entry;
    const items = itemsRss ?? itemsAtom ?? [];
    const arr = Array.isArray(items) ? items : [items];

    return arr
      .filter(Boolean)
      .map((item) => {
        const titulo = textoPlano(item.title);
        const resumen = textoPlano(item.description ?? item.summary).slice(0, 300);
        const link =
          typeof item.link === "object" ? item.link["@_href"] ?? feed.url : item.link ?? feed.url;
        const fecha = item.pubDate ?? item.published ?? item.updated ?? new Date().toISOString();
        return {
          titulo,
          resumen,
          fuente: feed.fuente,
          fecha: new Date(fecha).toISOString(),
          url: link,
          region: "Nacional",
        };
      });
  } catch (err) {
    console.error(`[feeds] Error obteniendo "${feed.nombre}": ${err.message}`);
    return [];
  }
}

async function obtenerNoticias({ forzar = false } = {}) {
  const ahora = Date.now();
  if (!forzar && cache.data.length > 0 && ahora - cache.timestamp < CACHE_MS) {
    return cache;
  }

  const resultadosPorFeed = await Promise.all(feeds.map(obtenerFeed));
  const todas = resultadosPorFeed.flat();
  const relevantes = todas
    .filter((n) => n.titulo && (esRelevante(n.titulo) || esRelevante(n.resumen)))
    .sort((a, b) => new Date(b.fecha) - new Date(a.fecha))
    .slice(0, 30);

  cache = {
    data: relevantes,
    timestamp: ahora,
    ultimoError: relevantes.length === 0 ? "No se encontraron noticias relevantes en los feeds configurados." : null,
  };
  return cache;
}

const app = express();
app.use(express.static(path.join(__dirname, "..")));

app.get("/api/noticias", async (req, res) => {
  try {
    const resultado = await obtenerNoticias();
    res.json({
      ok: resultado.data.length > 0,
      actualizado: new Date(resultado.timestamp).toISOString(),
      mensaje: resultado.ultimoError,
      noticias: resultado.data,
    });
  } catch (err) {
    res.status(502).json({
      ok: false,
      mensaje: "No se pudieron obtener noticias en este momento. Intenta más tarde o revisa las fuentes oficiales.",
      noticias: [],
    });
  }
});

app.get("/api/fuentes-oficiales", (req, res) => {
  res.sendFile(path.join(__dirname, "..", "data", "fuentesOficiales.json"));
});

app.listen(PORT, () => {
  console.log(`Servidor escuchando en http://localhost:${PORT}`);
  console.log(`Feeds configurados: ${feeds.map((f) => f.nombre).join(", ")}`);
});
