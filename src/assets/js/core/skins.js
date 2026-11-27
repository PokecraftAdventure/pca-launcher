/**
 * Pokecraft Adventure Launcher
 *
 * Biblioteca de skins sobre los archivos de QuickSkin del cliente (mod QuickSkin 2.6.2.4), comprobados
 * en una instancia real:
 *   <instancia>/quickskin/uploads/skins/<nombre>.png     skins del jugador (el nombre es libre)
 *   <instancia>/config/quickskin-client.json             activeSkinHash y playerOwnSkinHash = SHA-1 del PNG
 *   <instancia>/config/quickskin_preferences.json        players.<uuid>.lastSkinId = SHA-1 del PNG
 * El hash de una skin es el SHA-1 de su PNG. Cambiar la skin activa solo es seguro con el juego CERRADO:
 * QuickSkin reescribe su configuracion al salir y pisaria el cambio.
 *
 * La instancia se fija una vez con configure(instanceDir); las cuentas van en un argumento opcional
 * {account:{name,uuid}}. Ademas guarda el historial de skins de cada cuenta (ver mas abajo).
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const zlib = require('zlib');
const EventEmitter = require('events');
const nodeFetch = require('node-fetch');
const datadir = require('./datadir');
const { removeSync } = require('./fsx');

const MAX_BYTES = 1024 * 1024;     // una skin real pesa unos KB; mas de 1 MB no es una skin
const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

let instanceDir = null;

/** Fija la carpeta de la instancia del juego (layout.instanceDir). */
function configure(dir) {
    instanceDir = dir || null;
}

function need() {
    if (!instanceDir) throw new Error('Skins: falta configurar la carpeta de la instancia');
    return instanceDir;
}

const skinsDir = () => path.join(need(), 'quickskin', 'uploads', 'skins');
const clientConfig = () => path.join(need(), 'config', 'quickskin-client.json');
const prefsFile = () => path.join(need(), 'config', 'quickskin_preferences.json');
const pendingFile = () => path.join(need(), 'config', 'pokecraft_adventure_pending_skin.json');
const resultFile = () => path.join(need(), 'config', 'pokecraft_adventure_pending_skin_result.json');

const sha1 = buf => crypto.createHash('sha1').update(buf).digest('hex');

function readJson(file) {
    try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return null; }
}

function writeJson(file, data) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
    fs.renameSync(tmp, file);
}

/**
 * Modelo de brazos de una skin: 'slim' (brazos de 3 px, el de Alex) o 'classic' (4 px, el de Steve).
 * Las skins delgadas dejan transparente la 4.a columna de cada brazo (x 54-55 del brazo derecho y x 46-47 del
 * izquierdo, en una skin de 64x64), asi que se mira esa zona. Solo lee PNG RGBA de 8 bits sin entrelazar; con
 * cualquier otra cosa devuelve 'classic'. (Las skins de Mojang traen su modelo y no pasan por aqui.)
 */
function detectModel(buf) {
    try {
        if (buf.length < 33 || buf.readUInt32BE(16) < 64) return 'classic';
        const w = buf.readUInt32BE(16), h = buf.readUInt32BE(20);
        if (buf[24] !== 8 || buf[25] !== 6 || buf[28] !== 0 || h !== w) return 'classic';   // 64x32 es siempre clasica
        const idat = [];
        for (let o = 8; o + 8 <= buf.length;) {
            const len = buf.readUInt32BE(o), type = buf.toString('ascii', o + 4, o + 8);
            if (type === 'IDAT') idat.push(buf.subarray(o + 8, o + 8 + len));
            if (type === 'IEND') break;
            o += 12 + len;
        }
        const raw = zlib.inflateSync(Buffer.concat(idat)), bpp = 4, stride = w * bpp, px = Buffer.alloc(h * stride);
        for (let y = 0; y < h; y++) {
            const f = raw[y * (stride + 1)];
            for (let x = 0; x < stride; x++) {
                const v = raw[y * (stride + 1) + 1 + x];
                const a = x >= bpp ? px[y * stride + x - bpp] : 0, up = y ? px[(y - 1) * stride + x] : 0, c = x >= bpp && y ? px[(y - 1) * stride + x - bpp] : 0;
                let r;
                if (f === 0) r = v; else if (f === 1) r = v + a; else if (f === 2) r = v + up; else if (f === 3) r = v + ((a + up) >> 1);
                else { const p = a + up - c, pa = Math.abs(p - a), pb = Math.abs(p - up), pc = Math.abs(p - c); r = v + (pa <= pb && pa <= pc ? a : pb <= pc ? up : c); }
                px[y * stride + x] = r & 255;
            }
        }
        const k = w / 64;
        const empty = (x0, x1, y0, y1) => {
            for (let y = Math.round(y0 * k); y < Math.round(y1 * k); y++) for (let x = Math.round(x0 * k); x < Math.round(x1 * k); x++) if (px[y * stride + x * 4 + 3] !== 0) return false;
            return true;
        };
        return empty(54, 56, 20, 32) && empty(46, 48, 52, 64) ? 'slim' : 'classic';
    } catch (e) { return 'classic'; }
}

/** Comprueba que sea un PNG con medidas de skin de Minecraft. Lanza con un mensaje claro si no. */
function validatePng(buf) {
    if (buf.length > MAX_BYTES) throw new Error('El archivo es demasiado grande para ser una skin');
    if (buf.length < 33 || !buf.subarray(0, 8).equals(PNG_SIG) || buf.toString('ascii', 12, 16) !== 'IHDR') {
        throw new Error('El archivo no es una imagen PNG');
    }
    const w = buf.readUInt32BE(16), h = buf.readUInt32BE(20);
    const ok = w >= 64 && w <= 1024 && w % 64 === 0 && (h === w || h === w / 2);
    if (!ok) throw new Error(`Medidas de skin no validas (${w}x${h}); se espera 64x64 o 64x32`);
}

/** Nombre de archivo seguro y sin extension. */
function cleanName(name) {
    const base = path.basename(String(name || ''), path.extname(String(name || '')));
    const s = base.replace(/[^\w\- ]+/g, '_').replace(/\s+/g, ' ').trim().slice(0, 40);
    return s || 'skin';
}

/** Hash de la skin activa segun la configuracion de QuickSkin (o null). */
function getActive() {
    const c = readJson(clientConfig());
    const h = c && typeof c.activeSkinHash === 'string' ? c.activeSkinHash : '';
    return h || null;
}

/** Skins de la biblioteca (PNG de uploads/skins), ordenadas por nombre. */
function listSkins() {
    const dir = skinsDir();
    let names = [];
    try { names = fs.readdirSync(dir).filter(n => /\.png$/i.test(n)); } catch (e) { return []; }
    const active = getActive();
    const out = [];
    for (const n of names) {
        try {
            const buf = fs.readFileSync(path.join(dir, n));
            const hash = sha1(buf);
            out.push({ hash, name: path.basename(n, path.extname(n)), file: path.join(dir, n), size: buf.length, active: hash === active });
        } catch (e) { /* archivo ilegible: se omite */ }
    }
    return out.sort((a, b) => a.name.localeCompare(b.name, 'es'));
}

// ---------------------------------------------------------------------------------------------
// Cuentas. Cada cuenta del launcher tiene su propia lista de skins, su skin en uso y su skin pendiente;
// la biblioteca de QuickSkin sigue siendo una sola por instancia.
// Clave de cuenta: premium -> uuid sin guiones en minusculas; no premium -> nombre en minusculas.
// (El UUID de una cuenta no premium es de version 3 y no existe en Mojang: no sirve de clave ni de consulta.)
// ---------------------------------------------------------------------------------------------
function isOfflineAccount(a) {
    if (!a || typeof a !== 'object') return false;
    if (a.premium === true || (a.meta && a.meta.type === 'Xbox')) return false;
    if (a.premium === false || (a.meta && a.meta.online === false)) return true;
    const u = String(a.uuid || '').replace(/-/g, '').toLowerCase();
    return /^[0-9a-f]{32}$/.test(u) && u[12] === '3';
}

/** Clave estable de una cuenta { name, uuid } (o '' si no hay datos validos). */
function accountKey(a) {
    if (!a || typeof a !== 'object') return '';
    if (!isOfflineAccount(a)) {
        const u = String(a.uuid || '').replace(/-/g, '').toLowerCase();
        if (/^[0-9a-f]{32}$/.test(u)) return u;
    }
    return /^\w{1,16}$/.test(String(a.name || '')) ? String(a.name).toLowerCase() : '';
}

/** Saca la cuenta de un argumento opcional { account:{name,uuid} }. */
const accountOf = o => (o && typeof o === 'object' && !Array.isArray(o) && o.account && typeof o.account === 'object') ? o.account : null;

// ---------------------------------------------------------------------------------------------
// Historial de skins. Vive en el directorio de datos del launcher (no en la instancia) y guarda una copia del
// PNG de cada skin, asi sobrevive a que se borre de QuickSkin o a reinstalar.
//   <datos>/skin-history.json  { version:2, entries:{ <hash>:{ name, origin, model?, firstSeen, owners:[clave], use:{ <clave>:{uses,lastUsed} } } },
//                                accounts:{ <clave>:{ current, lastActive, pending, lastResult, resultSeen } },
//                                lastSession:{ key,name,uuid,ts,synced }, mojang, mojangAll, legacyClaimed }
//   <datos>/skin-history/<hash>.png      copia de la skin
// origin: 'launcher' (importada desde el launcher) | 'game' (aparecio en QuickSkin, elegida dentro del juego) | 'mojang'.
// Migracion: las entradas de antes de las cuentas (sin `owners`) pasan a la primera cuenta que use la API con cuenta.
// Limite conocido: solo se ve la skin activa en cada sincronizacion y las que aparecen en la biblioteca;
// si en una sola sesion se prueban varias skins ya existentes, solo cuenta la ultima.
// ---------------------------------------------------------------------------------------------
const events = new EventEmitter();   // 'changed' cuando el historial cambia (para refrescar la pantalla)

const historyFile = () => path.join(datadir.dataDir(), 'skin-history.json');
const historyDir = () => path.join(datadir.dataDir(), 'skin-history');
const obj = v => (v && typeof v === 'object' && !Array.isArray(v) ? v : null);

/** Nombre con el que se muestra la skin por defecto del launcher. */
const DEFAULT_NAME = 'Entrenador';

function loadHistory() {
    const d = readJson(historyFile());
    const entries = obj(d && d.entries) || {};
    for (const e of Object.values(entries)) if (e && e.origin === 'default') e.name = DEFAULT_NAME;   // por si se guardo con otro nombre
    return {
        version: 2,
        lastActive: d && typeof d.lastActive === 'string' ? d.lastActive : null,   // solo de antes de las cuentas
        legacyClaimed: !!(d && d.legacyClaimed),
        entries,
        accounts: obj(d && d.accounts) || {},
        lastSession: obj(d && d.lastSession),
        mojang: obj(d && d.mojang),                    // cuenta consultada la ultima vez (para getCurrent sin cuenta)
        mojangAll: obj(d && d.mojangAll) || {}         // una entrada por cuenta (ver refreshMojang)
    };
}

const modelCache = new Map();   // hash -> modelo detectado de una skin que no lo trae anotado

/** Modelo de una skin del historial: el anotado o, si falta, el que se detecta en su copia. */
function modelOf(hash, entry) {
    if (entry && entry.model) return entry.model;
    if (modelCache.has(hash)) return modelCache.get(hash);
    let m = 'classic';
    try { m = detectModel(fs.readFileSync(path.join(historyDir(), hash + '.png'))); } catch (e) { /* sin copia: clasica */ }
    modelCache.set(hash, m);
    return m;
}

const saveHistory = state => writeJson(historyFile(), state);

/** Datos de una cuenta dentro del estado (se crean vacios si no existen). */
function acct(state, key) {
    state.accounts[key] = Object.assign({ current: null, lastActive: null, pending: null, lastResult: null, resultSeen: 0 }, state.accounts[key]);
    return state.accounts[key];
}

function addOwnerTo(entry, key) {
    if (!key || !entry) return false;
    entry.owners = Array.isArray(entry.owners) ? entry.owners : [];
    if (entry.owners.includes(key)) return false;
    entry.owners.push(key);
    return true;
}

const ownedBy = (entry, key) => !!entry && Array.isArray(entry.owners) && entry.owners.includes(key);

/** La cuenta descarta una skin: no se vuelve a adoptar ni a imponer. */
const dismiss = (a, hash) => { a.removed = Array.from(new Set([...(a.removed || []), hash])); };
const dismissed = (state, key, hash) => !!(key && state.accounts[key] && (state.accounts[key].removed || []).includes(hash));

/** Las entradas de antes de las cuentas pasan a la primera cuenta que aparezca. Devuelve true si cambio algo. */
function claimLegacy(state, key) {
    if (!key || state.legacyClaimed) return false;
    for (const e of Object.values(state.entries)) {
        if (Array.isArray(e.owners)) continue;
        e.owners = [key];
        if (e.uses || e.lastUsed) { e.use = e.use || {}; e.use[key] = { uses: e.uses || 0, lastUsed: e.lastUsed || null }; }
        delete e.uses; delete e.lastUsed;
    }
    if (state.lastActive) { const a = acct(state, key); a.current = a.lastActive = state.lastActive; }
    state.legacyClaimed = true;
    return true;
}

/** Carga el estado y reclama lo antiguo para la cuenta (si hay). Guarda si hubo migracion. */
function loadFor(account) {
    const state = loadHistory();
    const key = accountKey(account);
    if (claimLegacy(state, key)) saveHistory(state);
    return { state, key };
}

function keepCopy(hash, buf) {
    const f = path.join(historyDir(), hash + '.png');
    if (fs.existsSync(f)) return;
    fs.mkdirSync(historyDir(), { recursive: true });
    fs.writeFileSync(f, buf);
}

/**
 * Si la cuenta no tiene ninguna skin, le anota la de por defecto del launcher (origen 'default') para que su
 * biblioteca no se quede vacia (y se vea en el launcher). prepareLaunch la instala y la aplica cuando la cuenta no tiene
 * otra skin ni skin de Mojang. Devuelve true si cambio algo.
 */
function ensureDefault(state, key, now) {
    if (!key) return false;
    if (Object.values(state.entries).some(e => ownedBy(e, key))) return false;
    const d = getDefaultSkin();
    if (!d) return false;
    record(d.hash, state, { name: d.name, origin: 'default', buf: fs.readFileSync(d.file), now, owner: key });
    state.entries[d.hash].model = 'classic';
    return true;
}

/** Quita la skin de por defecto de la cuenta cuando ya tiene una de verdad (y no la habia elegido). */
function dropDefault(state, key) {
    const d = getDefaultSkin();
    const e = d && state.entries[d.hash];
    if (!e || !ownedBy(e, key) || e.origin !== 'default') return false;
    if (state.accounts[key] && (state.accounts[key].current === d.hash || state.accounts[key].pending === d.hash)) return false;   // la eligio
    e.owners = e.owners.filter(k => k !== key);
    if (e.use) delete e.use[key];
    if (!e.owners.length) {
        delete state.entries[d.hash];
        try { removeSync(path.join(historyDir(), d.hash + '.png')); } catch (er) { /* copia ya borrada */ }
    }
    return true;
}

/** Anota una skin en el historial (si no estaba), le anade dueno y guarda su copia. Devuelve true si es nueva. */
function record(h, state, { name, origin, buf, now, owner }) {
    let isNew = false;
    if (!state.entries[h]) {
        state.entries[h] = { name, origin, firstSeen: now, model: detectModel(buf) };
        isNew = true;
    } else if (name && state.entries[h].name !== name) {
        state.entries[h].name = name;
    }
    if (owner) addOwnerTo(state.entries[h], owner);
    keepCopy(h, buf);
    return isNew;
}

const usesOf = (entry, key) => (key ? (entry.use && entry.use[key]) || { uses: 0, lastUsed: null } : { uses: entry.uses || 0, lastUsed: entry.lastUsed || null });

function bumpUse(entry, key, now) {
    entry.use = entry.use || {};
    const u = entry.use[key] = Object.assign({ uses: 0, lastUsed: null }, entry.use[key]);
    u.uses++; u.lastUsed = now;
}

// ---------------------------------------------------------------------------------------------
// Importar, activar y dejar pendiente
// ---------------------------------------------------------------------------------------------

/** Copia un PNG a la biblioteca. Si ya hay una skin igual no la duplica (existed: true). importSkin(ruta, nombre?, {account}?) */
function importSkin(file, displayName, opts) {
    if (displayName && typeof displayName === 'object') { opts = displayName; displayName = undefined; }
    const key = accountKey(accountOf(opts));
    const buf = fs.readFileSync(file);
    validatePng(buf);
    const hash = sha1(buf);
    const present = listSkins().find(s => s.hash === hash);
    const skin = present || installInLibrary(buf, displayName || file);
    noteImported(hash, skin.name, buf, key, accountOf(opts));
    return present
        ? Object.assign({}, present, { existed: true })
        : { hash, name: skin.name, file: skin.file, size: buf.length, active: hash === getActive(), existed: false };
}

/** Copia un PNG a la biblioteca de QuickSkin con un nombre libre. @returns {{name:string, file:string}} */
function installInLibrary(buf, displayName) {
    const dir = skinsDir();
    fs.mkdirSync(dir, { recursive: true });
    const base = cleanName(displayName);
    let name = base, i = 2;
    while (fs.existsSync(path.join(dir, name + '.png'))) name = `${base} (${i++})`;
    const file = path.join(dir, name + '.png');
    fs.writeFileSync(file, buf);
    return { name, file };
}

/** Anota en el historial una skin que entro por el launcher (origen 'launcher'). No falla si no se puede guardar. */
function noteImported(hash, name, buf, key, account) {
    try {
        const { state } = loadFor(account);
        const isNew = record(hash, state, { name, origin: 'launcher', buf, now: Date.now(), owner: key });
        if (key && state.accounts[key] && Array.isArray(state.accounts[key].removed)) state.accounts[key].removed = state.accounts[key].removed.filter(x => x !== hash);   // volver a importarla la recupera
        saveHistory(state);
        events.emit('changed', { added: isNew ? [hash] : [], active: getActive(), activeChanged: false, account: key });
    } catch (e) { /* el historial es un extra: no debe impedir importar */ }
}

/**
 * Escribe la skin activa en la configuracion de QuickSkin (activeSkinHash y lastSkinId de los jugadores conocidos),
 * conservando el resto; '' = ninguna (QuickSkin usa la de Mojang). No toca playerOwnSkinHash (QuickSkin lo recalcula al
 * arrancar). Por si sola no cambia lo que se ve en el servidor: para eso esta queueApply. Solo con el juego cerrado.
 */
function writeActiveConfig(h) {
    const cfg = readJson(clientConfig()) || {};
    cfg.activeSkinHash = h;
    writeJson(clientConfig(), cfg);
    const prefs = readJson(prefsFile());
    if (prefs && prefs.players && typeof prefs.players === 'object') {
        for (const p of Object.values(prefs.players)) if (p && typeof p === 'object') p.lastSkinId = h;
        writeJson(prefsFile(), prefs);
    }
}

/**
 * Deja una skin pendiente para el siguiente juego: el mod Client Utilities la aplica con QuickSkin al entrar
 * al servidor (aplica en local y la sube). Escribe config/pokecraft_adventure_pending_skin.json y la anota
 * como pendiente de la cuenta. queueApply(hash, {account}?)
 */
function queueApply(hash, opts) {
    const h = String(hash || '').toLowerCase();
    if (!/^[0-9a-f]{40}$/.test(h)) throw new Error('Hash de skin no valido');
    if (!listSkins().some(s => s.hash === h)) throw new Error('Esa skin no esta en la biblioteca');
    const account = accountOf(opts);
    const { state, key } = loadFor(account);
    const file = key ? { hash: h, account: key } : { hash: h };
    writeJson(pendingFile(), file);
    try { removeSync(resultFile()); } catch (e) { /* sin resultado anterior */ }
    if (key) { acct(state, key).pending = h; saveHistory(state); }
    return { hash: h };
}

/** Skin esperando a aplicarse (hash) o null. Con cuenta: la pendiente de esa cuenta. */
function getPending(opts) {
    const account = accountOf(opts);
    if (account) {
        const { state, key } = loadFor(account);
        return key ? (state.accounts[key] && state.accounts[key].pending) || null : null;
    }
    const p = readJson(pendingFile());
    return p && typeof p.hash === 'string' ? p.hash : null;
}

const readResultFile = () => { const r = readJson(resultFile()); return r && r.status ? r : null; };

/** Anota en la cuenta el resultado que dejo el mod (si es nuevo). Devuelve true si cambio algo. */
function absorbResult(state, key) {
    const r = readResultFile();
    if (!r || !key) return false;
    const a = acct(state, key);
    if (!(r.time > a.resultSeen)) return false;
    a.lastResult = r; a.resultSeen = r.time;
    if (a.pending === r.hash) a.pending = null;
    if (r.status === 'applied' && state.entries[r.hash]) { a.current = r.hash; a.lastActive = r.hash; addOwnerTo(state.entries[r.hash], key); }
    return true;
}

/** Resultado de la ultima aplicacion: { hash, status:'applied'|'error', detail, time } o null. getApplyResult({account}?) */
function getApplyResult(opts) {
    const account = accountOf(opts);
    if (!account) return readResultFile();
    const { state, key } = loadFor(account);
    if (!key) return null;
    const ses = state.lastSession;
    // El archivo lo escribe el mod sin cuenta: se atribuye a quien lanzo el juego.
    if (!(ses && !ses.synced && ses.key !== key) && absorbResult(state, key)) saveHistory(state);
    return (state.accounts[key] && state.accounts[key].lastResult) || null;
}

// ---------------------------------------------------------------------------------------------
// Sincronizar con lo que dejo QuickSkin
// ---------------------------------------------------------------------------------------------
const nameRe = n => new RegExp('^' + String(n).replace(/[^\w]/g, '') + '(_\\d+)?$', 'i');

/**
 * Lee lo que dejo QuickSkin (skins nuevas y skin activa) y lo anota. sync({account, now}?) o sync(ts).
 * - Se atribuye a la cuenta que lanzo el ultimo juego (ver prepareLaunch); si nunca se preparo un lanzamiento,
 *   a la cuenta que pide la sincronizacion. Las skins nuevas de la biblioteca van a esa cuenta.
 * - Se llama solo al cerrarse el juego (gamelog) y al abrir la pantalla de skins.
 * @returns {{added:string[], active:string|null, activeChanged:boolean}}
 */
function sync(arg) {
    const o = typeof arg === 'number' ? { now: arg } : (arg || {});
    const now = o.now || Date.now();
    const { state, key: viewKey } = loadFor(o.account);
    let dirty = false;
    const ses = state.lastSession;
    const playKey = ses && !ses.synced ? ses.key : (!ses ? viewKey : '');
    const ownerKey = playKey || viewKey;
    const added = [];

    for (const s of listSkins()) {
        let buf;
        try { buf = fs.readFileSync(s.file); } catch (e) { continue; }
        // QuickSkin guarda la skin propia de Mojang como <nombre>.png (o <nombre>_N.png) y la vuelve a codificar,
        // asi que su hash no coincide con el PNG original que baja el launcher: se reconoce por el nombre.
        const mj = Object.values(state.mojangAll).find(m => m && m.name && nameRe(m.name).test(s.name));
        // Una skin que ya estaba no se atribuye a quien juega ahora; una que la cuenta elimino y sigue en la biblioteca tampoco.
        const skip = dismissed(state, ownerKey, s.hash);
        const owner = mj ? mj.key : (state.entries[s.hash] || skip ? '' : ownerKey);
        if (skip && !mj && !state.entries[s.hash]) continue;   // el archivo no se pudo borrar: no se vuelve a anotar
        const isNew = record(s.hash, state, { name: s.name, origin: mj ? 'mojang' : 'game', buf, now, owner });
        if (isNew) { added.push(s.hash); dirty = true; }
        if (mj && mj.hash && mj.hash !== s.hash) {
            const raw = state.entries[mj.hash];
            const rawUsed = raw && raw.use && Object.values(raw.use).some(u => u.uses);
            if (raw && raw.origin === 'mojang' && !raw.uses && !rawUsed) {      // la copia del launcher sobra: queda la de QuickSkin
                delete state.entries[mj.hash];
                try { removeSync(path.join(historyDir(), mj.hash + '.png')); } catch (e) { /* copia ya borrada */ }
                if (raw.model) state.entries[s.hash].model = raw.model;
                for (const a of Object.values(state.accounts)) { if (a.current === mj.hash) a.current = s.hash; if (a.lastActive === mj.hash) a.lastActive = s.hash; }
                const moved = Object.assign({}, mj, { hash: s.hash });
                state.mojangAll[mj.key] = moved;
                if (state.mojang && state.mojang.key === mj.key) state.mojang = moved;
                dirty = true;
            }
        }
    }

    const active = getActive();
    let activeChanged = false;
    if (active && state.entries[active]) {
        if (playKey && !dismissed(state, playKey, active)) {
            const e = state.entries[active];
            if (addOwnerTo(e, playKey)) dirty = true;
            const a = acct(state, playKey);
            if (a.lastActive !== active) { bumpUse(e, playKey, now); a.lastActive = active; activeChanged = true; dirty = true; }
            if (a.current !== active) { a.current = active; dirty = true; }
        } else if (!viewKey && !ses && state.lastActive !== active) {   // sin cuentas (uso antiguo)
            const e = state.entries[active];
            e.uses = (e.uses || 0) + 1; e.lastUsed = now; state.lastActive = active;
            activeChanged = true; dirty = true;
        }
    }
    if (playKey && absorbResult(state, playKey)) dirty = true;
    if (o.closing && ses && !ses.synced) { ses.synced = true; dirty = true; }

    if (dirty) {
        saveHistory(state);
        events.emit('changed', { added, active, activeChanged, account: playKey || viewKey });
    }
    return { added, active, activeChanged };
}

/** Como sync() al cerrarse el juego, pero sin lanzar nunca y sin hacer nada si aun no se configuro la instancia. */
function autoSync(now) {
    if (!instanceDir) return null;
    try { return sync({ now, closing: true }); } catch (e) { return null; }
}

/**
 * Por que una skin de la cuenta no se puede eliminar: 'MOJANG_SKIN' (es la skin de Mojang de la cuenta),
 * 'LAST_SKIN' (es la unica que le queda y la cuenta no tiene skin de Mojang: sin ella el launcher
 * se quedaria sin nada que mostrar) o null si se puede eliminar.
 */
function protectedReason(state, key, hash) {
    if (!key) return null;
    const mj = state.mojangAll[key];
    if (mj && mj.hash === hash) return 'MOJANG_SKIN';
    const owned = Object.entries(state.entries).filter(([, e]) => ownedBy(e, key)).map(([h]) => h);
    const hasMojang = !!(mj && mj.hash && owned.includes(mj.hash));
    if (!hasMojang && owned.length === 1 && owned[0] === hash) return 'LAST_SKIN';
    return null;
}

/** Skins usadas, la mas reciente primero. getHistory({account}?) con cuenta: solo las de esa cuenta. */
function getHistory(opts) {
    const account = accountOf(opts);
    const { state, key } = loadFor(account);
    // Una cuenta no premium (o sin skin en Mojang) que aun no tiene ninguna ve la de por defecto en su biblioteca.
    if (key && (isOfflineAccount(account) || (state.mojangAll[key] && state.mojangAll[key].status === 'none')) && ensureDefault(state, key, Date.now())) saveHistory(state);
    const inLib = new Set(instanceDir ? listSkins().map(s => s.hash) : []);
    let current = key ? (state.accounts[key] && state.accounts[key].current) || null : (instanceDir ? getActive() : null);
    // Sin otra skin en uso, la de por defecto cuenta como la que esta en uso (es la que se muestra en el launcher).
    if (key && !current) { const d = getDefaultSkin(); if (d && ownedBy(state.entries[d.hash], key)) current = d.hash; }
    return Object.entries(state.entries)
        .filter(([, e]) => !key || ownedBy(e, key))
        .map(([hash, e]) => {
            const u = usesOf(e, key), protectedBy = protectedReason(state, key, hash);
            return {
                hash, name: e.name, origin: e.origin, model: modelOf(hash, e), firstSeen: e.firstSeen, lastUsed: u.lastUsed, uses: u.uses,
                active: hash === current, inLibrary: inLib.has(hash), file: path.join(historyDir(), hash + '.png'),
                // No eliminables: la skin de Mojang de la cuenta y su unica skin si no tiene la de Mojang (ver removeSkin).
                removable: protectedBy === null,
                protectedBy                                      // 'MOJANG_SKIN' | 'LAST_SKIN' | null
            };
        })
        .sort((a, b) => (b.lastUsed || b.firstSeen) - (a.lastUsed || a.firstSeen));
}

/**
 * Elimina una skin de la lista de una cuenta. removeSkin(hash, {account}) -> { removed, deletedFile, activeCleared, pendingCleared }
 * - Quita a la cuenta de los duenos. Si ya no queda ninguno, borra el PNG de la biblioteca de QuickSkin
 *   (quickskin/uploads/skins) y la copia del historial; si otra cuenta la tiene, NO se borra ningun archivo.
 * - Si era la skin pendiente de la cuenta, limpia el pendiente; si era la que usaba, la cuenta deja de apuntar a ella
 *   (prepareLaunch dejara QuickSkin sin skin activa y usara la de Mojang). No toca activeSkinHash: eso es de prepareLaunch.
 * - La skin de Mojang de la cuenta NO se puede eliminar: QuickSkin la vuelve a crear en cada arranque (skin propia) y
 *   el launcher la repone al consultar a Mojang, asi que borrarla no tendria efecto. Lanza error con code 'MOJANG_SKIN'
 *   (getHistory marca esas skins con removable:false). Una skin de Mojang que ya no es la actual si se puede eliminar.
 * - Tampoco se puede eliminar la UNICA skin de una cuenta que no tiene skin de Mojang (error con code 'LAST_SKIN'):
 *   sin ella el launcher no tendria nada que mostrar. Con una skin de Mojang en su lista, el resto se pueden eliminar libremente.
 * - Si el archivo no se puede borrar, la cuenta la recuerda como descartada para que sync no la vuelva a adoptar.
 * Lanza error con mensaje claro si la skin no existe o no es de la cuenta. Con el juego cerrado (lo exige el visual).
 */
function removeSkin(hash, opts) {
    const h = String(hash || '').toLowerCase();
    const { state, key } = loadFor(accountOf(opts));
    if (!key) throw new Error('Falta la cuenta');
    const entry = state.entries[h];
    if (!entry) throw new Error('Esa skin no esta en el historial');
    if (!ownedBy(entry, key)) throw new Error('Esa skin no es de esta cuenta');
    const why = protectedReason(state, key, h);
    if (why) {
        const err = new Error(why === 'MOJANG_SKIN' ? 'La skin de Mojang no se puede eliminar' : 'Es tu unica skin: agrega otra antes de eliminarla');
        err.code = why;
        throw err;
    }
    const a = acct(state, key);
    entry.owners = entry.owners.filter(k => k !== key);
    if (entry.use) delete entry.use[key];
    let pendingCleared = false, activeCleared = false;
    if (a.pending === h) { a.pending = null; pendingCleared = true; }
    const pf = readJson(pendingFile());
    if (pf && pf.hash === h && (!pf.account || pf.account === key)) { try { removeSync(pendingFile()); } catch (e) { /* sin archivo */ } pendingCleared = true; }
    if (a.current === h) { a.current = null; activeCleared = true; }
    if (a.lastActive === h) a.lastActive = null;

    // Si elimina la skin por defecto a proposito, no se le vuelve a imponer.
    if (entry.origin === 'default') dismiss(a, h);

    let deletedFile = false;
    if (!entry.owners.length) {
        let failed = false;
        try {
            if (instanceDir) for (const s of listSkins()) if (s.hash === h) { try { removeSync(s.file); deletedFile = true; } catch (e) { failed = true; } }
        } catch (e) { failed = true; }
        try { removeSync(path.join(historyDir(), h + '.png')); } catch (e) { /* copia ya borrada */ }
        delete state.entries[h];
        if (failed) dismiss(a, h);
    } else {
        dismiss(a, h);                  // sigue en la biblioteca por otra cuenta: no se readopta
    }
    saveHistory(state);
    events.emit('changed', { added: [], active: null, activeChanged: false, removed: h, account: key });
    return { removed: true, deletedFile, activeCleared, pendingCleared };
}

/**
 * Vuelve a usar una skin del historial en el siguiente juego: si ya no esta en QuickSkin la devuelve a su
 * biblioteca desde la copia del launcher y la deja pendiente. Con el juego cerrado. reuse(hash, {account}?)
 */
function reuse(hash, opts) {
    const h = String(hash || '').toLowerCase();
    const account = accountOf(opts);
    const { state, key } = loadFor(account);
    const entry = state.entries[h];
    if (!entry) throw new Error('Esa skin no esta en el historial');
    if (key && !ownedBy(entry, key)) throw new Error('Esa skin no es de esta cuenta');
    let restored = false;
    if (!listSkins().some(s => s.hash === h)) {
        const copy = path.join(historyDir(), h + '.png');
        if (!fs.existsSync(copy)) throw new Error('Falta la copia de la skin');
        importSkin(copy, entry.name, account ? { account } : undefined);
        restored = true;
    }
    queueApply(h, account ? { account } : undefined);
    return { hash: h, restored };
}

/**
 * Prepara QuickSkin para la cuenta que va a jugar. LLAMAR justo antes de lanzar el juego (con el juego cerrado):
 * la configuracion de QuickSkin es una sola por instancia, asi que sin esto una cuenta heredaria la skin de otra.
 *  - Si la cuenta tiene una skin pendiente o en uso, la deja como activa (y como pendiente si fue elegida desde el
 *    launcher, para que el mod la aplique y la suba al entrar).
 *  - Si no tiene ninguna, deja QuickSkin sin skin activa: usara la de Mojang de esa cuenta.
 * Anota quien lanza para atribuirle despues lo que cambie en el juego. prepareLaunch({account})
 * @returns {{hash:string|null, pending:boolean}|null}
 */
function prepareLaunch(opts) {
    const account = accountOf(opts) || (opts && (opts.name || opts.uuid) ? opts : null);
    const { state, key } = loadFor(account);
    if (!key) return null;
    const a = acct(state, key);
    state.lastSession = { key, name: account.name || '', uuid: account.uuid || '', ts: Date.now(), synced: false };

    let target = a.pending || a.current || null;
    if (target && !ownedBy(state.entries[target], key)) target = null;
    let usingDefault = false;
    if (!target) {
        // Sin skin elegida y sin skin de Mojang (Mojang ya confirmo que no hay): entra con la skin por defecto del
        // launcher. Se instala en QuickSkin, se aplica y se sube al servidor como cualquier otra. Si Mojang aun no se
        // consulto no se fuerza (podria pisar la skin real de la cuenta): el visual debe esperar a refreshMojang antes.
        const d = getDefaultSkin();
        const mj = state.mojangAll[key];
        if (d && mj && mj.status === 'none' && !dismissed(state, key, d.hash)) {
            try {
                const buf = fs.readFileSync(d.file);
                record(d.hash, state, { name: d.name, origin: 'default', buf, now: Date.now(), owner: key });
                state.entries[d.hash].model = 'classic';
                if (!listSkins().some(s => s.hash === d.hash)) installInLibrary(buf, d.name);
                target = d.hash; a.pending = d.hash; usingDefault = true;
            } catch (e) { target = null; }
        }
    }
    let pending = false;
    if (target) {
        if (!listSkins().some(s => s.hash === target)) {
            const copy = path.join(historyDir(), target + '.png');
            if (fs.existsSync(copy)) importSkin(copy, state.entries[target].name, { account });
            else target = null;
        }
    }
    if (target) {
        writeActiveConfig(target);
        if (a.pending === target) { writeJson(pendingFile(), { hash: target, account: key }); pending = true; }
        else { try { removeSync(pendingFile()); } catch (e) { /* sin pendiente */ } }
    } else {
        writeActiveConfig('');
        try { removeSync(pendingFile()); } catch (e) { /* sin pendiente */ }
        a.pending = null;
    }
    try { removeSync(resultFile()); } catch (e) { /* sin resultado anterior */ }
    saveHistory(state);
    return usingDefault ? { hash: target, pending, default: true } : { hash: target, pending };
}

// ---------------------------------------------------------------------------------------------
// Skin de Mojang y "skin actual" para mostrar en el launcher.
// El launcher consulta a Mojang por su cuenta (no depende de que el juego se haya abierto): premium por UUID,
// no premium por nombre (si ese nombre existe en Mojang toma su skin; si no, no hay skin y se usa la de por defecto).
// El resultado se guarda en el historial (origen 'mojang') y se recuerda 24 h por cuenta.
// ---------------------------------------------------------------------------------------------
const MOJANG_API = 'https://api.mojang.com';
const MOJANG_SESSION = 'https://sessionserver.mojang.com';
const MOJANG_TTL_MS = 24 * 3600 * 1000;   // skin encontrada o cuenta inexistente
const MOJANG_RETRY_MS = 5 * 60 * 1000;    // fallo de red: reintentar pronto
const MOJANG_TIMEOUT_MS = 8000;

async function httpGet(url, timeoutMs, fetchFn = nodeFetch) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
        return await fetchFn(url, { headers: { 'User-Agent': 'PokecraftAdventure-Launcher' }, signal: ctrl.signal });
    } finally { clearTimeout(timer); }
}

/**
 * Trae la skin de Mojang de la cuenta y la anota en el historial de esa cuenta (origen 'mojang').
 * @param {{name?:string, uuid?:string, premium?:boolean, force?:boolean, timeoutMs?:number}} account
 *   premium: uuid; no premium: name (su UUID no existe en Mojang y se ignora)
 * @param {object} [opts] solo pruebas: { api, session, trustTextureHost, now }
 * @returns {Promise<object|null>} la skin actual de la cuenta (ver getCurrent) o null. Nunca lanza.
 */
async function refreshMojang(account = {}, opts = {}) {
    let ctx = null;   // para anotar el fallo de red si llega a lanzar
    try {
        const offline = isOfflineAccount(account);
        const name = /^\w{1,16}$/.test(String(account.name || '')) ? String(account.name) : '';
        const uuid = String(account.uuid || '').replace(/-/g, '').toLowerCase();
        const validUuid = !offline && /^[0-9a-f]{32}$/.test(uuid) ? uuid : '';
        if (!name && !validUuid) return findCurrent({ account });
        const key = accountKey(account) || validUuid || name.toLowerCase();
        const now = opts.now || Date.now();
        const api = opts.api || MOJANG_API, session = opts.session || MOJANG_SESSION;
        const timeout = account.timeoutMs || MOJANG_TIMEOUT_MS;
        const { state } = loadFor(account);
        const cached = state.mojangAll[key] || null;
        if (!account.force && cached) {
            const ttl = cached.status === 'error' ? MOJANG_RETRY_MS : MOJANG_TTL_MS;
            if (now - cached.fetchedAt < ttl) return findCurrent({ account });
        }
        const base = { key, name: name || (cached ? cached.name : ''), fetchedAt: now, hash: null, model: 'classic' };
        const fail = status => {
            const e = Object.assign({}, cached || {}, base, { status, hash: cached ? cached.hash : null });
            state.mojangAll[key] = e; state.mojang = e;
            // Sin skin de Mojang (la cuenta no tiene o el nombre no existe): la biblioteca no se queda vacia.
            if (status === 'none' || (status === 'error' && offline)) ensureDefault(state, key, now);
            saveHistory(state);
            return findCurrent({ account });
        };
        ctx = { fail };

        // 1) UUID (premium ya lo trae; no premium: por nombre)
        let id = validUuid, realName = name;
        if (!id) {
            const r = await httpGet(`${api}/users/profiles/minecraft/${encodeURIComponent(name)}`, timeout, opts.fetch);
            if (r.status === 204 || r.status === 404) return fail('none');          // el nombre no existe en Mojang
            if (!r.ok) return fail('error');
            const j = await r.json();
            id = String(j.id || '').toLowerCase();
            realName = j.name || name;
            if (!/^[0-9a-f]{32}$/.test(id)) return fail('none');
        }
        // 2) Perfil con la textura
        const pr = await httpGet(`${session}/session/minecraft/profile/${id}`, timeout, opts.fetch);
        if (pr.status === 204 || pr.status === 404) return fail('none');
        if (!pr.ok) return fail('error');
        const profile = await pr.json();
        realName = profile.name || realName;
        const prop = (profile.properties || []).find(p => p && p.name === 'textures');
        const tex = prop ? JSON.parse(Buffer.from(prop.value, 'base64').toString('utf8')) : null;
        const skin = tex && tex.textures && tex.textures.SKIN;
        if (!skin || !skin.url) return fail('none');                                   // cuenta sin skin propia: la de por defecto
        const model = skin.metadata && skin.metadata.model === 'slim' ? 'slim' : 'classic';
        if (!opts.trustTextureHost && !/^https?:\/\/textures\.minecraft\.net\//.test(skin.url)) return fail('error');
        // 3) PNG
        const tr = await httpGet(skin.url, timeout, opts.fetch);
        if (!tr.ok) return fail('error');
        const buf = Buffer.from(await tr.arrayBuffer());
        validatePng(buf);
        const hash = sha1(buf);
        record(hash, state, { name: realName, origin: 'mojang', buf, now, owner: key });
        state.entries[hash].model = model;
        state.mojang = { key, name: realName, fetchedAt: now, status: 'ok', hash, model };
        state.mojangAll[key] = state.mojang;
        dropDefault(state, key);          // ya hay una skin de verdad: la de por defecto sobra
        saveHistory(state);
        events.emit('changed', { added: [hash], active: null, activeChanged: false, mojang: true, account: key });
        return findCurrent({ account });
    } catch (e) {
        if (process.env.PCA_DEBUG_SKINS) console.error('refreshMojang:', e);
        if (ctx) return ctx.fail('error');   // sin red o respuesta rota: se reintenta en unos minutos
        return findCurrent({ account });
    }
}

// Skin por defecto del launcher (la que se muestra cuando la cuenta no tiene ninguna). Es solo para mostrar en el
// launcher: no se instala en QuickSkin ni se sube al servidor.
const DEFAULT_SKIN_FILE = path.join(__dirname, '..', '..', 'defaults', 'skin-default.png');

/** @returns {{source:'default', hash:string, name:string, model:'classic', file:string}|null} */
function getDefaultSkin() {
    try {
        const buf = fs.readFileSync(DEFAULT_SKIN_FILE);
        return { source: 'default', hash: sha1(buf), name: DEFAULT_NAME, model: 'classic', file: DEFAULT_SKIN_FILE };
    } catch (e) { return null; }
}

/**
 * La skin que debe mostrar el launcher. getCurrent({account}?)
 * Con cuenta: la skin en uso de esa cuenta (la que dejo al jugar) y, si aun no tiene ninguna, su skin de Mojang.
 * Sin cuenta (uso antiguo): la activa de QuickSkin y, si no hay, la de Mojang consultada la ultima vez.
 * Si no hay ninguna devuelve la skin por defecto del launcher (source 'default'); con { fallback: false } devuelve null.
 * @returns {{source:'quickskin'|'mojang'|'default', hash:string, name:string, model:string, file:string}|null}
 */
function getCurrent(opts) {
    return findCurrent(opts) || (opts && opts.fallback === false ? null : getDefaultSkin());
}

/** Igual que getCurrent pero sin skin por defecto: null si la cuenta no tiene ninguna. */
function findCurrent(opts) {
    const account = accountOf(opts);
    const { state, key } = loadFor(account);
    const describe = (hash, source) => {
        const e = state.entries[hash];
        const copy = path.join(historyDir(), hash + '.png');
        return e && fs.existsSync(copy) ? { source, hash, name: e.name, model: modelOf(hash, e), file: copy } : null;
    };
    const srcOf = hash => (state.entries[hash] && state.entries[hash].origin === 'mojang' ? 'mojang' : 'quickskin');
    if (key) {
        const cur = state.accounts[key] && state.accounts[key].current;
        const c = cur && ownedBy(state.entries[cur], key) ? describe(cur, srcOf(cur)) : null;
        if (c) return c;
        const m = state.mojangAll[key];
        return m && m.hash ? describe(m.hash, 'mojang') : null;
    }
    let active = null;
    if (instanceDir) { try { active = getActive(); } catch (e) { active = null; } }
    if (active) {
        const cur = describe(active, srcOf(active));
        if (cur) return cur;
        // La activa aun no esta en el historial (juego recien cerrado): leerla de la biblioteca de QuickSkin.
        try {
            const s = listSkins().find(x => x.hash === active);
            if (s) { let m = 'classic'; try { m = detectModel(fs.readFileSync(s.file)); } catch (er) { /* sin lectura */ } return { source: 'quickskin', hash: active, name: s.name, model: m, file: s.file }; }
        } catch (er) { /* sin biblioteca */ }
    }
    const m = state.mojang;
    return m && m.hash ? describe(m.hash, 'mojang') : null;
}

module.exports = {
    configure, listSkins, importSkin, getActive, queueApply, getPending, getApplyResult, validatePng,
    sync, autoSync, getHistory, reuse, events, refreshMojang, getCurrent, getDefaultSkin,
    accountKey, prepareLaunch, removeSkin
};
