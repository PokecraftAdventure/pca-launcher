/**
 * Pokecraft Adventure Launcher
 *
 * Descarga de archivos con verificacion SHA-512, reanudacion (.part) y reintentos.
 * Un archivo solo aparece en su destino final cuando esta completo y su hash coincide.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const nodeFetch = require('node-fetch');
const { removeSync } = require('./fsx');

const UA = 'PokecraftAdventure-Launcher/0.1';
const IDLE_TIMEOUT_MS = 30000;

const sleep = ms => new Promise(r => setTimeout(r, ms));

function sha512File(file) {
    return new Promise((resolve, reject) => {
        const hash = crypto.createHash('sha512');
        fs.createReadStream(file)
            .on('data', c => hash.update(c))
            .on('end', () => resolve(hash.digest('hex')))
            .on('error', reject);
    });
}

async function attempt({ url, dest, size, sha512, onBytes, signal, idleMs = IDLE_TIMEOUT_MS }) {
    const part = dest + '.part';
    fs.mkdirSync(path.dirname(dest), { recursive: true });

    let have = 0;
    try { have = fs.statSync(part).size; } catch (e) { have = 0; }
    if (size != null && have > size) { removeSync(part); have = 0; }

    // Si ya esta entero, solo falta verificar.
    if (!(size != null && have === size)) {
        const headers = { 'User-Agent': UA };
        if (have > 0) headers.Range = `bytes=${have}-`;
        const ctrl = new AbortController();
        const onAbort = () => ctrl.abort();
        if (signal) signal.addEventListener('abort', onAbort);
        let idle;
        const arm = () => { clearTimeout(idle); idle = setTimeout(() => ctrl.abort(), idleMs); };
        try {
            arm();
            const res = await nodeFetch(url, { headers, signal: ctrl.signal });
            if (res.status === 416) { removeSync(part); throw new Error('Rango no valido, se reintenta'); }
            if (!res.ok) throw new Error(`No se pudo descargar «${path.basename(dest)}» (HTTP ${res.status}).`);

            const resumed = res.status === 206 && have > 0;
            if (!resumed) have = 0;
            const out = fs.createWriteStream(part, { flags: resumed ? 'a' : 'w' });
            for await (const chunk of res.body) {
                arm();
                if (!out.write(chunk)) await new Promise(r => out.once('drain', r));
                if (onBytes) onBytes(chunk.length);
            }
            await new Promise((resolve, reject) => out.end(err => (err ? reject(err) : resolve())));
        } finally {
            clearTimeout(idle);
            if (signal) signal.removeEventListener('abort', onAbort);
        }
    }

    if (size != null && fs.statSync(part).size !== size) throw new Error(`«${path.basename(dest)}» se descargó incompleto.`);
    if (sha512 && (await sha512File(part)) !== sha512) {
        removeSync(part);
        throw new Error(`«${path.basename(dest)}» llegó dañado y se descartó. Vuelve a intentarlo.`);
    }
    fs.renameSync(part, dest);
}

/** Descarga `url` en `dest`. @param {object} o { url, dest, size, sha512, onBytes(n), retries, signal, idleMs } */
async function downloadFile(o) {
    const retries = o.retries == null ? 3 : o.retries;
    let last;
    for (let i = 0; i <= retries; i++) {
        if (o.signal && o.signal.aborted) throw new Error('Cancelado');
        try { return await attempt(o); } catch (e) {
            last = e;
            if (o.signal && o.signal.aborted) throw new Error('Cancelado');
            await sleep(Math.min(1000 * 2 ** i, 8000));
        }
    }
    throw last;
}

module.exports = { downloadFile, sha512File };
