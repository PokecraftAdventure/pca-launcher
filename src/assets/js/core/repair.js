/**
 * Pokecraft Adventure Launcher
 *
 * "Reparar archivos" (Ajustes > Mantenimiento, juego cerrado). Comprueba por hash lo que gestiona el
 * launcher y vuelve a descargar lo que falte o este danado:
 *  1. mod base (AutoModpack): hash sha512
 *  2. packs y shaders enlazados: hash sha512; packs y shaders del .mrpack: crc32
 *  3. configs "managed": crc32 (las "seed" solo se reponen si faltan: pueden ser del jugador)
 *     y pantallas del juego: sha256
 *  4. archivos de Minecraft, Fabric y Java integrado: los verifica minecraft-java-core con `verify: true`, pero contra una
 *     instancia temporal vacia (ver VERIFY_INSTANCE): con `verify` el nucleo borra de la instancia lo que no conoce.
 * No toca mundos, capturas, options.txt ni los packs/shaders/configs propios del jugador. servers.dat se sobrescribe siempre.
 * Los mods de AutoModpack los repara el propio mod al entrar al servidor: aqui solo se avisa (`notes`).
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { sha512File } = require('./download');
const { syncAssets } = require('./assets');
const stateMod = require('./state');
const { safeJoin } = require('./paths');
const { damagedScreens, ensureScreensPack } = require('./screens');
const cfg = require('../../../launcher.config.json');
const { removeSync } = require('./fsx');

function crc32File(file) {
    return new Promise((resolve, reject) => {
        let crc = 0;
        fs.createReadStream(file)
            .on('data', c => { crc = zlib.crc32(c, crc); })
            .on('end', () => resolve(crc >>> 0))
            .on('error', reject);
    });
}

const sizeOf = f => { try { return fs.statSync(f).size; } catch (e) { return -1; } };

// Con `verify: true`, minecraft-java-core BORRA de la carpeta de instancia todo lo que no figure en su lista de archivos
// (mundos, options.txt, servers.dat, mods, packs, shaders, AutoModpack...). Es lo que vacio una instalacion al reparar (2026-11-19).
// Por eso la verificacion se hace contra una instancia TEMPORAL Y VACIA con otro nombre: el nucleo comprueba y repone solo lo
// compartido (assets, libraries, loader, runtime, versions) y la instancia real del jugador no se toca nunca.
const VERIFY_INSTANCE = '.pca-verificacion';

/** Opciones de la verificacion del juego. Pura, para poder comprobar en las pruebas que nunca apunta a la instancia real. */
function buildVerifyOptions(layout, javaPath) {
    return {
        authenticator: { name: 'repair', uuid: '0', access_token: '0', client_token: '0', meta: { type: 'offline' } },
        timeout: 10000,
        path: layout.installDir,
        instance: VERIFY_INSTANCE,
        version: cfg.instance.minecraft_version,
        detached: true,
        downloadFileMultiple: 4,
        loader: { type: cfg.instance.loader_type, build: cfg.instance.loader_version, enable: cfg.instance.loader_type !== 'none' },
        verify: true,
        ignored: [],
        java: { path: javaPath || undefined }
    };
}

/** Quita la instancia temporal de la verificacion (solo esa carpeta exacta, nunca la del jugador). */
function removeVerifyInstance(layout) {
    const dir = path.join(layout.installDir, 'instances', VERIFY_INSTANCE);
    if (path.basename(dir) === VERIFY_INSTANCE && path.basename(dir) !== cfg.instance.name) removeSync(dir);
}

/**
 * Verificacion real de Minecraft, Fabric y Java con minecraft-java-core (no arranca el juego).
 * @returns {Promise<{bytes:number}>} bytes que hubo que volver a descargar
 */
async function verifyGameFiles({ layout, onProgress, javaPath }) {
    const { Launch } = require('minecraft-java-core');
    const launch = new Launch();
    launch.start = async () => { };               // solo se quiere la descarga/verificacion, no abrir el juego
    let bytes = 0, failure = null;
    launch.on('error', e => { failure = e; });
    launch.on('progress', (done, total) => { bytes = Math.max(bytes, total || 0); onProgress({ text: 'Descargando archivos del juego', done, total, part: 1 }); });
    launch.on('check', (done, total) => onProgress({ text: 'Comprobando archivos del juego', done, total, part: 0 }));

    try {
        launch.Launch(buildVerifyOptions(layout, javaPath));
        const data = await launch.DownloadGame();
        if (failure) throw new Error('No se pudieron verificar los archivos de Minecraft: ' + (failure.error || failure.message || JSON.stringify(failure)));
        if (data && data.error) throw new Error('No se pudieron verificar los archivos de Minecraft: ' + data.error);
        return { bytes };
    } finally {
        removeVerifyInstance(layout);
    }
}

/**
 * @param {object} o { layout, manifest, onProgress, signal, baseMods, verifyGame, ensureBaseMods, javaPath }
 *   `verifyGame` y `ensureBaseMods` se pueden sustituir (pruebas).
 * @returns {Promise<{checked:number, fixed:number, errors:string[], notes:string[], gameBytes:number}>}
 */
async function repair({ layout, manifest, onProgress, signal, baseMods, verifyGame = verifyGameFiles, ensureBaseMods, javaPath }) {
    // `overall` (0..1) es el avance de TODA la reparacion, para la barra (solo porcentaje; no se muestra tiempo restante). Cada paso ocupa un tramo:
    // mod base 0-5 %, packs/shaders/configs 5-30 %, comprobar el juego 30-55 %, descargar lo que falte del juego 55-98 %, archivos iniciales 98-99 %.
    let lo = 0, hi = 0;
    const range = (a, b) => { lo = a; hi = b; };
    const say = (text, done, total) => onProgress && onProgress({ text, done, total, overall: total ? lo + (hi - lo) * Math.min(1, Math.max(0, done / total)) : lo });
    const inst = layout.instanceDir;
    const res = { checked: 0, fixed: 0, errors: [], notes: [], gameBytes: 0 };
    const mods = baseMods || cfg.baseMods || [];
    const ensure = ensureBaseMods || require('./basemods').ensureBaseMods;
    const state = stateMod.load(layout.stateFile);
    const guard = async (label, fn) => {
        try { await fn(); } catch (e) { res.errors.push(`${label}: ${e && e.message ? e.message : e}`); }
    };

    // 1) Mod base
    await guard('Mod base', async () => {
        range(0, 0.05);
        say('Comprobando el mod base');
        let bad = 0;
        for (const m of mods) {
            const f = path.join(layout.modsDir, m.file);
            res.checked++;
            let ok = false;
            try { ok = fs.existsSync(f) && (await sha512File(f)) === m.sha512; } catch (e) { ok = false; }
            if (!ok) bad++;
        }
        if (bad) { await ensure(layout.modsDir, mods, (d, t, n) => say('Descargando ' + n, d, t)); res.fixed += bad; }
    });

    // 2) Packs y shaders + 3) configs: se retiran los que no coinciden y syncAssets los vuelve a traer
    await guard('Packs, shaders y configuraciones', async () => {
        range(0.05, 0.3);
        const items = [];
        for (const f of [...manifest.linked, manifest.fusion]) items.push({ kind: 'sha', rel: f.dest, size: f.size, sha512: f.sha512 });
        for (const o of manifest.overrides) items.push({ kind: 'crc', rel: o.dest, size: o.size, crc32: o.crc32 });
        for (const c of manifest.configs.filter(x => !x.denied && x.kind === 'managed')) items.push({ kind: 'crc', rel: c.path, size: c.size, crc32: c.crc32, managed: true });

        let i = 0, bad = 0;
        for (const it of items) {
            if (signal && signal.aborted) throw new Error('Cancelado');
            if (++i % 25 === 0 || i === items.length) say('Comprobando packs, shaders y configuraciones', i, items.length);
            const file = safeJoin(inst, it.rel);
            res.checked++;
            let ok = sizeOf(file) === it.size;
            if (ok) {
                try { ok = it.kind === 'sha' ? (await sha512File(file)) === it.sha512 : (await crc32File(file)) === (it.crc32 >>> 0); } catch (e) { ok = false; }
            }
            if (ok) continue;
            bad++;
            if (fs.existsSync(file)) removeSync(file);
            if (it.managed) delete state.managed[it.rel];
        }
        // Configs "seed": solo se reponen las que faltan (si existen pueden ser del jugador).
        for (const c of manifest.configs.filter(x => !x.denied && x.kind !== 'managed')) {
            res.checked++;
            if (!fs.existsSync(safeJoin(inst, c.path)) && state.seeded[c.path]) { delete state.seeded[c.path]; bad++; }
        }
        // Pantallas del juego (hash sha256): se olvidan las que no coinciden y syncAssets las vuelve a copiar.
        bad += damagedScreens({ layout, manifest }).length;
        res.checked += manifest.screens ? manifest.screens.files.length : 0;
        stateMod.save(layout.stateFile, state);
        if (bad) {
            await syncAssets({ layout, manifest, state, onProgress: p => say(p.text, p.done, p.total), signal });
            stateMod.save(layout.stateFile, state);
            res.fixed += bad;
        }
    });

    // 4) Minecraft, Fabric y Java integrado
    await guard('Archivos del juego', async () => {
        range(0.3, 0.55);
        say('Comprobando archivos del juego');
        const g = await verifyGame({ layout, onProgress: p => { if (p.part === 1) range(0.55, 0.98); else range(0.3, 0.55); say(p.text, p.done, p.total); }, javaPath });
        res.checked++;
        if (g && g.bytes > 0) { res.gameBytes = g.bytes; res.fixed++; }
    });

    // 5) Archivos iniciales que entrega el launcher (options.txt, servers.dat, options.amecsapi.txt, configs propias, huella de AutoModpack):
    //    solo los que falten; uno que ya existe (del jugador o de AutoModpack) no se pisa, salvo servers.dat.
    await guard('Archivos iniciales', async () => {
        range(0.98, 0.99);
        say('Comprobando archivos iniciales');
        const st = stateMod.load(layout.stateFile);
        const q = require('./quality');
        const made = require('./instance').restoreInitialFiles(inst, st, q.PRESETS[st.quality] ? st.quality : q.DEFAULT_QUALITY);
        ensureScreensPack(inst, manifest);
        stateMod.save(layout.stateFile, st);
        res.checked += 4 + require('./localconfigs').LOCAL_CONFIGS.length;
        res.fixed += made.length;
    });

    // 6) Cartas (CobbleTCG): Reparar NO las descarga ni espera por ellas. Solo informa de cuantas faltan; el launcher las deja
    //    bajando en segundo plano (como al jugar) cuando todo lo demas esta en orden, y el jugador decide si juega o espera.
    res.tcg = { missing: 0, bytes: 0 };
    try {
        const miss = require('./tcg').missingTcg({ layout, manifest });
        res.tcg = { missing: miss.length, bytes: miss.reduce((a, p) => a + p.size, 0) };
    } catch (e) { /* sin lista de cartas: nada que avisar */ }

    res.notes.push('Los mods del servidor los repara AutoModpack al entrar al juego.');
    range(1, 1);
    say('Listo');
    return res;
}

module.exports = { repair, buildVerifyOptions, VERIFY_INSTANCE };
