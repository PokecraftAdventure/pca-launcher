/**
 * Pokecraft Adventure Launcher
 *
 * Packs de CobbleTCG (~1,7 GB): se descargan en segundo plano, de uno en uno,
 * mientras el jugador ya esta jugando. Cuando uno termina y el juego esta
 * cerrado, se anade a la lista de packs de options.txt una sola vez
 * (si el jugador lo desactiva despues, no se vuelve a anadir).
 */
const fs = require('fs');
const path = require('path');
const { downloadFile } = require('./download');
const { safeJoin } = require('./paths');
const { okFile } = require('./assets');
const stateMod = require('./state');
const quality = require('./quality');

let running = null;   // promesa de la descarga en curso (una sola a la vez)

/** true mientras hay una descarga de cartas en curso. */
function isRunning() {
    return running !== null;
}

/**
 * Descarga los packs que falten. onProgress({done,total,text}). Seguro de repetir:
 * - Sin limite de velocidad (decision del usuario).
 * - No depende de la ventana: corre en el renderer mientras esta oculta (no se destruye).
 * - Si se corta, el `.part` se conserva y la siguiente llamada continua con Range; el archivo
 *   solo pasa a su destino cuando el SHA-512 coincide, y un `.part` danado se descarta y se repite.
 * - Si ya hay una descarga en curso devuelve esa misma promesa (no lanza una segunda).
 */
function runTcg(opts) {
    if (running) return running;
    running = doRun(opts).finally(() => { running = null; });
    return running;
}

async function doRun({ layout, manifest, onProgress, signal }) {
    const inst = layout.instanceDir;
    const pending = manifest.tcg.filter(p => !okFile(safeJoin(inst, p.dest), p.size));
    const total = pending.reduce((a, p) => a + p.size, 0);
    let done = 0;
    for (const p of pending) {
        await downloadFile({
            url: p.url, dest: safeJoin(inst, p.dest), size: p.size, sha512: p.sha512, signal,
            retries: 6,
            onBytes: n => { done += n; if (onProgress) onProgress({ done, total, text: `Descargando ${path.basename(p.dest)}` }); }
        });
        const state = stateMod.load(layout.stateFile);
        state.tcg[p.slug] = Object.assign({ added: false }, state.tcg[p.slug], { done: true });
        stateMod.save(layout.stateFile, state);
    }
    return pending.length;
}

/** Los packs de TCG que faltan o estan incompletos (solo mira, no descarga). */
function missingTcg({ layout, manifest }) {
    return (manifest.tcg || []).filter(p => !okFile(safeJoin(layout.instanceDir, p.dest), p.size));
}

/**
 * Anade a options.txt los packs de TCG ya descargados y no anadidos antes.
 * Llamar con el juego cerrado. Devuelve los ids anadidos.
 */
function finalizeTcg({ layout, manifest }) {
    const optionsFile = path.join(layout.instanceDir, 'options.txt');
    if (!fs.existsSync(optionsFile)) return [];
    const state = stateMod.load(layout.stateFile);
    const ids = [];
    for (const p of manifest.tcg) {
        const s = state.tcg[p.slug];
        const exists = okFile(safeJoin(layout.instanceDir, p.dest), p.size);
        if (exists && (!s || !s.added)) {
            ids.push(p.packId);
            state.tcg[p.slug] = Object.assign({ done: true }, s, { added: true });
        }
    }
    if (!ids.length) return [];
    fs.writeFileSync(optionsFile, quality.addPacks(fs.readFileSync(optionsFile, 'utf8'), ids));
    stateMod.save(layout.stateFile, state);
    return ids;
}

module.exports = { runTcg, finalizeTcg, isRunning, missingTcg };
