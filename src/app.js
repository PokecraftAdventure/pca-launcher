const { app, ipcMain, dialog, BrowserWindow } = require('electron');
const { Microsoft } = require('minecraft-java-core');
const { autoUpdater } = require('electron-updater')

const path = require('path');
const fs = require('fs');
const Store = require('electron-store');

const UpdateWindow = require("./assets/js/windows/updateWindow.js");
const MainWindow = require("./assets/js/windows/mainWindow.js");
const LogWindow = require("./assets/js/windows/logWindow.js");
const Views = require("./assets/js/windows/views.js").createViews(MainWindow, LogWindow);
const { Session } = require("./assets/js/core/session.js");

let dev = process.env.NODE_ENV === 'dev';

if (dev) {
    let appPath = path.resolve('./data/Launcher').replace(/\\/g, '/');
    let appdata = path.resolve('./data').replace(/\\/g, '/');
    if (!fs.existsSync(appPath)) fs.mkdirSync(appPath, { recursive: true });
    if (!fs.existsSync(appdata)) fs.mkdirSync(appdata, { recursive: true });
    app.setPath('userData', appPath);
    app.setPath('appData', appdata)
}
// Mismo identificador que usa el instalador (build.js): asi Windows une la ventana con su acceso directo.
else app.setAppUserModelId(require('../package.json').appId);

Store.initRenderer();

// T14: modo ligero = sin aceleracion por hardware y con V8 en modo ligero (menos memoria). Ambas cosas deben decidirse
// antes de app.whenReady(), asi que se lee aqui el modo guardado. Cambiarlo en Ajustes exige reiniciar ('perf-needs-restart').
// PCA_FORCE_FULL=1 fuerza el arranque completo (por si algun equipo va peor sin GPU).
const lightStart = require('./assets/js/core/perfmode.js').isLightMode(app.getPath('userData'), dev) && process.env.PCA_FORCE_FULL !== '1';
if (lightStart) {
    app.disableHardwareAcceleration();
    app.commandLine.appendSwitch('js-flags', '--lite-mode');
}
// El renderer pregunta si el modo elegido necesita reiniciar y puede pedir el reinicio.
ipcMain.handle('perf-needs-restart', (e, mode) => (mode === 'light') !== lightStart);
ipcMain.on('app-relaunch', () => { app.relaunch(); MainWindow.destroyWindow(); });

if (!app.requestSingleInstanceLock()) app.quit();
else app.whenReady().then(() => {
    if (dev) return MainWindow.createWindow()
    UpdateWindow.createWindow()
});

ipcMain.on('main-window-open', () => MainWindow.createWindow())
ipcMain.on('main-window-dev-tools', () => MainWindow.getWindow().webContents.openDevTools({ mode: 'detach' }))
ipcMain.on('main-window-dev-tools-close', () => MainWindow.getWindow().webContents.closeDevTools())
// La X: cierra del todo si no hay juego ni descarga de cartas; si los hay, va a la bandeja.
ipcMain.on('main-window-close', () => MainWindow.requestClose())
// Descarga de cartas del renderer: { tcg: boolean }. El estado del juego lo da la sesion (mas abajo).
ipcMain.on('launcher:state', (event, st) => MainWindow.setState(st))

// ---- Sesion de juego (T14.3): el juego se lanza y se controla aqui; las ventanas son solo vistas ----
const windowsAlive = () => [MainWindow.getWindow(), LogWindow.getWindow()].filter(w => w && !w.isDestroyed());
const GAME_FLAG = { preparing: 'loading', loading: 'loading', running: 'running', cancelling: 'loading' };
const session = new Session({
    emit: (channel, payload) => { for (const w of windowsAlive()) w.webContents.send(channel, payload); },
    hooks: {
        onState: id => MainWindow.setGame(GAME_FLAG[id]),
        // Cierre normal o cancelado: vuelve el launcher y se cierran los registros. Cierre por error: solo los registros con el error.
        onClosed: info => {
            const cancelled = cancelRequested || !!(info && info.cancelled);
            cancelRequested = false;
            Views.gameClosed({ abnormal: !!(info && info.abnormal), cancelled });
        },
        taskbar: value => MainWindow.setProgress(value),
        // "Durante el juego" (Ajustes): Launcher | Registros | Ocultar todo, aplicado al abrirse el juego
        gameOpened: mode => Views.applyDuringGame(mode)
    }
});
let cancelRequested = false;
ipcMain.handle('game:start', (event, opts) => session.start(opts))
// Cancelar la carga (preparando, comprobando archivos o abriendo): solo hasta que se abre la ventana del juego.
// Se puede pedir desde el anillo, la ventana de registros o la bandeja.
const cancelLoad = () => { const r = session.cancel(); if (r && r.ok) cancelRequested = true; return r; };
ipcMain.handle('game:cancel', () => cancelLoad())
// Cambio de pantalla: 'launcher' | 'logs' | 'hidden' (siempre una sola a la vez; ver windows/views.js)
ipcMain.on('view:go', (event, view) => { if (['launcher', 'logs', 'hidden'].includes(view)) Views.go(view); })
MainWindow.setTrayActions({ launcher: () => Views.go('launcher'), logs: () => Views.go('logs'), cancel: () => cancelLoad() })
ipcMain.handle('game:snapshot', (event, opts) => session.snapshot(opts))
ipcMain.handle('game:log-text', () => session.gameLog.toText())
ipcMain.handle('game:load-last', () => session.gameLog.loadLast())
ipcMain.handle('game:set-log-file', (event, file) => { session.gameLog.setLogFile(file); return session.gameLog.hasLast() })
// Ventana de registros: una sola, se destruye al cerrarla y cerrarla no afecta al juego.
ipcMain.on('log-window:control', (event, action) => LogWindow.control(BrowserWindow.fromWebContents(event.sender), action))

// Segundo clic en el acceso directo: mostrar la ventana que ya existe, nunca abrir otra.
app.on('second-instance', () => {
    const main = MainWindow.getWindow();
    if ((main && !main.isDestroyed()) || MainWindow.isParked()) return Views.go('launcher');
    const win = UpdateWindow.getWindow();
    if (!win || win.isDestroyed()) return;
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
})
ipcMain.on('main-window-minimize', () => MainWindow.getWindow().minimize())

ipcMain.on('update-window-close', () => UpdateWindow.destroyWindow())
ipcMain.on('update-window-dev-tools', () => UpdateWindow.getWindow().webContents.openDevTools({ mode: 'detach' }))
ipcMain.on('update-window-progress', (event, options) => UpdateWindow.getWindow().setProgressBar(options.progress / options.size))
ipcMain.on('update-window-progress-load', () => UpdateWindow.getWindow().setProgressBar(2))

ipcMain.handle('path-user-data', () => app.getPath('userData'))
ipcMain.handle('appData', () => app.getPath('appData'))

ipcMain.on('main-window-maximize', () => {
    if (MainWindow.getWindow().isMaximized()) {
        MainWindow.getWindow().unmaximize();
    } else {
        MainWindow.getWindow().maximize();
    }
})

ipcMain.handle('Microsoft-window', async (_, client_id) => {
    return await new Microsoft(client_id).getAuth();
})

// Con juego o descarga en curso la ventana solo se oculta, pero por si llegara a cerrarse no salimos (ver views.allClosed).
app.on('window-all-closed', () => Views.allClosed(() => app.quit()));
// Al salir del launcher se cierra tambien la ventana de registros.
app.on('before-quit', () => LogWindow.close());

autoUpdater.autoDownload = false;

// Actualizaciones desde los Releases de GitHub (se configura en launcher.config.json -> updates.github).
const updates = (require('./launcher.config.json').updates || {}).github || {};
const updatesConfigured = !!(updates.owner && updates.repo);
if (updatesConfigured) autoUpdater.setFeedURL({ provider: 'github', owner: updates.owner, repo: updates.repo });

ipcMain.handle('gpu-info', async () => {
    try {
        const info = await app.getGPUInfo('basic');
        return (info.gpuDevice || []).map(g => ({ vendorId: g.vendorId, deviceId: g.deviceId, active: !!g.active }));
    } catch (e) { return []; }
});

ipcMain.handle('desktop-path', () => app.getPath('desktop'));

ipcMain.handle('select-folder', async () => {
    const win = MainWindow.getWindow();
    const res = await dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory'] });
    return res.canceled ? null : res.filePaths[0];
});

// Sin red la comprobacion puede quedarse esperando: a los 8 s se sigue como si no hubiera actualizacion.
const UPDATE_CHECK_TIMEOUT_MS = 8000;
let updateCheckTimedOut = false;

// Si falla (sin canal, sin red o sin respuesta a tiempo) lanza y la ventana de arranque sigue adelante; si responde, avisan los eventos.
ipcMain.handle('update-app', async () => {
    // Sin instalar (desarrollo) electron-updater no avisa de nada y la ventana de arranque se quedaria esperando.
    if (!updatesConfigured || !app.isPackaged) throw new Error('Actualizaciones sin configurar o launcher sin instalar');
    updateCheckTimedOut = false;
    let timer;
    const limit = new Promise((_, reject) => {
        timer = setTimeout(() => { updateCheckTimedOut = true; reject(new Error('Sin respuesta al buscar actualizaciones')); }, UPDATE_CHECK_TIMEOUT_MS);
    });
    try { await Promise.race([autoUpdater.checkForUpdates(), limit]); } finally { clearTimeout(timer); }
})

// Avisos del actualizador a la ventana de arranque. Los que lleguen despues del limite de tiempo se ignoran.
const toUpdateWindow = (channel, payload) => {
    const win = UpdateWindow.getWindow();
    if (win && !updateCheckTimedOut) win.webContents.send(channel, payload);
};
autoUpdater.on('update-available', () => toUpdateWindow('updateAvailable'));
autoUpdater.on('update-not-available', () => toUpdateWindow('update-not-available'));
autoUpdater.on('download-progress', progress => toUpdateWindow('download-progress', progress));
autoUpdater.on('error', err => toUpdateWindow('error', err));
autoUpdater.on('update-downloaded', () => autoUpdater.quitAndInstall());
ipcMain.on('start-update', () => autoUpdater.downloadUpdate())
