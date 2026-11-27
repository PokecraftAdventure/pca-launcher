/**
 * Pokecraft Adventure Launcher
 *
 * Sesion de juego en el PROCESO PRINCIPAL (T14.3). Prepara la instancia, lanza el juego con
 * minecraft-java-core, alimenta el registro (core/gamelog.js) y avisa del estado a las ventanas.
 * Las ventanas (launcher, registros) son solo vistas: pueden cerrarse y volver a abrirse sin afectar
 * al juego, y se ponen al dia con `snapshot()`.
 *
 * Estados (`game:state`): idle | preparing | loading | running | cancelling | cancelled | closed | error
 *   preparing: descargar mod base, packs y configs, comprobar archivos y arrancar Java
 *   loading:   el juego ya escribe en su registro (anillo de carga)
 *   running:   la ventana del juego ya se abrio (`phase.window`) o llego a conectar
 *   cancelling / cancelled: el jugador cancelo la carga (solo antes de que se abra la ventana del juego, ver `cancel()`)
 *   closed / error: terminada; se queda asi hasta la siguiente sesion
 * Eventos hacia las ventanas (canal `emit`): game:state, game:progress, game:lines, game:phase,
 * game:reset, game:closed y skins:changed (lo que cambio el historial de skins al cerrarse el juego).
 */
const path = require('path');
const cfg = require('../../../launcher.config.json');

const BUSY = new Set(['preparing', 'loading', 'running', 'cancelling']);
const PROGRESS_MS = 100;       // las barras no necesitan mas de 10 avisos por segundo
const DURING_GAME = ['launcher', 'log', 'background'];   // Ajustes > Durante el juego: Launcher | Registros | Ocultar todo
const VIEW_DELAY_MS = 3000;    // "Durante el juego" se aplica unos segundos despues de abrirse la ventana del juego

/** Piezas que usa la sesion; se cargan al primer uso (y se pueden sustituir en las pruebas). */
function defaults() {
    const instance = require('./instance');
    return {
        Launch: require('minecraft-java-core').Launch,
        ensureBaseMods: require('./basemods').ensureBaseMods,
        prepareInstance: instance.prepareInstance,
        setQuality: instance.setQuality,
        finalizeTcg: require('./tcg').finalizeTcg,
        stateMod: require('./state'),
        qualityMod: require('./quality'),
        playstats: require('./playstats'),
        skins: require('./skins'),
        manifest: require('../../../assets-manifest.json'),
        baseMods: cfg.baseMods || [],
        seedMods: cfg.seedMods || []
    };
}

/** Script de PowerShell que cierra los `java*` cuya linea de comandos lleva la carpeta de la instancia ($env:PCA_INSTANCE_DIR). */
function killScript() {
    return "$d = $env:PCA_INSTANCE_DIR.Replace('/', '\\').TrimEnd('\\'); " +
        "Get-CimInstance Win32_Process -Filter \"Name LIKE 'java%'\" | " +
        "Where-Object { $_.CommandLine -and $_.CommandLine.Replace('/', '\\').IndexOf($d, [StringComparison]::OrdinalIgnoreCase) -ge 0 } | " +
        "ForEach-Object { Stop-Process -Id $_.ProcessId -Force }";
}

class Session {
    /**
     * @param {object} o
     *   gameLog   registro (por defecto el de core/gamelog.js)
     *   emit      (canal, datos) => void: envia a todas las ventanas abiertas
     *   hooks     { onState(id), onClosed({ abnormal, cancelled }), taskbar(valor), gameOpened(modo) }; valor: 0..1, 2 = indeterminado, -1 = quitar
     *   flushMs   agrupacion de lineas del registro antes de enviarlas (por defecto 50 ms)
     *   ...       cualquier pieza de defaults() para sustituirla
     */
    constructor({ gameLog, emit, hooks, flushMs = 50, viewDelayMs = VIEW_DELAY_MS, killRetryMs = 2500, ...parts } = {}) {
        this.gameLog = gameLog || require('./gamelog').gameLog;
        this.emit = emit || (() => { });
        this.hooks = Object.assign({ onState() { }, onClosed() { }, taskbar() { }, gameOpened() { } }, hooks);
        this.flushMs = flushMs;
        this.viewDelayMs = viewDelayMs;
        this.killRetryMs = killRetryMs;      // tras cancelar, cuanto se espera antes de repetir el cierre de Java
        this.parts = parts;
        this.state = { id: 'idle', detail: null };
        this.queue = [];
        this.flushTimer = null;
        this.lastProgress = { key: '', at: 0 };

        const g = this.gameLog;
        g.on('reset', () => { clearTimeout(this.flushTimer); this.flushTimer = null; this.queue = []; this.emit('game:reset', null); });
        g.on('lines', lines => this.enqueue(lines));
        g.on('phase', p => this.onPhase(p));
    }

    get busy() {
        return BUSY.has(this.state.id);
    }

    d() {
        return this.deps || (this.deps = Object.assign(defaults(), this.parts));
    }

    // ---- hacia las ventanas ----

    setState(id, detail = null) {
        this.state = { id, detail };
        this.emit('game:state', this.state);
        this.hooks.onState(id);
    }

    enqueue(lines) {
        this.queue.push(...lines);
        if (!this.flushTimer) this.flushTimer = setTimeout(() => this.flush(), this.flushMs);
    }

    /** Envia ya las lineas pendientes (antes de cualquier otro aviso, para conservar el orden). */
    flush() {
        clearTimeout(this.flushTimer);
        this.flushTimer = null;
        if (this.queue.length) this.emit('game:lines', this.queue.splice(0));
    }

    progress(type, current, total, label) {
        const now = Date.now();
        const last = this.lastProgress;
        const key = type + '|' + label;
        const final = total > 0 && current >= total;
        if (!final && key === last.key && now - last.at < PROGRESS_MS) return;
        this.lastProgress = { key, at: now };
        this.emit('game:progress', { type, current, total, label });
        this.hooks.taskbar(total > 0 ? Math.min(1, current / total) : 2);
    }

    onPhase(p) {
        this.flush();
        this.emit('game:phase', p);
        if (!this.gameStarted || this.ending) return;
        if ((p.window || p.done) && this.state.id === 'loading') {
            const openedAt = Date.now();
            this.setState('running', { openedAt });
            this.hooks.taskbar(-1);
            // Ahora SI se jugo: empieza a contar el tiempo (un intento que no llega a abrir el juego no deja rastro).
            if (!this.playCounted) { this.playCounted = true; try { this.d().playstats.startSession(openedAt); } catch (e) { console.warn('playstats', e); } }
        } else if (this.state.id === 'loading') {
            this.hooks.taskbar(p.pct / 100);
        }
        // Elegido en Ajustes ("Durante el juego"): se aplica al abrirse el juego, aunque el jugador haya cambiado de pantalla a mano.
        if (p.window && this.duringGame && !this.viewTimer) {
            this.viewTimer = setTimeout(() => { if (this.state.id === 'running') this.hooks.gameOpened(this.duringGame); }, this.viewDelayMs);
        }
    }

    /** Foto para una ventana que se abre (o se recrea) con el juego ya en marcha o ya cerrado. */
    snapshot(opts) {
        const g = this.gameLog;
        const limit = (opts && opts.limit > 0) ? opts.limit : 3000;
        return {
            state: this.state,
            phase: g.phase,
            lines: g.lines.slice(-limit),
            total: g.lines.length,
            silent: g.silentSeconds(),
            abnormal: g.abnormal,
            hasLast: g.hasLast()
        };
    }

    // ---- ciclo de vida ----

    /**
     * Lanza una sesion. Responde enseguida; el avance llega por eventos.
     * @param {object} opts { launch, quality?, duringGame? }
     *   duringGame: 'launcher' | 'log' | 'background' = que se deja a la vista cuando se abre la ventana del juego (hook gameOpened)
     *   launch: opciones de `Launch.Launch()` (cuenta, rutas, version, loader, java, memoria, JVM_ARGS, GAME_ARGS...)
     * @returns {{ok:boolean, error?:string}}
     */
    start(opts) {
        if (this.busy) return { ok: false, error: 'Ya hay una sesion en curso' };
        if (!opts || !opts.launch || !opts.launch.path || !opts.launch.authenticator) return { ok: false, error: 'Faltan datos para lanzar el juego' };
        this.duringGame = DURING_GAME.includes(opts.duringGame) ? opts.duringGame : null;
        this.gameStarted = false;
        this.ending = false;
        this.viewTimer = null;
        // Cancelar: cada sesion lleva su "ficha"; los avisos tardios de una sesion cancelada (la libreria no se puede abortar) se ignoran.
        this.token = (this.token || 0) + 1;
        this.cancelled = false;
        this.launching = false;
        this.instanceDir = null;
        this.killing = false;         // una sola consulta de cierre de Java a la vez
        this.killScheduled = false;   // el cierre tras cancelar se programa una sola vez, no por cada linea del juego
        this.playCounted = false;     // las estadisticas de juego (horas, ultima vez) solo cuentan si la ventana del juego llega a abrirse
        clearTimeout(this.cancelGuard);
        this.abort = new AbortController();
        this.setState('preparing');
        this.hooks.taskbar(2);
        this.run(opts).catch(err => this.fail('prepare', err));
        return { ok: true };
    }

    async run(opts) {
        const d = this.d();
        const layout = require('./paths').layout(opts.launch.path);
        const quality = d.qualityMod.PRESETS[opts.quality] ? opts.quality : d.qualityMod.DEFAULT_QUALITY;
        const token = this.token, signal = this.abort.signal;
        const alive = () => token === this.token && !this.cancelled;
        this.instanceDir = layout.instanceDir;

        // 1) AutoModpack (y, antes de su primera sincronizacion, los mods del menu), 2) packs, shaders y configs, 3) packs de TCG ya descargados.
        // Las descargas reciben `signal`: al cancelar se cortan en el acto (igual que "Reparar").
        try {
            await d.ensureBaseMods(layout.modsDir, d.baseMods, (done, total) => { if (alive()) this.progress('prepare', done, total, 'Descargando archivos'); }, signal, d.seedMods);
            if (!alive()) return;
            await d.prepareInstance({ layout, manifest: d.manifest, quality, onProgress: p => { if (alive()) this.progress('prepare', p.done, p.total, p.text); }, signal });
            if (!alive()) return;
            // Si el jugador cambio la calidad en Ajustes, se aplica ahora (el juego esta cerrado).
            const st = d.stateMod.load(layout.stateFile);
            if (st.quality && st.quality !== quality) d.setQuality(layout, quality);
            d.finalizeTcg({ layout, manifest: d.manifest });
        } catch (err) {
            if (!alive()) return;       // el corte por cancelar no es un fallo
            return this.fail('prepare', err);
        }
        if (!alive()) return;

        this.gameLog.setLogFile(path.join(layout.logsDir, 'latest.log'));
        try { d.skins.configure(layout.instanceDir); } catch (e) { console.warn('Skins:', e); }
        this.gameLog.begin();

        const launch = new d.Launch();
        this.launching = true;
        launch.on('extract', () => { if (alive()) this.hooks.taskbar(2); });
        launch.on('progress', (current, total) => { if (alive()) this.progress('download', current, total, 'Descargando archivos'); });
        launch.on('check', (current, total) => { if (alive()) this.progress('check', current, total, 'Comprobando archivos'); });
        launch.on('patch', () => { if (alive()) { this.hooks.taskbar(2); this.progress('patch', 0, 0, 'Aplicando cambios'); } });
        launch.on('data', data => this.onData(data, token));
        launch.on('close', code => this.finish(code, token));
        launch.on('error', err => this.fail('launch', err, token));
        try {
            launch.Launch({ ...opts.launch, detached: true });
        } catch (err) {
            this.fail('launch', err, token);
        }
    }

    /**
     * Cancelar la carga (solo antes de que se abra la ventana del juego).
     *  - preparando (descargas de packs/configs): se cortan al instante con `signal`.
     *  - la libreria comprueba/descarga: no se puede abortar; se queda en `cancelling` y termina en cuanto intente lanzar Java
     *    (se mata) o acabe sola.
     *  - Java ya arranco (anillo de carga): se mata el proceso del juego de ESTA instancia.
     */
    cancel() {
        if (!this.busy || this.state.id === 'cancelling') return { ok: false, error: 'No hay ninguna carga que cancelar' };
        if (this.state.id === 'running') return { ok: false, error: 'El juego ya esta abierto' };
        this.cancelled = true;
        clearTimeout(this.viewTimer);
        try { this.abort.abort(); } catch (e) { /* ya cortado */ }
        this.setState('cancelling');
        if (this.gameStarted) {
            this.killGame();
            this.cancelGuard = setTimeout(() => { this.killGame(); this.finishCancel(); }, 6000);   // por si la libreria no avisa del cierre
        } else if (!this.launching) {
            this.finishCancel();
        }
        return { ok: true };
    }

    /**
     * Mata el proceso de Java que lleva la carpeta de ESTA instancia (la libreria no da el proceso). Solo Windows (el launcher es solo Windows).
     * - La ruta se compara sin distinguir `/` de `\` ni mayusculas: Java la lleva con `/` y path.join la construye con `\`.
     * - Solo hay una consulta a la vez (cada una es un PowerShell) y se corta a los 15 s.
     * - El filtro por nombre lo hace el propio WMI (`Name LIKE 'java%'`), que es mucho mas barato que listar todos los procesos.
     */
    killGame() {
        if (process.platform !== 'win32' || !this.instanceDir || this.killing) return;
        this.killing = true;
        try {
            require('child_process').execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', killScript()],
                { env: { ...process.env, PCA_INSTANCE_DIR: this.instanceDir }, windowsHide: true, timeout: 15000 }, () => { this.killing = false; });
        } catch (e) { this.killing = false; console.warn('No se pudo cerrar el juego:', e); }
    }

    /** Fin de una cancelacion: deja la sesion lista para empezar otra. */
    finishCancel() {
        if (this.state.id !== 'cancelling') return;
        clearTimeout(this.cancelGuard);
        this.flush();
        this.hooks.taskbar(-1);
        // Cancelar solo es posible antes de abrirse la ventana del juego: no hay nada que contar en las estadisticas.
        // El registro vuelve a "sin sesion" (antes se quedaba en "Lanzando el juego 2 %", como si aun cargara, y sin lineas).
        this.gameLog.reset();
        this.gameLog.abnormal = false;
        this.hooks.onClosed({ cancelled: true });
        this.setState('cancelled');
        this.emit('game:closed', { code: null, abnormal: false, cancelled: true });
    }

    onData(data, token) {
        if (token !== undefined && token !== this.token) return;     // aviso tardio de una sesion anterior
        if (this.cancelled) {
            // La libreria llego a lanzar Java despues de cancelar: se mata (con un segundo intento por si tarda en aparecer el proceso).
            // Esto pasa por CADA linea que escribe el juego: se programa una sola vez (antes salian decenas de PowerShell).
            if (this.killScheduled) return;
            this.killScheduled = true;
            this.killGame();
            setTimeout(() => this.killGame(), this.killRetryMs);
            setTimeout(() => this.finishCancel(), Math.round(this.killRetryMs * 1.4));
            return;
        }
        // El primer mensaje lo escribe la libreria ("Launching with arguments...") ANTES de que Java arranque:
        // se guarda en el registro, pero la sesion pasa a "loading" con la primera linea del propio juego.
        if (!this.gameStarted && /^\s*Launching with arguments/.test(String(data))) {
            this.gameLog.push(data);
            this.progress('prepare', 0, 0, 'Preparando');
            return;
        }
        if (!this.gameStarted) {
            this.gameStarted = true;
            this.setState('loading');
        }
        this.gameLog.push(data);
    }

    /** El juego se cerro (la libreria no da el codigo de salida: gameLog deduce si fue anormal). */
    finish(code, token) {
        if (token !== undefined && token !== this.token) return;
        if (this.cancelled) return this.finishCancel();
        if (!this.end()) return;
        this.gameLog.finish(code);
        this.close('closed', null, this.gameLog.abnormal);
    }

    /**
     * Fallo. kind 'prepare': no se llego a lanzar (se avisa con el estado `error`, sin pantalla de cierre);
     * kind 'launch': error de la libreria con el juego ya lanzado o al lanzarlo.
     */
    fail(kind, err, token) {
        if (token !== undefined && token !== this.token) return;
        if (this.cancelled) return this.finishCancel();
        if (kind === 'prepare') {
            if (!this.busy || this.gameStarted) return;
            this.hooks.taskbar(-1);
            return this.setState('error', { kind, message: `No se pudo preparar el juego: ${(err && err.message) || err}` });
        }
        if (!this.end()) return;
        const text = err && typeof err.error === 'string' ? err.error : (err && err.message) || JSON.stringify(err);
        this.gameLog.push(`[launcher] ${text}\n`);
        this.gameLog.finish(null);
        this.gameLog.abnormal = true;
        this.close('error', { kind, message: text }, true);
    }

    /** Cierra la contabilidad de la sesion una sola vez. Devuelve false si ya estaba cerrada. */
    end() {
        if (this.ending || !this.busy) return false;
        this.ending = true;
        clearTimeout(this.viewTimer);
        this.flush();
        this.hooks.taskbar(-1);
        // Solo si el juego llego a abrirse: si fallo o se cerro antes de la ventana, no suma horas ni cambia "ultima vez".
        if (this.playCounted) { try { this.d().playstats.endSession(Date.now()); } catch (e) { console.warn('playstats', e); } }
        return true;
    }

    /** Al cerrarse el juego se lee lo que QuickSkin dejo (skin activa y skins nuevas) para el historial. */
    syncSkins() {
        const skins = this.d().skins;
        const forward = payload => this.emit('skins:changed', payload);
        skins.events.on('changed', forward);
        try { skins.autoSync(); } catch (e) { console.warn('Skins:', e); }   // el historial no debe afectar al cierre
        finally { skins.events.off('changed', forward); }
    }

    close(id, detail, abnormal) {
        this.syncSkins();
        this.flush();
        this.hooks.onClosed({ abnormal: !!abnormal });           // vuelve el launcher (cierre normal) o los registros con el error (cierre anormal)
        this.setState(id, detail);
        this.emit('game:closed', { code: this.gameLog.exitCode, abnormal });
    }
}

module.exports = { Session };
