/**
 * Pokecraft Adventure Launcher
 *
 * Ventana de arranque. Estados (data-state): search, download, installing, starting,
 * maintenance, error. Sin internet NO se cierra: se abre el launcher igual.
 * El mantenimiento remoto viene de status.json (core/remote.js).
 */

import { initBackground } from './utils/background.js';
import { FONDO_IMAGENES, initImageBackground } from './utils/backdrop.js';
import { openDiscord } from './utils/discord.js';

const { ipcRenderer } = require('electron');
const pkg = require('../package.json');
const { fetchStatus } = require('./assets/js/core/remote.js');


class Splash {
    constructor() {
        const q = s => document.querySelector(s);
        this.root = q('#splash');
        try { if (FONDO_IMAGENES) initImageBackground(this.root, { fixed: 'puerta' }); else initBackground(this.root, { still: true, focusX: 720 }); } catch (e) { console.warn('fondo', e); }
        this.el = { title: q('.title'), sub: q('.sub'), bar: q('.bar'), fill: q('.bar span'), pct: q('.pct'), action: q('.action'), closing: q('.closing'), ico: q('.state-ico') };
        q('.ver').textContent = `Versión ${pkg.version}`;
        document.addEventListener('DOMContentLoaded', () => {
            ipcRenderer.send('update-window-progress-load');
            this.start();
        });
    }

    // Cambia de estado y textos. progress: null = indeterminado, numero 0-1 = determinado.
    state(name, { title, sub = '', progress = null, pct = '', action = null, ico = '' } = {}) {
        this.root.dataset.state = name;
        this.el.title.textContent = title;
        this.el.sub.textContent = sub;
        this.el.ico.textContent = ico;
        this.el.pct.textContent = pct;
        this.el.bar.classList.toggle('indeterminate', progress == null);
        this.el.fill.style.width = progress == null ? '' : `${Math.round(progress * 100)}%`;
        this.el.action.classList.toggle('show', !!action);
        if (action) { this.el.action.textContent = action.label; this.el.action.onclick = action.run; }
    }

    async start() {
        this.registerEvents();
        this.state('search', { title: 'Buscando actualizaciones', sub: 'Un momento…' });
        // Sin canal de actualizaciones configurado (o sin red) se sigue adelante.
        ipcRenderer.invoke('update-app').catch(err => {
            console.warn('Sin comprobacion de actualizaciones:', err);
            return this.statusCheck();
        });
    }

    registerEvents() {
        ipcRenderer.on('updateAvailable', () => {
            this.downloading(0);
            ipcRenderer.send('start-update');
        });

        ipcRenderer.on('error', (event, err) => {
            if (err) { console.warn('Error de actualizacion:', err); return this.statusCheck(); }
        });

        ipcRenderer.on('download-progress', (event, p) => {
            ipcRenderer.send('update-window-progress', { progress: p.transferred, size: p.total });
            const ratio = p.total ? p.transferred / p.total : 0;
            if (ratio >= 0.999) this.state('installing', { title: 'Instalando actualización', sub: 'El launcher se reiniciará solo' });
            else this.downloading(ratio, `${Math.round(ratio * 100)} %`);
        });

        ipcRenderer.on('update-not-available', () => this.statusCheck());
    }

    downloading(progress, pct) {
        this.state('download', { title: 'Descargando actualización', sub: 'Hay una versión nueva del launcher', progress, pct });
    }

    // Mantenimiento remoto. Sin internet, sin URL o con respuesta rara: se abre el launcher igual.
    async statusCheck() {
        if (this.started) return;
        this.started = true;
        try {
            const st = await fetchStatus({ timeoutMs: 5000 });
            if (st && st.maintenance) return this.maintenance(st.message);
            this.startLauncher();
        } catch (e) {
            console.error(e);
            this.fail('Reinstálalo o avisa al staff en Discord.');
        }
    }

    maintenance(message) {
        this.state('maintenance', {
            title: 'Estamos en mantenimiento', ico: '🛠',
            sub: message || 'Volvemos en un rato. Entra a Discord para ver novedades.',
            action: { label: 'Ir a Discord', run: () => openDiscord() }
        });
        this.closeIn();
    }

    fail(text) {
        this.state('error', { title: 'No se pudo iniciar', sub: text, ico: '!', action: { label: 'Ir a Discord', run: () => openDiscord() } });
        this.closeIn();
    }

    startLauncher() {
        this.state('starting', { title: 'Iniciando el launcher', progress: 1 });
        ipcRenderer.send('main-window-open');
        ipcRenderer.send('update-window-close');
    }

    closeIn() {
        let i = 5;
        const tick = () => {
            this.el.closing.textContent = `Cerrando en ${i} s`;
            if (i-- <= 0) ipcRenderer.send('update-window-close');
        };
        tick();
        setInterval(tick, 1000);
    }
}

// Herramientas de desarrollo: solo al desarrollar (NODE_ENV=dev), nunca en el launcher final.
if (process.env.NODE_ENV === 'dev') {
    document.addEventListener("keydown", (e) => {
        if (e.ctrlKey && e.shiftKey && e.keyCode == 73 || e.keyCode == 123) {
            ipcRenderer.send("update-window-dev-tools");
        }
    })
}
new Splash();
