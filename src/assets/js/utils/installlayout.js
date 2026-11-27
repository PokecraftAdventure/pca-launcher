/**
 * Pokecraft Adventure Launcher
 *
 * Carpetas de la instalacion elegida por el jugador (ventanas).
 */
const { ipcRenderer } = require('electron');
const corePaths = require('./assets/js/core/paths.js');
import database from './database.js';

/** @returns {Promise<object>} el layout (core/paths.js) segun la carpeta guardada en la configuracion. */
export async function currentLayout() {
    const cc = await new database().readData('configClient');
    const appData = await ipcRenderer.invoke('appData');
    return corePaths.layout(corePaths.resolveInstallDir(appData, cc.launcher_config.install_dir));
}

/** Instalacion y cuenta en uso, para las horas jugadas. null si aun no se puede saber (primera ejecucion). */
export async function currentPlayer(db) {
    try {
        const { account_selected } = await db.readData('configClient');
        const account = await db.readData('accounts', account_selected);
        return { instanceDir: (await currentLayout()).instanceDir, name: account?.name };
    } catch (e) {
        return null;
    }
}
