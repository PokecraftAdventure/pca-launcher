/**
 * Pokecraft Adventure Launcher
 *
 * Ventana de registros del juego (T14.3). Es una ventana INDEPENDIENTE del launcher: el juego y su registro
 * viven en el proceso principal (core/session.js, core/gamelog.js) y esta ventana solo los muestra, asi que
 * el launcher puede usarse, ocultarse o destruirse mientras esta abierta. Filtros, busqueda, copiar y
 * crear archivo funcionan igual que en el antiguo panel Registros.
 */
import { createLogFile } from './utils/logfile.js';
import { currentLayout } from './utils/installlayout.js';
import { FONDO_IMAGENES, initImageBackground } from './utils/backdrop.js';
import { lineNode } from './utils/logline.js';

const { ipcRenderer, clipboard } = require('electron');
const path = require('path');
const { openFolder } = require('./assets/js/utils/openfolder.js');
const gameLogClient = require('./assets/js/core/gamelog-client.js');
gameLogClient.setSharedMax(20000);      // esta ventana guarda todo lo que guarda la memoria principal (antes solo las ultimas 3 000)
const { gameLog } = gameLogClient;

// Lineas visibles a la vez. Eran 600: con un registro real (3 400 lineas en una sesion corta de prueba) los primeros errores se salian de
// la pantalla al seguir el registro. La memoria guarda 20 000 (core/gamelog.js); aqui solo se limita lo que se dibuja.
const MAX_DOM = 5000;
const NEAR_END = 24;                 // px de margen para considerar "al final"
const PAUSE_NOTE = 'En pausa: el registro sigue guardándose y se muestra al reanudar.';
const ICON_PAUSE = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6v12M15 6v12"/></svg>';
const ICON_PLAY = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13l11-6.5z"/></svg>';

class LogWindow {
    constructor() {
        this.filter = 'all';
        this.query = '';
        this.pending = [];
        this.scheduled = false;
        this.paused = false;        // en pausa: lo que ya se ve se queda quieto y las lineas nuevas esperan en `pending`
        this.pausedAt = 0;          // numero (`n`) de la ultima linea que habia al pausar
        this.jump = false;          // al reanudar, ir al final aunque el jugador hubiera subido
        this.lastLabel = '';
        this.root = document.querySelector('.logwin');
        const q = s => this.root.querySelector(s);
        this.el = {
            badge: q('.log-badge'), title: q('.log-title'), sub: q('.log-sub'),
            lines: q('.log-lines'), down: q('.log-down'), note: q('.log-foot-note'), create: q('.log-create'), box: q('.log-box'), pause: q('.log-pause'), cancel: q('.log-cancel')
        };
        this.initFrame();

        this.root.querySelectorAll('.log-filters button').forEach(b => b.addEventListener('click', () => {
            this.root.querySelectorAll('.log-filters button').forEach(x => { x.classList.toggle('on', x === b); x.setAttribute('aria-pressed', x === b ? 'true' : 'false'); });
            this.filter = b.dataset.filter;
            this.renderAll();
        }));
        q('.log-search').addEventListener('input', e => { this.query = e.target.value; this.renderAll(); });
        this.el.pause.addEventListener('click', () => this.togglePause());
        // Cambio de pantalla: "Launcher" cierra los registros y muestra el launcher. "Cancelar" (solo cargando) detiene todo.
        q('.log-back').addEventListener('click', () => ipcRenderer.send('view:go', 'launcher'));
        this.el.cancel.addEventListener('click', () => { this.el.cancel.disabled = true; ipcRenderer.invoke('game:cancel').catch(e => console.warn('Cancelar:', e)); });
        q('.log-copy').addEventListener('click', () => this.copy());
        q('.log-open').addEventListener('click', () => this.openLogs());
        this.el.create.addEventListener('click', () => this.createFile());
        this.el.down.addEventListener('click', () => this.toEnd());
        this.el.lines.addEventListener('scroll', () => this.updateArrow());

        gameLog.on('reset', () => { this.pending = []; this.lastLabel = ''; this.paused = false; this.pausedAt = 0; this.jump = false; this.renderAll(); this.updatePauseUi(); this.refresh(); this.showLast(); });
        gameLog.on('lines', lines => { this.pending.push(...lines); this.schedule(); });
        gameLog.on('phase', p => { if (p.id !== 'closed') this.lastLabel = p.label; this.refresh(); });
        gameLog.on('state', () => this.refresh());
        gameLog.on('closed', () => this.refresh());
        gameLog.on('loaded', () => { this.renderAll(); this.refresh(); });
        this.start();
    }

    // Botones de la barra de titulo propia (la ventana no tiene marco).
    initFrame() {
        const act = a => () => ipcRenderer.send('log-window:control', a);
        document.querySelector('.other .frame #minimize').addEventListener('click', act('minimize'));
        const max = document.querySelector('.other .frame #maximize');
        max.addEventListener('click', () => {
            ipcRenderer.send('log-window:control', 'maximize');
            max.classList.toggle('icon-maximize');
            max.classList.toggle('icon-restore-down');
        });
        document.querySelector('.other .frame #close').addEventListener('click', act('close'));
    }

    async start() {
        try { await gameLog.ready; } catch (e) { console.warn('Registro:', e); }
        await this.showLast();
        this.renderAll();
        this.refresh();
        this.toEnd();
    }

    // Sin sesion en curso ni registro en memoria (launcher recien abierto o carga cancelada): se muestra el registro de la
    // ultima sesion si existe en disco. Si despues empieza un juego, no se toca nada.
    async showLast() {
        if (gameLog.lines.length || gameLog.phase.id !== 'idle') return;
        try {
            const layout = await currentLayout();
            if (gameLog.lines.length || gameLog.phase.id !== 'idle') return;     // empezo un juego mientras se resolvia la ruta
            await gameLog.setLogFile(path.join(layout.logsDir, 'latest.log'));
            if (gameLog.hasLast()) await gameLog.loadLast();
        } catch (e) { console.warn('Registro anterior:', e); }
    }

    atEnd() {
        const l = this.el.lines;
        return l.scrollHeight - l.scrollTop - l.clientHeight <= NEAR_END;
    }

    toEnd() {
        this.el.lines.scrollTop = this.el.lines.scrollHeight;
        this.updateArrow();
    }

    // La flecha solo aparece si lo que se ve no son los ultimos registros.
    updateArrow() { this.el.down.classList.toggle('show', !this.atEnd()); }

    // Las lineas nuevas se agrupan para no repintar por cada una (el juego escribe cientos por segundo).
    // En pausa no se dibuja nada: las lineas se quedan en `pending` (y en la memoria del registro) hasta reanudar.
    schedule() {
        if (this.scheduled || this.paused) return;
        this.scheduled = true;
        requestAnimationFrame(() => {
            this.scheduled = false;
            if (!this.paused) this.flush();
        });
    }

    /** Dibuja ahora las lineas que esperan. Sigue las nuevas si el jugador esta al final (o si se acaba de reanudar). */
    flush() {
        const follow = this.atEnd() || this.jump;
        this.jump = false;
        const batch = this.pending.splice(0);
        const frag = document.createDocumentFragment();
        for (const e of batch) if (gameLog.matches(e, this)) frag.appendChild(lineNode(e, { columns: true }));
        if (frag.childNodes.length) {
            this.el.lines.appendChild(frag);
            while (this.el.lines.childNodes.length > MAX_DOM) this.el.lines.removeChild(this.el.lines.firstChild);
            if (follow) this.el.lines.scrollTop = this.el.lines.scrollHeight;
        }
        this.updateArrow();
        this.updateEmpty();
    }

    /** Pausar congela lo que se ve para poder leer una linea sin que se vaya; el registro sigue guardandose y se muestra al reanudar. */
    togglePause(force) {
        const want = typeof force === 'boolean' ? force : !this.paused;
        if (want === this.paused) return;
        if (want) {
            this.flush();                                   // lo que ya habia llegado se dibuja antes de congelar
            this.paused = true;
            const last = gameLog.lines[gameLog.lines.length - 1];
            this.pausedAt = last ? last.n : 0;
        } else {
            this.paused = false;
            this.jump = true;                               // reanudar = volver a seguir el registro desde el final
            this.schedule();
        }
        this.updatePauseUi();
        this.refresh();
    }

    updatePauseUi() {
        const b = this.el.pause, on = this.paused;
        b.classList.toggle('on', on);
        // Sin aria-pressed: el nombre ya cambia ("Pausar" / "Reanudar"); con las dos cosas un lector de pantalla diria "Reanudar, activado".
        const label = on ? 'Reanudar el registro' : 'Pausar el registro';
        b.title = label; b.setAttribute('aria-label', label);
        b.innerHTML = (on ? ICON_PLAY : ICON_PAUSE) + `<span>${on ? 'Reanudar' : 'Pausar'}</span>`;
    }

    // Estado vacio de la caja: sin registros todavia, o ninguno coincide con el filtro o la busqueda.
    updateEmpty() {
        const shown = this.el.lines.childNodes.length > 0;
        this.el.box.dataset.state = shown ? 'ok' : (gameLog.lines.length ? 'nomatch' : 'none');
    }

    renderAll() {
        const frag = document.createDocumentFragment();
        // En pausa, cambiar el filtro o la busqueda redibuja SOLO lo que habia al pausar (las lineas nuevas esperan a reanudar).
        const last = gameLog.lines[gameLog.lines.length - 1];
        const extra = this.paused && last ? Math.max(0, last.n - this.pausedAt) : 0;
        let list = gameLog.view({ filter: this.filter, query: this.query, limit: MAX_DOM + extra });
        if (this.paused) list = list.filter(e => e.n <= this.pausedAt).slice(-MAX_DOM);
        for (const e of list) frag.appendChild(lineNode(e, { columns: true }));
        this.el.lines.replaceChildren(frag);
        this.el.lines.scrollTop = this.el.lines.scrollHeight;
        this.updateArrow();
        this.updateEmpty();
    }

    // Estado general: cabecera y boton segun la fase del juego.
    refresh() {
        const p = gameLog.phase;
        const idle = p.id === 'idle';
        const closed = p.id === 'closed';
        const opened = !!p.window && !closed;
        const failed = closed && gameLog.abnormal;
        const loading = !idle && !closed && !opened;
        this.root.dataset.error = failed ? '1' : '0';
        // Cancelar solo existe mientras la carga se puede detener (preparando, cargando o ya cancelando), nunca con el juego abierto.
        const sid = gameLog.state && gameLog.state.id;
        const cancelling = sid === 'cancelling';
        this.root.dataset.loading = !opened && (sid === 'preparing' || sid === 'loading' || cancelling) ? '1' : '0';
        this.el.cancel.disabled = cancelling;

        const pct = p.pct && !p.done ? ` (${p.pct}%)` : '';
        // Iconos dibujados (mismo trazo que el resto del launcher), no letras
        const ICON = {
            ok: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
            err: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l10 18H2z"/><path d="M12 10v5M12 18v.5"/></svg>',
            idle: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 7h14M5 12h14M5 17h9"/></svg>',
            busy: ''
        };
        const set = (cls, title, sub) => {
            this.el.badge.className = 'log-badge ' + cls;
            this.el.badge.innerHTML = ICON[cls];
            this.el.title.textContent = title;
            this.el.sub.textContent = sub;
        };
        if (loading) set('busy', 'Cargando Minecraft', p.label + pct);
        else if (opened) set('ok', 'Juego en marcha', 'Minecraft está abierto');
        else if (failed) set('err', 'El juego se cerró inesperadamente', this.lastLabel ? `Se cerró durante: ${this.lastLabel}` : p.label);
        else if (closed) set('ok', 'Juego cerrado', 'Aquí queda el registro de la última sesión');
        else set('idle', 'Registros del juego', gameLog.lines.length ? 'Registro de la última sesión' : 'Todavía no hay una sesión que mostrar');

        // El aviso de ayuda del cierre inesperado vive ahora en su propia franja (.log-alert); el pie solo da avisos de acciones.
        this.el.note.textContent = this.paused ? PAUSE_NOTE : '';
    }

    flash(text) {
        this.el.note.textContent = text;
        setTimeout(() => { if (this.el.note.textContent === text) this.refresh(); }, 5000);
    }

    async copy() {
        try {
            const text = await gameLog.fullText();
            clipboard.writeText(text);
            this.flash(`Copiadas ${text.split('\n').length - 1} líneas (sin tokens ni datos personales).`);
        } catch (e) { this.flash(`No se pudo copiar: ${e.message || e}`); }
    }

    async createFile() {
        this.el.create.disabled = true;
        try { this.flash(await createLogFile()); }
        catch (err) { this.flash(`No se pudo crear el informe: ${err.message || err}`); }
        this.el.create.disabled = false;
    }

    async openLogs() {
        try {
            const err = await openFolder((await currentLayout()).logsDir);
            if (err) this.flash('Todavía no hay carpeta de registros: abre el juego una vez.');
        } catch (e) { this.flash('Todavía no hay carpeta de registros: abre el juego una vez.'); }
    }
}

// Fondo: la misma imagen del campamento que Inicio, Noticias, Perfil y Ajustes (utils/backdrop.js; con FONDO_IMAGENES en false no hay imagen)
if (FONDO_IMAGENES) {
    try { initImageBackground(document.querySelector('.logwin'), { fixed: 'campamento' }); document.body.classList.add('has-scene'); }
    catch (e) { console.warn('fondo', e); }
}

new LogWindow();
