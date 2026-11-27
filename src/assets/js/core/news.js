/**
 * Pokecraft Adventure Launcher
 *
 * Noticias: lee news.json del repositorio publico (launcher.config.json -> newsUrl), lo valida y
 * guarda una copia en disco para usarla sin red. news.json lo escribe un flujo de GitHub Actions
 *; el launcher solo lo lee.
 */
const fs = require('fs');
const path = require('path');
const cfg = require('../../../launcher.config.json');
const { fetchText } = require('./remote');
const { dataDir } = require('./datadir');
const { cacheImages, useLocal } = require('./newsimages');

const TYPES = ['announcement', 'store', 'event', 'tiktok'];
const MAX_ITEMS = 50;

const str = v => (typeof v === 'string' ? v : '');

/** Deja solo noticias bien formadas, con los campos del contrato. */
function normalize(raw) {
    const list = Array.isArray(raw) ? raw : raw && Array.isArray(raw.items) ? raw.items : [];
    const items = [];
    for (const n of list) {
        if (!n || typeof n !== 'object' || !n.id) continue;
        items.push({
            id: String(n.id),
            type: TYPES.includes(n.type) ? n.type : 'announcement',
            title: str(n.title),
            body: str(n.body),
            image: str(n.image),
            author: str(n.author),
            date: str(n.date),
            url: /^https?:\/\//i.test(str(n.url)) ? n.url : '',
            // Destacada: la tienda, o un mensaje que el staff fijo en Discord (si falta, false).
            featured: n.featured === true,
            // Fijada por el staff en Discord (solo estas se destacan en Inicio; `featured` incluye toda la tienda). Si falta, false.
            pinned: n.pinned === true
        });
    }
    items.sort((a, b) => (Date.parse(b.date) || 0) - (Date.parse(a.date) || 0));
    return items.slice(0, MAX_ITEMS);
}

const cacheFile = () => path.join(dataDir(), 'news-cache.json');

function readCache() {
    try { return normalize(JSON.parse(fs.readFileSync(cacheFile(), 'utf8'))); } catch (e) { return null; }
}

function writeCache(items) {
    try {
        const f = cacheFile();
        fs.mkdirSync(path.dirname(f), { recursive: true });
        const tmp = f + '.tmp';
        fs.writeFileSync(tmp, JSON.stringify({ items }, null, 2));
        fs.renameSync(tmp, f);
    } catch (e) { /* la copia es opcional */ }
}

/**
 * `image` de cada noticia apunta a la copia local (file://) si ya esta descargada y, si no, a la URL remota.
 * Con red, las imagenes que faltan se bajan en segundo plano: `imagesReady` se resuelve al terminar.
 * @returns {Promise<{items:object[], fromCache:boolean, error:string|null, imagesReady?:Promise}>}
 */
async function getNews({ timeoutMs = 6000, url = cfg.newsUrl } = {}) {
    let error = null;
    if (url) {
        try {
            const items = normalize(JSON.parse(await fetchText(url, timeoutMs)));
            writeCache(items);
            const imagesReady = cacheImages(items);
            return { items: useLocal(items), fromCache: false, error: null, imagesReady };
        } catch (e) {
            error = e && e.name === 'AbortError' ? 'Tiempo agotado' : String((e && e.message) || e);
        }
    } else {
        error = 'Noticias sin configurar';
    }
    const cached = readCache();
    return { items: cached ? useLocal(cached) : [], fromCache: !!cached, error };
}

module.exports = { getNews, normalize };
