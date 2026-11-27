/**
 * Pokecraft Adventure Launcher
 *
 * Registro en vivo del juego: guarda las lineas, las clasifica (info / aviso / error), calcula la
 * fase de carga a partir de lo que escribe Fabric y Minecraft y mide cuanto hace del ultimo mensaje.
 * Vive en el PROCESO PRINCIPAL (lo alimenta core/session.js); las ventanas reciben copia por IPC
 * (core/gamelog-client.js). Todo lo que sale de aqui pasa antes por el redactor de tokens y rutas personales.
 */
const fs = require('fs');
const EventEmitter = require('events');
const { makeRedactor } = require('./logzip.js');
const { matches, view } = require('./logview.js');

// Orden de las fases: solo avanzan. Los porcentajes son orientativos (el juego no da un progreso real).
const PHASES = [
    { id: 'fabric', re: /Loading Minecraft [\d.]+ with Fabric Loader/, label: 'Iniciando Fabric', pct: 5 },
    { id: 'mods', re: /\bLoading (\d+) mods\b/, label: n => `Cargando ${n} mods`, pct: 10 },
    { id: 'user', re: /Setting user:/, label: 'Preparando la sesión', pct: 35 },
    { id: 'window', re: /Backend library: LWJGL/, label: 'Abriendo la ventana del juego', pct: 45, window: true },
    { id: 'resources', re: /Reloading ResourceManager/, label: 'Cargando recursos y packs', pct: 55 },
    { id: 'sound', re: /Sound engine started/, label: 'Sonido listo', pct: 80 },
    { id: 'textures', re: /Created: .*gui\.png-atlas/, label: 'Texturas listas', pct: 90 },
    { id: 'connect', re: /Connecting to /, label: 'Conectando al servidor', pct: 95, done: true }
];

const LEVEL_RE = /\/(INFO|WARN|ERROR|FATAL|DEBUG|TRACE)\]/;
const CONT_RE = /^(\s+|at |Caused by:|\.\.\. \d+ more)/;
const EXC_RE = /^[\w.$]+(Exception|Error)\b/;
const CRASH_RE = /This crash report has been saved to|---- Minecraft Crash Report ----|Game crashed|Exception in thread "main"/;
// Dos formatos reales: `[hora] [hilo/NIVEL]: mensaje` (instancia normal) y `[hora] [hilo/NIVEL] (Logger) mensaje` (Fabric en desarrollo)
const PARSE_RE = /^\[(\d{2}:\d{2}:\d{2})\] \[([^\]/]+)\/(\w+)\](?::| \(([^)]*)\)) ?(.*)$/;
const toLevel = l => (l === 'WARN' ? 'warn' : l === 'ERROR' || l === 'FATAL' ? 'error' : 'info');

// ---- Formato XML de la consola ----
// El log4j que pasa el launcher (assets/log_configs/client-1.12.xml, el de Mojang) escribe en la CONSOLA con `LegacyXMLLayout` y en latest.log
// con texto. Como el launcher lee la consola, cada mensaje llega como un bloque:
//   <log4j:Event logger="AutoModpack" timestamp="1795079012827" level="INFO" thread="AutoModpackDownload-3">
//     <log4j:Message><![CDATA[Downloading x.png - []]]></log4j:Message>
//     [<log4j:Throwable><![CDATA[... traza ...]]></log4j:Throwable>]
//   </log4j:Event>
// Se juntan las lineas del bloque y se convierten en UNA linea de texto normal, con el mismo formato que usa la pantalla
// (`[hora] [hilo/NIVEL] (origen) mensaje`); un mensaje de varias lineas o una traza siguen como lineas de continuacion.
const XML_OPEN = /^\s*<log4j:Event\b/;
const XML_CLOSE = '</log4j:Event>';
const XML_MAX_LINES = 400;          // un bloque que nunca se cierra no se traga el registro: pasado este limite se muestra tal cual

const xmlUnescape = s => s.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const two = n => String(n).padStart(2, '0');

/** Convierte un bloque XML completo (o recortado) en { head, rest[], level } o null si no es un evento reconocible. */
function parseXmlEvent(text, now = Date.now()) {
    const merged = text.replace(/\]\]><!\[CDATA\[/g, '');      // log4j parte un "]]>" del mensaje en dos secciones CDATA: se vuelven a unir
    const open = /<log4j:Event\b([^>]*)>/.exec(merged);
    if (!open) return null;
    const attrs = {};
    for (const m of open[1].matchAll(/([\w.:-]+)="([^"]*)"/g)) attrs[m[1]] = xmlUnescape(m[2]);
    // Si el bloque quedo a medias (el juego se cerro), se rescata lo que llego del mensaje en vez de perderlo.
    const msg = /<log4j:Message>\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*<\/log4j:Message>/.exec(merged) || /<log4j:Message>\s*<!\[CDATA\[([\s\S]*)$/.exec(merged);
    const thr = /<log4j:Throwable>\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*<\/log4j:Throwable>/.exec(merged);
    const level = /^(INFO|WARN|ERROR|FATAL|DEBUG|TRACE)$/i.test(attrs.level || '') ? attrs.level.toUpperCase() : 'INFO';
    const ts = Number(attrs.timestamp);
    const d = new Date(Number.isFinite(ts) && ts > 0 ? ts : now);
    const time = `${two(d.getHours())}:${two(d.getMinutes())}:${two(d.getSeconds())}`;
    const thread = (attrs.thread || 'main').replace(/[\]/]/g, '-');
    const logger = (attrs.logger || '').replace(/[()]/g, '');
    const lines = (msg ? msg[1] : '').replace(/\r\n/g, '\n').split('\n');
    const first = lines.shift();
    const rest = lines.concat(thr ? thr[1].replace(/\r\n/g, '\n').replace(/\n+$/, '').split('\n') : []);
    // Sin origen: `[hora] [hilo/NIVEL]: mensaje` (como latest.log); con origen: `[hora] [hilo/NIVEL] (origen) mensaje`.
    const head = `[${time}] [${thread}/${level}]${logger ? ` (${logger}) ` : ': '}${first}`;
    return { head, rest, level: toLevel(level) };
}

class GameLog extends EventEmitter {
    constructor({ max = 20000, redact = makeRedactor() } = {}) {
        super();
        this.max = max;
        this.redact = redact;
        this.reset();
    }

    reset() {
        this.lines = [];
        this.partial = '';
        this.xml = null;          // bloque XML a medias (lineas ya recibidas de un <log4j:Event> que aun no se cierra)
        this.n = 0;
        this.phase = { id: 'idle', label: 'Esperando al juego', pct: 0, window: false, done: false };
        this.lastAt = 0;
        this.sawCrash = false;
        this.abnormal = false;
        this.exitCode = null;
        this.emit('reset');
    }

    /** Marca el inicio de la sesion (para el reloj de "ultimo mensaje"). */
    begin(now = Date.now()) {
        this.reset();
        this.lastAt = now;
        this.phase = { id: 'launch', label: 'Lanzando el juego', pct: 2, window: false, done: false };
        this.emit('phase', this.phase);
    }

    /** chunk: texto tal como llega de stdout/stderr (puede traer varias lineas o una a medias). */
    push(chunk, now = Date.now()) {
        const text = this.partial + String(chunk).replace(/\r\n/g, '\n');
        const parts = text.split('\n');
        this.partial = parts.pop();
        const added = [];
        for (const raw of parts) this.take(raw, now, added);
        if (added.length) {
            this.lastAt = now;
            this.emit('lines', added);
        }
        return added;
    }

    /** Una linea completa de la consola: texto normal, o parte de un bloque XML de log4j (se junta hasta que se cierra). */
    take(raw, now, added) {
        const push = e => { if (e) added.push(e); };
        if (this.xml) {
            this.xml.push(raw);
            if (raw.includes(XML_CLOSE) || this.xml.length > XML_MAX_LINES) this.flushXml(now, added);
            return;
        }
        if (XML_OPEN.test(raw)) {
            this.xml = [raw];
            if (raw.includes(XML_CLOSE)) this.flushXml(now, added);
            return;
        }
        push(this.add(raw, now));
    }

    /** Termina el bloque XML en curso: lo convierte en lineas normales; si no se entiende, lo deja tal cual. */
    flushXml(now, added) {
        const block = this.xml;
        this.xml = null;
        if (!block || !block.length) return;
        const ev = parseXmlEvent(block.join('\n'), now);
        if (!ev) { for (const raw of block) { const e = this.add(raw, now); if (e) added.push(e); } return; }
        const head = this.add(ev.head, now);
        if (head) added.push(head);
        for (const raw of ev.rest) {
            const e = this.add(raw, now, ev.level);     // el resto del mensaje y la traza heredan el nivel del evento
            if (e) added.push(e);
        }
    }

    /** `forced`: nivel ya conocido (resto de un mensaje XML: no se vuelve a analizar). */
    add(raw, now, forced) {
        const text = this.redact(raw);
        if (!text.trim()) return null;
        const prev = this.lines[this.lines.length - 1];
        let level;
        const m = LEVEL_RE.exec(text);
        if (forced) level = forced;
        else if (m) level = toLevel(m[1]);
        else if (prev && prev.level !== 'info' && EXC_RE.test(text)) level = prev.level;     // la excepcion que sigue a un error
        else if (prev && CONT_RE.test(text)) level = prev.level;                              // trazas: heredan el nivel
        else if (/^(ERROR|FATAL)\b|Exception|\bFATAL\b/.test(text)) level = 'error';
        else if (/^WARN\b/.test(text)) level = 'warn';
        else level = 'info';

        // Estructura de la linea para poder colorear cada parte: [hora] [hilo/NIVEL]: mensaje
        const p = forced ? null : PARSE_RE.exec(text);
        const e = { n: ++this.n, text, level, t: now, time: p ? p[1] : null, thread: p ? p[2] : null, tag: p ? p[3] : null, logger: p && p[4] ? p[4] : null, msg: p ? p[5] : text };
        this.lines.push(e);
        if (this.lines.length > this.max) this.lines.splice(0, this.lines.length - this.max);
        if (CRASH_RE.test(text)) this.sawCrash = true;
        this.advance(text);
        return e;
    }

    advance(text) {
        for (const p of PHASES) {
            if (p.pct <= this.phase.pct) continue;
            const m = p.re.exec(text);
            if (!m) continue;
            this.phase = {
                id: p.id,
                label: typeof p.label === 'function' ? p.label(m[1]) : p.label,
                pct: p.pct,
                window: this.phase.window || !!p.window,
                done: !!p.done
            };
            this.emit('phase', this.phase);
        }
    }

    /**
     * El juego termino. La libreria no informa del codigo de salida (solo dice "Minecraft closed"),
     * asi que se deduce de lo que escribio el juego: anormal si hubo un fallo registrado o si ni
     * siquiera llego a abrir la ventana. Un cierre normal escribe "Stopping!".
     */
    finish(code, now = Date.now()) {
        if (this.xml) { const added = []; this.flushXml(now, added); if (added.length) this.emit('lines', added); }   // un bloque que quedo a medias al cerrarse el juego
        this.exitCode = typeof code === 'number' ? code : null;
        const numericError = typeof code === 'number' && code !== 0;
        this.abnormal = this.sawCrash || !this.phase.window || numericError;
        const label = this.abnormal
            ? (this.sawCrash ? 'El juego falló y se cerró' : this.phase.window ? `El juego se cerró con error (código ${code})` : 'El juego se cerró antes de abrir la ventana')
            : 'Juego cerrado';
        this.phase = Object.assign({}, this.phase, { id: 'closed', label, done: true });
        this.emit('phase', this.phase);
    }

    /** Segundos desde el ultimo mensaje (null si aun no hay sesion). */
    silentSeconds(now = Date.now()) {
        return this.lastAt ? Math.floor((now - this.lastAt) / 1000) : null;
    }

    /** filter: 'all' | 'warn' (avisos y errores) | 'error'. query: texto a buscar. */
    view(opts) {
        return view(this.lines, opts);
    }

    matches(e, opts) {
        return matches(e, opts);
    }

    toText() {
        return this.lines.map(l => l.text).join('\n') + '\n';
    }

    /** Ruta de latest.log para hasLast()/loadLast() sin argumento (la fija quien conoce la instalacion). */
    setLogFile(file) {
        this.logFile = file || null;
    }

    /** true si hay registro del ultimo juego: en memoria o, si no, un latest.log en disco. */
    hasLast(file = this.logFile) {
        if (this.lines.length) return true;
        try { return !!file && fs.statSync(file).size > 0; } catch (e) { return false; }
    }

    /**
     * Carga latest.log del disco cuando la memoria esta vacia (p. ej. tras reiniciar el launcher).
     * Redacta como el resto. Devuelve true si habia algo que mostrar. No toca la fase ni los
     * indicadores de cierre: es solo para ver y copiar el registro anterior.
     */
    loadLast(file = this.logFile) {
        if (this.lines.length) return true;
        if (!file) return false;
        let text;
        try { text = fs.readFileSync(file, 'utf8'); } catch (e) { return false; }
        if (!text.trim()) return false;
        let mtime = Date.now();
        try { mtime = fs.statSync(file).mtimeMs; } catch (e) { /* se usa la hora actual */ }
        const { phase, abnormal, sawCrash } = this;
        this.push(text.endsWith('\n') ? text : text + '\n', mtime);
        Object.assign(this, { phase, abnormal, sawCrash });
        return this.lines.length > 0;
    }
}

const gameLog = new GameLog();

module.exports = { GameLog, gameLog };
