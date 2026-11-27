/**
 * Pokecraft Adventure Launcher
 *
 * Copia en disco de las imagenes de las noticias (T15), para verlas sin internet. Las imagenes viven en el
 * repositorio del bot (raw.githubusercontent.com) y ya no caducan. Carpeta: <datos del launcher>/news-images.
 *  - cacheImages: baja en segundo plano las que faltan y borra las que ya no usa ninguna noticia.
 *  - useLocal: cambia `image` por la ruta file:// de la copia cuando existe (si no, deja la URL remota).
 * Cualquier fallo se ignora: la noticia sigue funcionando con la URL remota o sin imagen.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { pathToFileURL } = require('url');
const nodeFetch = require('node-fetch');
const { dataDir } = require('./datadir');
const { removeSync } = require('./fsx');

const UA = 'PokecraftAdventure-Launcher';
const EXTS = ['.webp', '.png', '.jpg', '.jpeg', '.gif', '.avif'];
const MAX_BYTES = 8 * 1024 * 1024;

const imagesDir = () => path.join(dataDir(), 'news-images');
const isHttp = u => /^https?:\/\//i.test(String(u || ''));

/** Nombre estable de la copia: hash de la URL + extension original. */
function localName(url) {
    let ext = '';
    try { ext = path.extname(new URL(url).pathname).toLowerCase(); } catch (e) { /* sin extension */ }
    return crypto.createHash('sha1').update(String(url)).digest('hex').slice(0, 24) + (EXTS.includes(ext) ? ext : '.img');
}

const localFile = url => path.join(imagesDir(), localName(url));

function exists(file) {
    try { return fs.statSync(file).size > 0; } catch (e) { return false; }
}

/** Devuelve las noticias con `image` apuntando a la copia local cuando existe. No modifica la lista original. */
function useLocal(items) {
    return items.map(n => {
        if (!isHttp(n.image)) return n;
        const f = localFile(n.image);
        return exists(f) ? { ...n, image: pathToFileURL(f).href } : n;
    });
}

async function download(url, dest, timeoutMs, maxBytes) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
        const res = await nodeFetch(url, { headers: { 'User-Agent': UA }, signal: ctrl.signal });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const type = String(res.headers.get('content-type') || '').toLowerCase();
        if (type && !type.startsWith('image/') && !type.includes('octet-stream')) throw new Error('No es una imagen: ' + type);
        const len = Number(res.headers.get('content-length') || 0);
        if (len > maxBytes) throw new Error('Imagen demasiado grande');
        const buf = await res.buffer();
        if (!buf.length || buf.length > maxBytes) throw new Error('Tamano de imagen no valido');
        const tmp = dest + '.part';
        fs.writeFileSync(tmp, buf);
        fs.renameSync(tmp, dest);
    } finally {
        clearTimeout(timer);
    }
}

/**
 * Baja las imagenes que faltan (hasta `concurrency` a la vez) y borra las copias que ninguna noticia usa.
 * @param {Array<{image:string}>} items noticias con la URL remota original
 * @returns {Promise<{downloaded:number, failed:number, pruned:number}>}
 */
async function cacheImages(items, { timeoutMs = 15000, maxBytes = MAX_BYTES, concurrency = 3 } = {}) {
    const out = { downloaded: 0, failed: 0, pruned: 0 };
    try {
        const urls = [...new Set(items.map(n => n.image).filter(isHttp))];
        fs.mkdirSync(imagesDir(), { recursive: true });
        const todo = urls.filter(u => !exists(localFile(u)));
        let next = 0;
        const worker = async () => {
            while (next < todo.length) {
                const url = todo[next++];
                try { await download(url, localFile(url), timeoutMs, maxBytes); out.downloaded++; }
                catch (e) { out.failed++; try { removeSync(localFile(url) + '.part'); } catch (e2) { /* nada */ } }
            }
        };
        await Promise.all(Array.from({ length: Math.min(concurrency, todo.length) }, worker));

        // Limpieza: solo archivos con nuestro formato de nombre y que ya no usa ninguna noticia.
        const keep = new Set(urls.map(localName));
        for (const f of fs.readdirSync(imagesDir())) {
            if (!/^[0-9a-f]{24}\.(webp|png|jpe?g|gif|avif|img)(\.part)?$/.test(f) || keep.has(f)) continue;
            try { removeSync(path.join(imagesDir(), f)); out.pruned++; } catch (e) { /* se deja */ }
        }
    } catch (e) { /* la copia es opcional */ }
    return out;
}

module.exports = { cacheImages, useLocal, localName, imagesDir };
