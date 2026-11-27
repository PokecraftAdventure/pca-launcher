/**
 * Pokecraft Adventure Launcher
 *
 * Sincroniza los packs, shaders y configs de Cobbleverse (segun
 * assets-manifest.json) con la instancia:
 *  - packs/shaders: el launcher los gestiona; repone los que falten y retira
 *    solo los suyos que ya no esten en la lista.
 *  - configs "seed": se escriben una sola vez y solo si no existen (incluye los ajustes de shaders y packs).
 *  - configs "managed": se reemplazan cuando cambia la version del launcher.
 *  - pantallas del juego (`manifest.screens`, ver screens.js): vienen con el launcher.
 * Nada de lo del jugador se toca.
 */
const fs = require('fs');
const path = require('path');
const { downloadFile, sha512File } = require('./download');
const { extractEntries } = require('./mrpack');
const { safeJoin, ensureDir, freeSpace } = require('./paths');
const { syncScreens } = require('./screens');
const { removeSync } = require('./fsx');

const MB = 1024 * 1024;
const EXTRA_FREE = 300 * MB;

async function pool(items, limit, worker) {
    let next = 0;
    const run = async () => {
        while (next < items.length) {
            const i = next++;
            await worker(items[i]);
        }
    };
    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
}

const okFile = (file, size) => {
    try { return fs.statSync(file).size === size; } catch (e) { return false; }
};

/**
 * @param {object} o { layout, manifest, state, onProgress, signal }
 * @returns {Promise<{downloadedBytes:number, extracted:number, seeded:string[], managed:string[], removed:string[]}>}
 */
async function syncAssets({ layout, manifest, state, onProgress, signal }) {
    const inst = layout.instanceDir;
    const report = (done, total, text) => onProgress && onProgress({ done, total, text });
    const result = { downloadedBytes: 0, extracted: 0, seeded: [], managed: [], removed: [] };

    const direct = [...manifest.linked, manifest.fusion];
    const allDests = new Set([...direct.map(d => d.dest), ...manifest.overrides.map(o => o.dest)]);
    const configPaths = new Set(manifest.configs.map(c => c.path));

    const missingDirect = direct.filter(f => !okFile(safeJoin(inst, f.dest), f.size));
    const needOverrides = manifest.overrides.filter(o => !okFile(safeJoin(inst, o.dest), o.size));

    const needConfigs = [];
    for (const c of manifest.configs.filter(x => !x.denied)) {
        const dest = safeJoin(inst, c.path);
        if (c.kind === 'managed') {
            if (state.managed[c.path] !== c.crc32 || !fs.existsSync(dest)) needConfigs.push(c);
        } else if (!state.seeded[c.path]) {
            if (fs.existsSync(dest)) state.seeded[c.path] = true;   // ya existia: se respeta y no se vuelve a mirar
            else needConfigs.push(c);
        }
    }

    const mr = manifest.cobbleverse.mrpack;
    const mrDest = path.join(layout.cacheDir, mr.file);
    const needMrpack = needOverrides.length > 0 || needConfigs.length > 0;
    const total = missingDirect.reduce((a, f) => a + f.size, 0) + (needMrpack ? mr.size : 0);

    if (total > 0) {
        const free = freeSpace(layout.installDir);
        if (free != null && free < total * 1.1 + EXTRA_FREE) {
            throw new Error(`Espacio insuficiente: hacen falta unos ${Math.ceil((total * 1.1 + EXTRA_FREE) / MB)} MB libres y hay ${Math.floor(free / MB)} MB.`);
        }
    }

    ensureDir(inst);
    let done = 0;
    const tick = text => n => { done += n; result.downloadedBytes += n; report(done, total, text); };

    // 1) Packs enlazados (descarga directa, hash fijado)
    await pool(missingDirect, 3, f => downloadFile({
        url: f.url, dest: safeJoin(inst, f.dest), size: f.size, sha512: f.sha512,
        onBytes: tick(`Descargando ${path.basename(f.dest)}`), signal
    }));

    // 2) Resto: sale del .mrpack de Cobbleverse
    if (needMrpack) {
        ensureDir(layout.cacheDir);
        let valid = false;
        if (okFile(mrDest, mr.size)) valid = (await sha512File(mrDest)) === mr.sha512;
        if (!valid) {
            await downloadFile({
                url: mr.url, dest: mrDest, size: mr.size, sha512: mr.sha512,
                onBytes: tick('Descargando Cobbleverse 1.7.42'), signal
            });
        } else {
            done += mr.size;
        }
        report(done, total, 'Instalando packs y shaders');

        const items = [
            ...needOverrides.map(o => ({ entry: o.entry, dest: safeJoin(inst, o.dest), size: o.size, crc32: o.crc32 })),
            ...needConfigs.map(c => ({ entry: c.entry, dest: safeJoin(inst, c.path), size: c.size, crc32: c.crc32 }))
        ];
        result.extracted = await extractEntries(mrDest, items, (d, t) => report(done, total, `Instalando ${d}/${t}`));
        for (const c of needConfigs) {
            if (c.kind === 'managed') { state.managed[c.path] = c.crc32; result.managed.push(c.path); }
            else { state.seeded[c.path] = true; result.seeded.push(c.path); }
        }
        removeSync(mrDest);    // ya no hace falta; se descarga de nuevo solo si cambia la version
    }

    // 3) Retirar solo lo propio que ya no esta en la lista
    for (const rel of Object.keys(state.owned)) {
        if (allDests.has(rel)) continue;
        if (configPaths.has(rel)) { delete state.owned[rel]; continue; }    // paso a ser un ajuste del jugador: no se toca
        try { removeSync(safeJoin(inst, rel)); result.removed.push(rel); } catch (e) { /* se deja */ }
        delete state.owned[rel];
    }
    for (const rel of allDests) state.owned[rel] = true;

    // 4) Pantallas del juego: van dentro del launcher, sin descarga
    result.screens = syncScreens({ layout, manifest, state });

    report(total, total, 'Packs y shaders listos');
    return result;
}

module.exports = { syncAssets, okFile };
