/**
 * Pokecraft Adventure Launcher
 *
 * Mover la instalacion a otra carpeta (el jugador elige donde vive el juego).
 * Mueve TODO el contenido de la carpeta de instalacion actual (se lee con readdir, no hay lista fija):
 * copia archivo a archivo (con progreso), comprueba que cada archivo llego con su tamano y solo entonces borra lo antiguo.
 *
 * La raiz de la instalacion deberia ser siempre propia (`<elegida>\Pokecraft Adventure`, ver
 * paths.withSubfolder). Si una instalacion antigua vive en una carpeta compartida (tiene cosas que no
 * son del launcher), `planMove` lo marca como `shared` y `moveInstall` exige `confirmShared: true`.
 *
 * Borrado de lo antiguo: si algun archivo no se puede borrar (por ejemplo un Java de una carga cancelada que sigue abierto
 * y lo tiene en uso) NO es un fallo del movimiento: la copia ya esta verificada y la instalacion nueva es la buena.
 * `moveInstall` devuelve esos archivos en `leftovers` para que el launcher avise y el jugador pueda borrarlos luego.
 */
const fs = require('fs');
const path = require('path');
const { freeSpace, ensureDir, SUBFOLDER } = require('./paths');
const { removeSync } = require('./fsx');

// Lo que crea el launcher / minecraft-java-core en la raiz. Cualquier otra cosa hace la carpeta "compartida".
const KNOWN = ['instances', '.launcher', 'assets', 'libraries', 'loader', 'runtime', 'versions'];

const BIG_FILE = 32 * 1024 * 1024;      // por encima de esto se copia a trozos para que la barra avance
const PROGRESS_MS = 120;                // las ventanas no necesitan mas de ~8 avisos por segundo

function dirSize(p) {
    const st = fs.lstatSync(p);
    if (!st.isDirectory()) return st.size;
    let total = 0;
    for (const e of fs.readdirSync(p)) total += dirSize(path.join(p, e));
    return total;
}

function sameOrInside(a, b) {
    const ra = path.resolve(a).toLowerCase() + path.sep;
    const rb = path.resolve(b).toLowerCase() + path.sep;
    return ra.startsWith(rb) || rb.startsWith(ra);
}

// Datos del propio launcher (core/datadir.js): viven en <appData>/.pokecraftadventure, que es tambien la
// carpeta de instalacion por defecto. Se quedan donde estan: no son parte de la instalacion.
const LAUNCHER_DATA = ['news-cache.json', 'playstats.json', 'skin-history.json', 'skin-history', 'news-images', 'log-window.json'];

function listEntries(dir) {
    try { return fs.readdirSync(dir).filter(n => !LAUNCHER_DATA.includes(n)); } catch (e) { return []; }
}

/**
 * Lo que se movera, sin tocar nada. Para avisar al jugador antes.
 * @returns {{entries:string[], count:number, bytes:number, shared:boolean, extra:string[]}}
 */
function planMove(from) {
    const entries = listEntries(from);
    const bytes = entries.reduce((a, n) => a + dirSize(path.join(from, n)), 0);
    const extra = entries.filter(n => !KNOWN.includes(n));
    return { entries, count: entries.length, bytes, shared: extra.length > 0, extra };
}

/** Recorre las entradas y devuelve { dirs, files:[{rel,size}], links:[rel], bytes } (rutas relativas a `root`). */
function walk(root, entries) {
    const dirs = [], files = [], links = [];
    let bytes = 0;
    const visit = rel => {
        const full = path.join(root, rel);
        const st = fs.lstatSync(full);
        if (st.isSymbolicLink()) { links.push(rel); return; }
        if (st.isDirectory()) {
            dirs.push(rel);
            for (const n of fs.readdirSync(full)) visit(path.join(rel, n));
        } else {
            files.push({ rel, size: st.size });
            bytes += st.size;
        }
    };
    for (const n of entries) visit(n);
    return { dirs, files, links, bytes };
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
const RETRY = new Set(['EBUSY', 'EPERM', 'EACCES', 'ENOTEMPTY']);

/** Copia un archivo; los grandes a trozos para poder informar del avance dentro del archivo. */
async function copyOne(src, dst, size, onBytes) {
    await fs.promises.mkdir(path.dirname(dst), { recursive: true });
    if (size < BIG_FILE) {
        await fs.promises.copyFile(src, dst);
        onBytes(size);
        return;
    }
    await new Promise((resolve, reject) => {
        const rs = fs.createReadStream(src, { highWaterMark: 4 * 1024 * 1024 });
        const ws = fs.createWriteStream(dst);
        rs.on('data', c => onBytes(c.length));
        rs.on('error', reject);
        ws.on('error', reject);
        ws.on('finish', resolve);
        rs.pipe(ws);
    });
}

/** Borra un archivo reintentando unas veces si esta en uso. Devuelve true si se borro. */
async function removeFile(p) {
    for (let i = 0; i < 4; i++) {
        try { removeSync(p); return !fs.existsSync(p); }
        catch (e) { if (!RETRY.has(e.code)) return false; await sleep(150 * (i + 1)); }
    }
    return false;
}

/**
 * @param {string} from carpeta de instalacion actual
 * @param {string} to carpeta de instalacion nueva (ya con subcarpeta propia)
 * @param {{confirmShared?:boolean, onProgress?:(p:{phase:string, fraction:number, text:string, done:number, total:number})=>void}} [opts]
 *   `fraction` (0..1) es el avance de TODO el movimiento: copiar 0-85 %, comprobar 85-88 %, borrar lo antiguo 88-100 %.
 * @returns {Promise<{moved:string[], bytes:number, leftovers:string[]}>}
 */
async function moveInstall(from, to, opts = {}) {
    if (sameOrInside(from, to)) throw new Error('La carpeta nueva no puede ser la misma ni estar dentro de la actual.');
    if (path.parse(path.resolve(from)).root === path.resolve(from)) throw new Error('La instalación actual está en la raíz de una unidad; muévela a mano.');

    // Una carpeta nueva con contenido se rechaza: no se mezcla ni se pisa nada.
    if (listEntries(to).length) throw new Error('La carpeta nueva ya tiene archivos. Elige una carpeta vacía.');

    const plan = planMove(from);
    if (plan.shared && !opts.confirmShared) {
        const err = new Error(`Se moverán ${plan.count} archivos y carpetas (${(plan.bytes / 1073741824).toFixed(1)} GB), incluidos algunos que no son del launcher.`);
        err.code = 'NEEDS_CONFIRM';
        err.plan = plan;
        throw err;
    }
    ensureDir(to);
    if (!plan.count) return { moved: [], bytes: 0, leftovers: [] };

    const free = freeSpace(to);
    if (free != null && free < plan.bytes * 1.05 + 100 * 1024 * 1024) {
        throw new Error(`No hay espacio en la carpeta nueva: hacen falta unos ${Math.ceil(plan.bytes / 1048576)} MB.`);
    }

    // ---- avisos de progreso ----
    let last = 0;
    const emit = (phase, frac, text, done, total, force) => {
        if (!opts.onProgress) return;
        const now = Date.now();
        if (!force && now - last < PROGRESS_MS) return;
        last = now;
        opts.onProgress({ phase, fraction: Math.min(1, Math.max(0, frac)), text, done, total });
    };

    const tree = walk(from, plan.entries);
    const total = tree.bytes;
    emit('copy', 0, 'Copiando archivos', 0, total, true);

    // ---- 1) copiar ----
    for (const d of tree.dirs) await fs.promises.mkdir(path.join(to, d), { recursive: true });
    let copied = 0;
    for (const f of tree.files) {
        await copyOne(path.join(from, f.rel), path.join(to, f.rel), f.size, n => {
            copied += n;
            emit('copy', total ? 0.85 * (copied / total) : 0.85, 'Copiando archivos', copied, total);
        });
    }
    for (const l of tree.links) await fs.promises.cp(path.join(from, l), path.join(to, l), { recursive: true, force: true });

    // ---- 2) comprobar: cada archivo de la copia existe y tiene el mismo tamano ----
    emit('verify', 0.85, 'Comprobando la copia', 0, tree.files.length, true);
    for (let i = 0; i < tree.files.length; i++) {
        const f = tree.files[i];
        let size = -1;
        try { size = fs.statSync(path.join(to, f.rel)).size; } catch (e) { /* falta */ }
        if (size !== f.size) throw new Error('La copia no coincide con el original; no se ha borrado nada.');
        if (i % 200 === 0) emit('verify', 0.85 + 0.03 * (i / Math.max(1, tree.files.length)), 'Comprobando la copia', i, tree.files.length);
    }

    // ---- 3) borrar lo antiguo (lo que este en uso se anota, no se fuerza) ----
    emit('delete', 0.88, 'Quitando los archivos antiguos', 0, tree.files.length, true);
    const leftovers = [];
    for (let i = 0; i < tree.files.length; i++) {
        const f = tree.files[i];
        if (!(await removeFile(path.join(from, f.rel)))) leftovers.push(f.rel);
        if (i % 100 === 0) emit('delete', 0.88 + 0.12 * (i / Math.max(1, tree.files.length)), 'Quitando los archivos antiguos', i, tree.files.length);
    }
    for (const d of tree.dirs.slice().reverse()) { try { fs.rmdirSync(path.join(from, d)); } catch (e) { /* no esta vacia: algo quedo dentro */ } }
    for (const l of tree.links) { try { removeSync(path.join(from, l)); } catch (e) { leftovers.push(l); } }
    // Si la carpeta antigua era la propia del launcher y quedo vacia, tambien se quita (rmdir no borra nada que tenga contenido).
    if (!leftovers.length && path.basename(path.resolve(from)).toLowerCase() === String(SUBFOLDER).toLowerCase()) { try { fs.rmdirSync(from); } catch (e) { /* tiene otros archivos */ } }

    emit('delete', 1, 'Listo', tree.files.length, tree.files.length, true);
    return { moved: plan.entries, bytes: plan.bytes, leftovers };
}

module.exports = { moveInstall, planMove };
