/**
 * Pokecraft Adventure Launcher
 *
 * Ventana de registros del juego (T14.3). Solo hay una: si ya esta abierta se enfoca. Se DESTRUYE al
 * cerrarla (cero consumo cuando no se usa) y cerrarla no afecta al juego. Recuerda tamano y posicion en
 * <datos del launcher>/log-window.json. Carga src/log.html con la misma ventana sin marco que el launcher;
 * la aceleracion por hardware (modo ligero) es global de la aplicacion.
 */
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');
const { dataDir } = require('../core/datadir');
const { appFile, ICON } = require('./appfiles');

const DEFAULT = { width: 960, height: 640 };
const MIN = { width: 640, height: 400 };
let logWindow = null;

const boundsFile = () => path.join(dataDir(), 'log-window.json');

function readBounds() {
    try {
        const b = JSON.parse(fs.readFileSync(boundsFile(), 'utf8'));
        const ok = n => Number.isFinite(n);
        return ok(b.width) && ok(b.height) ? b : null;
    } catch (e) { return null; }
}

function saveBounds(win) {
    try {
        const b = win.getNormalBounds();
        fs.mkdirSync(path.dirname(boundsFile()), { recursive: true });
        fs.writeFileSync(boundsFile(), JSON.stringify({ x: b.x, y: b.y, width: b.width, height: b.height, maximized: win.isMaximized() }));
    } catch (e) { /* recordar la posicion es opcional */ }
}

/** La posicion guardada solo vale si sigue dentro de alguna pantalla (monitor desconectado, resolucion cambiada). */
function visible(b) {
    if (!Number.isFinite(b.x) || !Number.isFinite(b.y)) return false;
    const { screen } = require('electron');
    return screen.getAllDisplays().some(d => {
        const a = d.workArea;
        return b.x < a.x + a.width - 40 && b.x + b.width > a.x + 40 && b.y >= a.y - 10 && b.y < a.y + a.height - 40;
    });
}

function getWindow() {
    return logWindow && !logWindow.isDestroyed() ? logWindow : null;
}

/** Abre la ventana de registros o, si ya existe, la trae al frente (con `focus: false` no roba el foco). @returns {boolean} false si falta src/log.html */
function open({ focus = true } = {}) {
    const existing = getWindow();
    if (existing) {
        if (existing.isMinimized()) existing.restore();
        if (focus) { existing.show(); existing.focus(); }
        return true;
    }
    const page = appFile('log.html');
    if (!fs.existsSync(page)) return false;

    const saved = readBounds();
    const pos = saved && visible(saved) ? { x: saved.x, y: saved.y } : {};
    logWindow = new BrowserWindow({
        title: app.getName() + ' - Registros',
        width: saved ? saved.width : DEFAULT.width,
        height: saved ? saved.height : DEFAULT.height,
        ...pos,
        minWidth: MIN.width,
        minHeight: MIN.height,
        resizable: true,
        icon: ICON,
        frame: false,
        show: false,
        webPreferences: { contextIsolation: false, nodeIntegration: true }
    });
    const win = logWindow;
    win.setMenuBarVisibility(false);
    win.loadFile(page);
    win.once('ready-to-show', () => {
        if (win.isDestroyed()) return;
        if (saved && saved.maximized) win.maximize();
        if (focus) win.show();
        else win.showInactive();      // al abrirse el juego: los registros quedan a la vista sin quitarle el teclado al juego
    });
    win.on('close', () => saveBounds(win));
    win.on('closed', () => { if (logWindow === win) logWindow = null; });
    return true;
}

/** Cierra la ventana (al salir del launcher). */
function close() {
    const win = getWindow();
    if (win) win.close();
}

/** Controles de la barra de titulo propia (la ventana no tiene marco). */
function control(win, action) {
    if (!win || win.isDestroyed()) return;
    if (action === 'close') win.close();
    else if (action === 'minimize') win.minimize();
    else if (action === 'maximize') (win.isMaximized() ? win.unmaximize() : win.maximize());
}

module.exports = { open, close, getWindow, control };
