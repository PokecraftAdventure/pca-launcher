/**
 * Pokecraft Adventure Launcher
 *
 * Mods que pone el launcher. El resto los entrega AutoModpack al entrar al servidor.
 *  - Base (AutoModpack): siempre la version exacta y el hash esperado.
 *  - Provisionales (FancyMenu y lo que necesita): para que las pantallas se vean en el primer arranque. Solo se
 *    ponen mientras AutoModpack no ha sincronizado; en cuanto tiene su propia copia, el launcher retira la suya y
 *    las versiones las decide el servidor.
 */
const fs = require('fs');
const path = require('path');
const { downloadFile, sha512File } = require('./download');
const { removeSync } = require('./fsx');
const { autoModpackCopies } = require('./screens');

const jarsIn = dir => {
    try { return fs.readdirSync(dir).filter(n => n.endsWith('.jar')); } catch (e) { return []; }
};
const isExact = async (file, mod) => fs.existsSync(file) && await sha512File(file) === mod.sha512;

/** Retira los provisionales que AutoModpack ya trae y devuelve los que todavia hay que poner. */
async function reviewSeedMods(modsDir, seedMods) {
    const synced = autoModpackCopies(path.dirname(modsDir), 'mods').map(jarsIn).flat();
    const needed = [];
    for (const mod of seedMods) {
        const file = path.join(modsDir, mod.file);
        const same = name => name.startsWith(mod.prefix);
        if (!synced.length) {
            if (!jarsIn(modsDir).some(name => name !== mod.file && same(name))) needed.push(mod);
        } else if (synced.some(same) && await isExact(file, mod)) {
            // Solo el archivo que puso el launcher (mismo hash). Si esta en uso, se intenta la proxima vez.
            try { removeSync(file); } catch (e) { console.warn('Mod provisional en uso:', mod.file, e.message); }
        }
    }
    return needed;
}

/**
 * @param {string} modsDir carpeta mods de la instancia
 * @param {Array} baseMods lista de launcher.config.json
 * @param {(done:number,total:number,name:string)=>void} onProgress
 * @param {AbortSignal} [signal] corta la descarga al cancelar la carga
 * @param {Array} [seedMods] mods provisionales de launcher.config.json
 */
async function ensureBaseMods(modsDir, baseMods, onProgress, signal, seedMods = []) {
    fs.mkdirSync(modsDir, { recursive: true });
    const seeds = await reviewSeedMods(modsDir, seedMods);

    const total = [...baseMods, ...seeds].reduce((sum, m) => sum + m.size, 0);
    let done = 0;
    const report = name => onProgress && onProgress(Math.min(done, total), total, name);

    const ensure = async mod => {
        if (signal && signal.aborted) throw new Error('Cancelado');
        const dest = path.join(modsDir, mod.file);
        report(mod.file);
        if (await isExact(dest, mod)) {
            done += mod.size;
            return report(mod.file);
        }
        await downloadFile({
            url: mod.url, dest, size: mod.size, sha512: mod.sha512, signal,
            onBytes: n => { done += n; report(mod.file); }
        });
    };

    for (const mod of baseMods) {
        // Versiones antiguas del mismo mod base: se quitan para no duplicar el id.
        for (const name of jarsIn(modsDir)) {
            if (name !== mod.file && name.startsWith(mod.prefix)) removeSync(path.join(modsDir, name));
        }
        await ensure(mod);
    }

    // Los provisionales van todos o ninguno: a medias, el juego no abriria. Sin ellos solo falta el menu propio.
    try {
        for (const mod of seeds) await ensure(mod);
    } catch (err) {
        if (signal && signal.aborted) throw err;
        console.warn('Sin mods provisionales:', err.message);
        for (const mod of seeds) removeSync(path.join(modsDir, mod.file));
    }
}

module.exports = { ensureBaseMods };
