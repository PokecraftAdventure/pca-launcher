/**
 * Pokecraft Adventure Launcher
 *
 * Estado remoto: lee status.json del repositorio publico (URL en launcher.config.json -> statusUrl).
 * Formato: { "maintenance": false, "message": "", "client_id": "<UUID opcional>" }. Cualquier fallo (sin red, sin URL, JSON malo,
 * tiempo agotado) devuelve null y el launcher abre con normalidad.
 */
const nodeFetch = require('node-fetch');
const cfg = require('../../../launcher.config.json');

const UA = 'PokecraftAdventure-Launcher';

/** GET con limite de tiempo total. Devuelve el texto o lanza. */
async function fetchText(url, timeoutMs) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
        const res = await nodeFetch(url, { headers: { 'User-Agent': UA, 'Cache-Control': 'no-cache' }, signal: ctrl.signal });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return await res.text();
    } finally {
        clearTimeout(timer);
    }
}

// Identificador de aplicacion de Azure: solo se acepta un UUID (8-4-4-4-12). Cualquier otra cosa se ignora.
const GUID = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
function validClientId(v) {
    return typeof v === 'string' && GUID.test(v.trim()) ? v.trim() : '';
}

/**
 * @returns {Promise<{maintenance:boolean,message:string,clientId?:string}|null>}
 * `clientId` solo aparece si status.json trae un "client_id" valido (permite cambiar la app de Azure sin version nueva).
 */
async function fetchStatus({ timeoutMs = 5000, url = cfg.statusUrl } = {}) {
    if (!url) return null;
    try {
        const data = JSON.parse(await fetchText(url, timeoutMs));
        if (!data || typeof data !== 'object') return null;
        const st = { maintenance: data.maintenance === true, message: typeof data.message === 'string' ? data.message : '' };
        const id = validClientId(data.client_id);
        if (id) st.clientId = id;
        return st;
    } catch (e) {
        return null;
    }
}

// Ultima respuesta remota del client_id (se reutiliza unos minutos para no repetir la peticion en cada inicio de sesion).
let idCache = null;

/**
 * client_id de Microsoft que se usa al iniciar o renovar sesion: el de status.json si hay y es valido; si no, el local
 * (`local`, normalmente launcher.config.json -> client_id; vacio = el que trae la libreria). Nunca lanza ni tarda mas de `timeoutMs`.
 * @returns {Promise<string>}
 */
async function resolveClientId(local = '', { url = cfg.statusUrl, timeoutMs = 3000, ttlMs = 10 * 60 * 1000, now = Date.now() } = {}) {
    if (!url) return local;
    if (idCache && idCache.url === url && now - idCache.at < ttlMs) return idCache.id || local;
    const st = await fetchStatus({ timeoutMs, url });
    if (st) idCache = { url, at: now, id: st.clientId || '' };   // sin respuesta (null) no se guarda: se reintenta la proxima vez
    return (st && st.clientId) || (idCache && idCache.url === url ? idCache.id : '') || local;
}

/** Solo para pruebas. */
function _resetClientIdCache() { idCache = null; }

module.exports = { fetchStatus, fetchText, resolveClientId, validClientId, _resetClientIdCache };
