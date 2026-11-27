/**
 * Pokecraft Adventure Launcher
 *
 * Pantalla de carga (anillo) mientras el juego abre: fase actual y las ultimas lineas del registro.
 * El registro completo (filtros, busqueda, copiar...) vive ahora en su propia ventana (src/log.html,
 * assets/js/log.js): "Ver registros completos" la abre. Los datos llegan del proceso principal por
 * core/gamelog-client.js.
 */
const { ipcRenderer } = require('electron');
const { gameLog } = require('./assets/js/core/gamelog-client.js');
import { lineNode } from '../utils/logline.js';

const PEEK = 5;                      // lineas en la vista anillo

class Console {
    static id = "console";

    async init() {
        this.root = document.querySelector('.panel.console');
        const q = s => this.root.querySelector(s);
        this.el = { peek: q('.load-peek'), loadSub: q('.load-sub') };
        this.pending = false;

        // Anillo -> registros: abre la ventana de registros y oculta el launcher (se vuelve con "Launcher" en esa ventana o desde la bandeja).
        q('.load-more').addEventListener('click', () => ipcRenderer.send('view:go', 'logs'));
        // Cancelar la carga (la logica vive en home.js: cancelGame()); mientras cancela el boton queda inactivo.
        const cancel = q('.load-cancel');
        cancel.addEventListener('click', () => { if (window.pcaHome) window.pcaHome.cancelGame(); });
        gameLog.on('state', s => { cancel.disabled = s.id === 'cancelling'; });

        gameLog.on('reset', () => this.refresh());
        gameLog.on('lines', () => this.schedule());
        gameLog.on('phase', () => this.refresh());
        window.addEventListener('panel-change', e => { if (e.detail === 'console') this.refresh(); });
        this.refresh();
    }

    // Las lineas nuevas se agrupan para no repintar por cada una (el juego escribe cientos por segundo).
    schedule() {
        if (this.pending) return;
        this.pending = true;
        requestAnimationFrame(() => { this.pending = false; this.updatePeek(); });
    }

    updatePeek() {
        const frag = document.createDocumentFragment();
        for (const e of gameLog.view({ limit: PEEK })) frag.appendChild(lineNode(e));
        this.el.peek.replaceChildren(frag);
    }

    refresh() {
        const p = gameLog.phase;
        const pct = p.pct && !p.done ? ` (${p.pct}%)` : '';
        this.el.loadSub.textContent = p.label + pct;
        this.updatePeek();
    }
}

export default Console;
