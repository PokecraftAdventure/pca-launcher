/**
 * Pokecraft Adventure Launcher
 *
 * Prepara la instancia antes de jugar: sincroniza packs, shaders y configs, y
 * escribe una sola vez (solo si no existen) options.txt, options.amecsapi.txt
 * y las configs propias del launcher: los cambios del jugador se respetan.
 * La lista de servidores (servers.dat) es identidad del servidor y se sobrescribe siempre.
 */
const fs = require('fs');
const path = require('path');
const { syncAssets } = require('./assets');
const quality = require('./quality');
const { buildServersDat } = require('./nbt');
const stateMod = require('./state');
const { ensureScreensPack } = require('./screens');
const { ensureDir } = require('./paths');
const { LOCAL_CONFIGS } = require('./localconfigs');
const cfg = require('../../../launcher.config.json');

const DEFAULTS_DIR = path.join(__dirname, '..', '..', 'defaults');
const QUALITY_FILES = ['config/iris.properties', 'config/sodium-options.json', 'config/resourcepackoverrides.json'];

// PCA_SERVER solo funciona en modo desarrollo (NODE_ENV=dev), para probar sin tocar el servidor real.
const serverAddress = () => (process.env.NODE_ENV === 'dev' && process.env.PCA_SERVER)
    ? process.env.PCA_SERVER
    : cfg.server.ip + (cfg.server.port && cfg.server.port !== 25565 ? ':' + cfg.server.port : '');

/**
 * Deja aceptada la huella del certificado del servidor de AutoModpack, para que el jugador no tenga
 * que pegarla en la pantalla "Verificacion de certificado". La huella es publica (es la que se
 * compartia por Discord). Solo AÑADE el servidor si falta: no toca otros servidores ni una huella ya
 * guardada, y nunca toca automodpack-client-secrets.json (es personal de cada jugador).
 * Devuelve true si escribio algo.
 */
function seedKnownHost(inst, host = cfg.automodpack && cfg.automodpack.host, fingerprint = cfg.automodpack && cfg.automodpack.fingerprint) {
    if (!host || !fingerprint) return false;
    const file = path.join(inst, 'automodpack', '.private', 'automodpack-known-hosts.json');
    let data = { hosts: {} };
    try { data = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { /* no existe o ilegible: se crea */ }
    if (!data || typeof data.hosts !== 'object' || data.hosts === null) data = { ...(data || {}), hosts: {} };
    if (data.hosts[host]) return false;
    data.hosts[host] = fingerprint;
    ensureDir(path.dirname(file));
    fs.writeFileSync(file, JSON.stringify(data, null, 2));
    return true;
}

/**
 * Escribe `dest` solo si NO existe. Nunca pisa un archivo que ya esta (es del jugador, de AutoModpack o del juego).
 * La marca de `state.files` ya no impide reponerlo: si el archivo desaparece (carpeta borrada, copia incompleta) y
 * la marca seguia puesta, la instancia se quedaba sin options.txt para siempre. Devuelve true si lo creo ahora.
 */
function seedOnce(state, key, dest, produce) {
    const wasDone = !!state.files[key];
    let created = false;
    if (!fs.existsSync(dest)) {
        ensureDir(path.dirname(dest));
        fs.writeFileSync(dest, produce());
        created = true;
    }
    state.files[key] = true;
    // Un options.txt repuesto no lleva los packs de TCG que ya se habian anadido al anterior: se vuelven a anadir.
    if (created && wasDone && key === 'options.txt') for (const s of Object.values(state.tcg || {})) if (s && s.done) s.added = false;
    return created;
}

/**
 * Deja nuestro servidor como unico de la lista de multijugador, aunque el jugador haya anadido otros.
 * Devuelve true solo si el archivo faltaba.
 */
function writeServerList(inst) {
    const file = path.join(inst, 'servers.dat');
    const data = buildServersDat([{ name: cfg.serverName, ip: serverAddress() }]);
    let current = null;
    try { current = fs.readFileSync(file); } catch (e) { /* no existe */ }
    if (!current || !current.equals(data)) fs.writeFileSync(file, data);
    return !current;
}

/**
 * Los archivos iniciales que entrega el launcher: options.txt, options.amecsapi.txt, sus configs propias (LOCAL_CONFIGS)
 * y la huella de AutoModpack, de los que solo se escriben los que FALTAN (nunca se pisa uno que ya existe); y
 * servers.dat, que se sobrescribe siempre. Lo usan prepareInstance (al jugar) y Reparar.
 * @returns {string[]} los que faltaban y se crearon ahora
 */
function restoreInitialFiles(inst, state, chosen) {
    const created = [];
    if (seedOnce(state, 'options.txt', path.join(inst, 'options.txt'),
        () => quality.applyToOptionsText(fs.readFileSync(path.join(DEFAULTS_DIR, 'options.txt'), 'utf8'), chosen))) created.push('options.txt');
    if (seedOnce(state, 'options.amecsapi.txt', path.join(inst, 'options.amecsapi.txt'),
        () => fs.readFileSync(path.join(DEFAULTS_DIR, 'options.amecsapi.txt')))) created.push('options.amecsapi.txt');
    if (writeServerList(inst)) created.push('servers.dat');
    for (const rel of LOCAL_CONFIGS) {
        if (seedOnce(state, 'config/' + rel, path.join(inst, 'config', ...rel.split('/')),
            () => fs.readFileSync(path.join(DEFAULTS_DIR, 'config', ...rel.split('/'))))) created.push('config/' + rel);
    }

    // seedKnownHost solo anade la huella si falta y respeta lo demas, asi que es seguro repetirlo. Si el archivo quedo vacio o se
    // borro, AutoModpack pediria aceptar el certificado y, sin esa aceptacion, no baja los mods.
    if (seedKnownHost(inst)) created.push('automodpack/.private/automodpack-known-hosts.json');
    return created;
}

/**
 * @param {object} o { layout, manifest, quality, onProgress, signal }
 * @returns {Promise<{state:object, sync:object, created:string[]}>}
 */
async function prepareInstance({ layout, manifest, quality: q, onProgress, signal }) {
    const state = stateMod.load(layout.stateFile);
    const chosen = quality.PRESETS[q] ? q : quality.DEFAULT_QUALITY;
    ensureDir(layout.instanceDir);

    const sync = await syncAssets({ layout, manifest, state, onProgress, signal });
    const inst = layout.instanceDir;
    const created = restoreInitialFiles(inst, state, chosen);

    // Las configs de Iris, Sodium y resourcepackoverrides recien escritas empiezan en la calidad elegida.
    const fresh = sync.seeded.filter(p => QUALITY_FILES.includes(p));
    if (fresh.length) quality.applyToInstance(inst, chosen, fresh);

    ensureScreensPack(inst, manifest);                    // lo ultimo: queda por encima de lo que se haya anadido
    if (!state.quality) state.quality = chosen;
    stateMod.save(layout.stateFile, state);
    return { state, sync, created };
}

/** Cambio de calidad pedido por el jugador (juego cerrado). */
function setQuality(layout, q) {
    if (!quality.PRESETS[q]) throw new Error('Calidad desconocida: ' + q);
    const changed = quality.applyToInstance(layout.instanceDir, q);
    const state = stateMod.load(layout.stateFile);
    state.quality = q;
    stateMod.save(layout.stateFile, state);
    return changed;
}

module.exports = { prepareInstance, setQuality, serverAddress, seedKnownHost, restoreInitialFiles };
