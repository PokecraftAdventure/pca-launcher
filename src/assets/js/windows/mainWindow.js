/**
 * Ventana principal y ciclo de vida (Pokecraft Adventure):
 * - La X cierra del todo si no hay juego, descarga de cartas ni tarea de mantenimiento; si los hay, la ventana se
 *   OCULTA (las cartas y el mantenimiento corren dentro de ella) y queda un icono en la bandeja.
 * - Al cerrarse el juego la sesion (core/session.js) llama a gameClosed() y la ventana vuelve a mostrarse.
 */

const { app, BrowserWindow, Menu, Tray, dialog, nativeImage } = require("electron");
const { scaleFor } = require("../core/uiscale");
const { appFile, ICON } = require("./appfiles");
let dev = process.env.DEV_TOOL === 'open';
let mainWindow = undefined;
let tray = null;
let quitting = false;
let hiddenByClose = false;   // oculta porque el jugador pulso la X (no porque el juego se abrio)
let parked = false;          // ventana destruida a proposito mientras se juega (parkWindow); vuelve con showWindow
let state = { game: 'idle', tcg: false, task: false };   // task: el renderer esta moviendo o reparando la instalacion

function getWindow() {
    return mainWindow;
}

/** true si hay juego en curso, descarga de cartas o una tarea de mantenimiento (mover / reparar). */
function isBusy() {
    return state.game !== 'idle' || !!state.tcg || !!state.task;
}

function send(channel) {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel);
}

function destroyTray() {
    if (tray) { tray.destroy(); tray = null; }
}

// Acciones de la bandeja que dependen de otras ventanas (las pone app.js): abrir el launcher, ver registros, cancelar la carga.
let trayActions = {};
function setTrayActions(actions) { trayActions = actions || {}; refreshTrayMenu(); }

function trayMenu() {
    const items = [{ label: 'Abrir launcher', click: () => (trayActions.launcher || showWindow)() }];
    if (trayActions.logs) items.push({ label: 'Ver registros', click: () => trayActions.logs() });
    // Solo mientras el juego carga (despues ya no se puede cancelar: se cierra como siempre).
    if (trayActions.cancel && state.game === 'loading') items.push({ label: 'Cancelar carga', click: () => trayActions.cancel() });
    items.push({ type: 'separator' }, { label: 'Salir', click: () => quitFromTray() });
    return Menu.buildFromTemplate(items);
}

function refreshTrayMenu() {
    if (tray) tray.setContextMenu(trayMenu());
}

function ensureTray() {
    if (tray) return;
    tray = new Tray(nativeImage.createFromPath(ICON));
    tray.setToolTip(app.getName());
    tray.setContextMenu(trayMenu());
    tray.on('click', () => (trayActions.launcher || showWindow)());
}

/** Oculta la ventana (sin destruirla) y avisa al renderer para que pause sus temporizadores. */
function hideWindow(byClose = false) {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    hiddenByClose = byClose || hiddenByClose;
    ensureTray();
    mainWindow.hide();
    send('launcher:hidden');
}

/**
 * Mientras se juega (modo ligero + "ocultar launcher"): destruye la ventana para liberar su memoria; queda el icono de
 * la bandeja. La sesion de juego vive en el proceso principal, asi que el juego y el registro no se enteran. Con una
 * descarga de cartas en curso (corre dentro de la ventana) solo se oculta. showWindow() la vuelve a crear.
 */
function parkWindow() {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (state.tcg || state.task) return hideWindow();
    ensureTray();
    parked = true;
    const win = mainWindow;
    mainWindow = undefined;
    win.destroy();
}

/** Muestra el launcher. `focus: false` (al abrirse el juego) lo deja a la vista sin quitarle el teclado al juego. */
function showWindow({ focus = true } = {}) {
    if (!mainWindow || mainWindow.isDestroyed()) {
        if (!parked) return;
        destroyTray();
        return createWindow();
    }
    hiddenByClose = false;
    if (mainWindow.isMinimized()) mainWindow.restore();
    if (focus) { mainWindow.show(); mainWindow.focus(); }
    else if (!mainWindow.isVisible()) mainWindow.showInactive();
    destroyTray();
    send('launcher:shown');
}

/** 'idle' | 'loading' | 'running': lo que usa el cambio de pantalla (windows/views.js) para saber si hay juego en curso. */
function gameState() {
    return state.game;
}

function quitApp() {
    quitting = true;
    destroyTray();
    app.quit();
}

function quitFromTray() {
    if (isBusy()) {
        const parent = mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible() ? mainWindow : undefined;
        const what = state.game !== 'idle' ? 'El juego seguirá abierto, pero el launcher no volverá a aparecer al cerrarlo.'
            : state.task ? 'Se está moviendo o reparando la instalación. Si sales ahora, podría quedar a medias y tendrás que repararla.'
            : 'La descarga de cartas se detendrá y continuará la próxima vez que abras el launcher.';
        const choice = dialog.showMessageBoxSync(parent, {
            type: 'question',
            buttons: ['Salir', 'Cancelar'],
            defaultId: 1,
            cancelId: 1,
            title: app.getName(),
            message: '¿Salir del launcher?',
            detail: what
        });
        if (choice !== 0) return;
    }
    quitApp();
}

/** La X de la ventana (y Ctrl+W): sin juego ni descarga cierra todo; si no, va a la bandeja. */
function requestClose() {
    if (!mainWindow || mainWindow.isDestroyed()) return quitApp();
    if (isBusy()) hideWindow(true);
    else quitApp();
}

function update(patch) {
    const prev = state;
    state = { ...state, ...patch };
    if (quitting) return;
    if (prev.game !== state.game) refreshTrayMenu();     // "Cancelar carga" solo existe mientras carga
    // El juego dejo de estar en curso sin pasar por gameClosed() (la preparacion fallo, se cancelo el
    // lanzamiento...): el launcher reaparece para que el jugador vea que paso, nunca se cierra solo.
    const gameEnded = prev.game !== 'idle' && state.game === 'idle';
    const visible = mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible();
    if (gameEnded && (hiddenByClose || !visible)) return showWindow();
    // Solo la descarga de cartas termino y el jugador ya habia cerrado la ventana: no hay motivo para seguir abierto.
    if (hiddenByClose && !isBusy()) quitApp();
}

/** El renderer informa de la descarga de cartas ({ tcg }). El estado del juego lo da la sesion (setGame). */
function setState(next) {
    update({ tcg: !!(next && next.tcg), task: !!(next && next.task) });
}

/** La sesion de juego (core/session.js) informa: 'idle' | 'loading' (preparando o cargando) | 'running'. */
function setGame(game) {
    update({ game: ['loading', 'running'].includes(game) ? game : 'idle' });
}

/** Barra de progreso de la barra de tareas: 0..1, 2 = indeterminada, -1 = quitarla. */
function setProgress(value) {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.setProgressBar(value);
}

/** El juego se cerro. Por defecto el launcher reaparece; `show: false` deja que decida el cambio de pantalla (views.js). */
function gameClosed({ show = true } = {}) {
    state.game = 'idle';
    if (show) showWindow();
}

function destroyWindow() {
    if (!mainWindow) return;
    quitApp();
    mainWindow = undefined;
}

/** Escala comun de la interfaz segun el tamano de la ventana (core/uiscale.js). */
function applyScale(win) {
    if (!win || win.isDestroyed() || win.isMinimized()) return;
    const [width, height] = win.getContentSize();
    const scale = scaleFor(width, height);
    if (Math.abs(win.webContents.getZoomFactor() - scale) > 0.001) win.webContents.setZoomFactor(scale);
}

function createWindow() {
    destroyWindow();
    quitting = false;
    parked = false;
    hiddenByClose = false;
    mainWindow = new BrowserWindow({
        title: app.getName(),
        width: 1280,
        height: 720,
        minWidth: 980,
        minHeight: 552,
        resizable: true,
        icon: ICON,
        frame: false,
        show: false,
        webPreferences: {
            contextIsolation: false,
            nodeIntegration: true
        },
    });
    Menu.setApplicationMenu(null);
    mainWindow.setMenuBarVisibility(false);
    mainWindow.loadFile(appFile('launcher.html'));
    const win = mainWindow;
    for (const ev of ['resize', 'maximize', 'unmaximize', 'restore', 'show']) win.on(ev, () => applyScale(win));
    win.webContents.on('did-finish-load', () => applyScale(win));     // cada carga vuelve a 1
    mainWindow.once('ready-to-show', () => {
        if (mainWindow) {
            if (dev) mainWindow.webContents.openDevTools({ mode: 'detach' })
            mainWindow.show()
        }
    });
    // Minimizar cuenta como oculto (T14): el renderer pausa 3D, fondo y sondeo igual que en la bandeja.
    mainWindow.on('minimize', () => send('launcher:hidden'));
    mainWindow.on('restore', () => send('launcher:shown'));
    // Cierre por otras vias (Alt+F4, barra de tareas): misma regla que la X.
    mainWindow.on('close', e => {
        if (quitting || !isBusy()) return;
        e.preventDefault();
        hideWindow(true);
    });
}

// Tienda oficial dentro del launcher (pestana "Tienda"): ver storeView.js
require('./storeView').register(getWindow);

module.exports = {
    getWindow,
    createWindow,
    destroyWindow,
    requestClose,
    setState,
    setGame,
    setProgress,
    gameClosed,
    hideWindow,
    parkWindow,
    showWindow,
    isParked: () => parked,
    gameState,
    setTrayActions,
    isBusy,
    isQuitting: () => quitting
};
