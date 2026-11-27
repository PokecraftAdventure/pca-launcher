/**
 * Pokecraft Adventure Launcher
 *
 * "Enviar registro": crea un .zip pequeno (para Discord) con el ultimo
 * latest.log completo, el ultimo informe de fallo solo si es de esa sesion y
 * un info.txt. Si fallo la preparacion del juego, lleva ademas ese error
 * (error-preparacion.txt), aunque nunca se haya jugado. Quita tokens, el usuario
 * de Windows y rutas personales. Solo se ejecuta cuando el jugador pulsa el
 * boton; no envia nada por si mismo.
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const readline = require('readline');
const yazl = require('yazl');
const { removeSync } = require('./fsx');

const LIMIT_BYTES = 8 * 1024 * 1024;

const PATTERNS = [
    [/(--accessToken\s+)\S+/gi, '$1<oculto>'],
    [/("?(?:access_?token|refresh_?token|id_?token|client_?token)"?\s*[:=]\s*"?)[A-Za-z0-9._\-~+/=]{12,}/gi, '$1<oculto>'],
    [/\bBearer\s+[A-Za-z0-9._\-~+/=]+/g, 'Bearer <oculto>'],
    [/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, '<jwt oculto>'],
    [/([A-Za-z]:[\\/]+Users[\\/]+)[^\\/\s"':*?<>|]+/gi, '$1<usuario>']
];

const escapeRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Devuelve una funcion que limpia una linea de texto. */
function makeRedactor(username = safeUsername()) {
    const user = username && username.length >= 3 ? new RegExp(escapeRe(username), 'gi') : null;
    return line => {
        for (const [re, rep] of PATTERNS) line = line.replace(re, rep);
        return user ? line.replace(user, '<usuario>') : line;
    };
}

function safeUsername() {
    try { return os.userInfo().username; } catch (e) { return ''; }
}

/** Copia redactando linea a linea (admite logs grandes). Devuelve {lines, crashNames}. */
async function redactFile(src, dst, redact) {
    const out = fs.createWriteStream(dst);
    const rl = readline.createInterface({ input: fs.createReadStream(src, { encoding: 'utf8' }), crlfDelay: Infinity });
    let lines = 0;
    const crashNames = new Set();
    for await (const line of rl) {
        const m = line.match(/crash-[0-9_.\-]+(?:-client|-server)?\.txt/);
        if (m) crashNames.add(m[0]);
        if (!out.write(redact(line) + '\n')) await new Promise(r => out.once('drain', r));
        lines++;
    }
    await new Promise((res, rej) => out.end(e => (e ? rej(e) : res())));
    return { lines, crashNames };
}

/** Ultimas n lineas de un archivo. */
async function tailFile(src, n) {
    const rl = readline.createInterface({ input: fs.createReadStream(src, { encoding: 'utf8' }), crlfDelay: Infinity });
    const buf = [];
    for await (const line of rl) {
        buf.push(line);
        if (buf.length > n) buf.shift();
    }
    return buf.join('\n') + '\n';
}

function newestCrash(crashDir) {
    try {
        return fs.readdirSync(crashDir)
            .filter(f => /^crash-.*\.txt$/.test(f))
            .map(f => ({ f, p: path.join(crashDir, f), m: fs.statSync(path.join(crashDir, f)).mtimeMs }))
            .sort((a, b) => b.m - a.m)[0] || null;
    } catch (e) { return null; }
}

/**
 * Primero se abre el destino y solo despues se empiezan a leer los archivos: si la carpeta no admite escritura no queda
 * ninguna lectura abierta. Si falla a mitad (disco lleno), se vacia la salida antes de avisar, por la misma razon.
 */
function writeZip(out, parts) {
    return new Promise((resolve, reject) => {
        const ws = fs.createWriteStream(out);
        let zip = null;
        const fail = e => reject(new Error(`No se puede escribir en la carpeta ${path.dirname(out)} (${e.code || e.message}).`));
        ws.once('error', e => {
            if (!zip) return fail(e);
            zip.outputStream.unpipe(ws);
            zip.outputStream.once('end', () => fail(e)).resume();
        });
        ws.once('finish', resolve);
        ws.once('open', () => {
            zip = new yazl.ZipFile();
            zip.on('error', reject);
            for (const p of parts) {
                if (p.file) zip.addFile(p.file, p.name, { compress: true });
                else zip.addBuffer(Buffer.from(p.text, 'utf8'), p.name, { compress: true });
            }
            zip.end();
            zip.outputStream.on('error', reject).pipe(ws);
        });
    });
}

const stamp = d => d.toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);

/**
 * @param {object} o { layout, outDir, info:Object<string,string>, limitBytes?, username?, prepareError?:string }
 * @returns {Promise<{path:string, bytes:number, hasCrash:boolean, crashFile:string|null, truncated:boolean}>}
 */
async function buildLogZip({ layout, outDir, info = {}, limitBytes = LIMIT_BYTES, username, prepareError }) {
    const latest = path.join(layout.logsDir, 'latest.log');
    const hasLog = fs.existsSync(latest);
    if (!hasLog && !prepareError) throw new Error('Todavía no hay registro del juego: abre el juego una vez.');

    const redact = makeRedactor(username);
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pca-log-'));
    const tmpLog = path.join(tmpDir, 'latest.log');
    try {
        const { crashNames } = hasLog ? await redactFile(latest, tmpLog, redact) : { crashNames: new Set() };
        const started = hasLog ? fs.statSync(latest).birthtimeMs : 0;

        // Informe de fallo: solo si es de esta sesion (lo cita el log o es posterior a su inicio).
        const crash = hasLog ? newestCrash(layout.crashDir) : null;
        const related = crash && (crashNames.has(crash.f) || crash.m >= started - 5000);
        const crashTmp = path.join(tmpDir, 'crash.txt');
        if (related) await redactFile(crash.p, crashTmp, redact);

        const infoText = (extra = '') => redact(Object.entries(Object.assign({
            'Registro': new Date().toISOString(),
            'Sistema': `${os.type()} ${os.release()} ${os.arch()}`,
            'RAM total': `${(os.totalmem() / 1024 ** 3).toFixed(1)} GB`
        }, info)).map(([k, v]) => `${k}: ${v}`).join('\n') + '\n' + extra);

        const out = path.join(outDir, `PokecraftAdventure-registro-${stamp(new Date())}.zip`);
        const previous = prepareError && hasLog ? 'Nota: latest.log es de una partida anterior; el fallo está en error-preparacion.txt.\n' : '';
        const parts = n => [
            !hasLog ? null : n == null ? { file: tmpLog, name: 'latest.log' } : { text: n, name: 'latest.log' },
            prepareError ? { text: 'No se pudo preparar el juego:\n' + String(prepareError).split('\n').map(redact).join('\n') + '\n', name: 'error-preparacion.txt' } : null,
            { text: infoText(previous + (n == null ? '' : 'Nota: latest.log recortado a las últimas líneas para que quepa en Discord.\n')), name: 'info.txt' }
        ].filter(Boolean).concat(related ? [{ file: crashTmp, name: path.basename(crash.p) }] : []);

        await writeZip(out, parts(null));
        let truncated = false;
        let bytes = fs.statSync(out).size;

        // Si no cabe en el limite, se recorta el log por el principio hasta que quepa.
        if (hasLog && bytes > limitBytes) {
            const total = fs.readFileSync(tmpLog, 'utf8').split('\n').length;
            for (let n = Math.floor(total / 2); n >= 200; n = Math.floor(n / 2)) {
                await writeZip(out, parts(await tailFile(tmpLog, n)));
                truncated = true;
                bytes = fs.statSync(out).size;
                if (bytes <= limitBytes) break;
            }
        }
        return { path: out, bytes, hasCrash: !!related, crashFile: related ? crash.f : null, truncated };
    } finally {
        // La limpieza nunca debe tapar el error de verdad.
        try { removeSync(tmpDir); } catch (e) { console.warn('Temporales del registro:', e.message); }
    }
}

module.exports = { buildLogZip, makeRedactor };
