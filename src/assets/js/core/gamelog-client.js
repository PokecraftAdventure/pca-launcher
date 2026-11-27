/**
 * Pokecraft Adventure Launcher
 *
 * Copia del registro del juego en una VENTANA (launcher o registros). El registro de verdad vive en el
 * proceso principal (core/gamelog.js, alimentado por core/session.js); aqui se guarda una foto de las
 * ultimas lineas (`game:snapshot`) y se mantiene al dia con los avisos `game:*`. Misma API que usaba
 * console.js, con estas diferencias porque ahora hay IPC por medio:
 *   - `lines` solo tiene las ultimas `maxLines` (el registro completo esta en el proceso principal);
 *   - `fullText()` (async) devuelve TODO el registro redactado; `toText()` solo lo que hay aqui;
 *   - `loadLast()` y `setLogFile()` son asincronas;
 *   - `ready` se resuelve cuando llega la primera foto; despues se emite `reset` para que la vista se repinte.
 * Eventos: lines | phase | reset | loaded | state | progress | closed.
 */
const EventEmitter = require('events');
const { matches, view } = require('./logview.js');

const IDLE = { id: 'idle', label: 'Esperando al juego', pct: 0, window: false, done: false };

class GameLogClient extends EventEmitter {
    /** @param {{ipc?:object, maxLines?:number}} o  ipc: { on, invoke } (por defecto el de Electron) */
    constructor({ ipc, maxLines = 3000 } = {}) {
        super();
        this.ipc = ipc || require('electron').ipcRenderer;
        this.maxLines = maxLines;
        this.clear();
        this.state = { id: 'idle', detail: null };
        this.hasLastLog = false;

        const on = (channel, fn) => this.ipc.on(channel, (e, payload) => fn(payload));
        on('game:state', s => { this.state = s; this.emit('state', s); });
        on('game:progress', p => this.emit('progress', p));
        on('game:phase', p => { this.phase = p; if (p.id === 'launch') this.lastAt = Date.now(); this.emit('phase', p); });
        on('game:reset', () => { this.clear(); this.emit('reset'); });
        on('game:lines', batch => this.add(batch));
        on('game:closed', c => { this.abnormal = c.abnormal; this.emit('closed', c); });
        // Cambios del historial de skins hechos en el proceso principal: las vistas de skins se repintan igual que antes.
        on('skins:changed', payload => {
            try { require('./skins.js').events.emit('changed', payload); } catch (e) { /* sin skins */ }
        });

        this.ready = this.sync();
    }

    clear() {
        this.lines = [];
        this.total = 0;
        this.lastN = 0;
        this.lastAt = 0;
        this.abnormal = false;
        this.phase = IDLE;
    }

    /** Lineas nuevas del proceso principal (las que ya vinieron en la foto se descartan por su numero). */
    add(batch) {
        const fresh = batch.filter(e => e.n > this.lastN);
        if (!fresh.length) return;
        this.lastN = fresh[fresh.length - 1].n;
        this.total += fresh.length;
        this.lastAt = Date.now();
        this.lines.push(...fresh);
        if (this.lines.length > this.maxLines) this.lines.splice(0, this.lines.length - this.maxLines);
        this.emit('lines', fresh);
    }

    /** Pide la foto actual al proceso principal. */
    async sync() {
        const s = await this.ipc.invoke('game:snapshot', { limit: this.maxLines });
        this.state = s.state;
        this.phase = s.phase;
        this.lines = s.lines;
        this.total = s.total;
        this.lastN = s.lines.length ? s.lines[s.lines.length - 1].n : 0;
        this.lastAt = s.silent == null ? 0 : Date.now() - s.silent * 1000;
        this.abnormal = s.abnormal;
        this.hasLastLog = s.hasLast;
        this.emit('reset');
    }

    /** Segundos desde el ultimo mensaje (null si aun no hay sesion). */
    silentSeconds(now = Date.now()) {
        return this.lastAt ? Math.floor((now - this.lastAt) / 1000) : null;
    }

    view(opts) {
        return view(this.lines, opts);
    }

    matches(e, opts) {
        return matches(e, opts);
    }

    /** Las lineas que hay en esta ventana (las ultimas). Para copiar TODO el registro, `fullText()`. */
    toText() {
        return this.lines.map(l => l.text).join('\n') + '\n';
    }

    /** Todo el registro redactado, tal como esta en el proceso principal. */
    fullText() {
        return this.ipc.invoke('game:log-text');
    }

    /** true si hay registro del ultimo juego: en memoria o un latest.log en disco. */
    hasLast() {
        return this.lines.length > 0 || this.hasLastLog;
    }

    /** Carga latest.log del disco si no hay registro en memoria. @returns {Promise<boolean>} */
    async loadLast() {
        const ok = await this.ipc.invoke('game:load-last');
        await this.sync();
        this.emit('loaded', this.lines.length);
        return ok;
    }

    /** Fija la ruta de latest.log en el proceso principal (hasLast/loadLast la usan). */
    async setLogFile(file) {
        this.hasLastLog = await this.ipc.invoke('game:set-log-file', file);
    }
}

module.exports = { GameLogClient };

// `gameLog`: la copia compartida de esta ventana. Se crea la primera vez que se importa (`const { gameLog } = require(...)`),
// no al cargar el modulo, para poder usar GameLogClient con un IPC falso en las pruebas.
let shared = null, sharedMax = 3000;
// La ventana de registros pide guardar mas lineas (las 20 000 de la memoria principal) ANTES de usar `gameLog`; la del launcher solo necesita las ultimas.
module.exports.setSharedMax = n => { if (!shared && n > 0) sharedMax = n; };
Object.defineProperty(module.exports, 'gameLog', { enumerable: true, get: () => shared || (shared = new GameLogClient({ maxLines: sharedMax })) });
