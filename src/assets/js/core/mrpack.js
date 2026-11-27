/**
 * Pokecraft Adventure Launcher
 *
 * Extrae del .mrpack de Cobbleverse solo las entradas pedidas, comprobando
 * tamano y CRC-32 de cada una. No toca nada fuera de los destinos indicados.
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const yauzl = require('yauzl');
const { removeSync } = require('./fsx');

/**
 * @param {string} zipPath
 * @param {Array<{entry:string,dest:string,size:number,crc32:number}>} items
 * @param {(done:number,total:number)=>void} onProgress
 * @returns {Promise<number>} numero de archivos extraidos
 */
function extractEntries(zipPath, items, onProgress, stallMs = 60000) {
    const wanted = new Map(items.map(i => [i.entry, i]));
    const total = wanted.size;
    let done = 0;
    return new Promise((resolve, reject) => {
        let watchdog;
        const arm = () => { clearTimeout(watchdog); watchdog = setTimeout(() => reject(new Error('La instalación de packs no avanza; vuelve a intentarlo.')), stallMs); };
        const settle = fn => v => { clearTimeout(watchdog); fn(v); };
        const ok = settle(resolve), bad = settle(reject);
        arm();
        yauzl.open(zipPath, { lazyEntries: true, autoClose: true }, (err, zip) => {
            if (err) return bad(err);
            const fail = e => { try { zip.close(); } catch (x) { /* ya cerrado */ } bad(e); };

            zip.on('error', fail);
            zip.on('end', () => {
                if (done !== total) return bad(new Error(`Faltan ${total - done} archivos en el pack de Cobbleverse`));
                ok(done);
            });
            zip.on('entry', entry => {
                arm();
                const item = wanted.get(entry.fileName);
                if (!item) return zip.readEntry();
                zip.openReadStream(entry, (e, stream) => {
                    if (e) return fail(e);
                    fs.mkdirSync(path.dirname(item.dest), { recursive: true });
                    const part = item.dest + '.part';
                    const out = fs.createWriteStream(part);
                    let crc = 0, bytes = 0;
                    stream.on('data', c => { crc = zlib.crc32(c, crc); bytes += c.length; });
                    stream.on('error', fail);
                    out.on('error', fail);
                    out.on('finish', () => {
                        if (bytes !== item.size || (crc >>> 0) !== (item.crc32 >>> 0)) {
                            removeSync(part);
                            return fail(new Error(`Archivo corrupto en el pack: ${entry.fileName}`));
                        }
                        fs.renameSync(part, item.dest);
                        done++;
                        if (onProgress) onProgress(done, total);
                        zip.readEntry();
                    });
                    stream.pipe(out);
                });
            });
            zip.readEntry();
        });
    });
}

module.exports = { extractEntries };
