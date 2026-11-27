/**
 * Pokecraft Adventure Launcher
 *
 * Modo de rendimiento del launcher leido por el proceso PRINCIPAL antes de abrir ninguna ventana (T14).
 * `app.disableHardwareAcceleration()` solo vale antes de `app.whenReady()`, y el modo vive en la base de
 * datos del renderer (`configClient[ID 1].launcher_config.perfMode`, electron-store cifrado con
 * `<userData>/key.txt`), asi que aqui se abre esa misma base en solo lectura.
 * Cualquier fallo (primer arranque, clave ausente, archivo ilegible) devuelve "no ligero": el launcher
 * arranca como siempre. Misma regla que `utils/performance.js savedMode`.
 */
const fs = require('fs');
const path = require('path');

/**
 * @param {string} userDataDir carpeta userData de Electron
 * @param {boolean} dev modo desarrollo (la base no esta cifrada)
 * @returns {boolean} true si el modo efectivo es "ligero"
 */
function isLightMode(userDataDir, dev = false) {
    try {
        let encryptionKey;
        if (!dev) {
            const keyFile = path.join(userDataDir, 'key.txt');
            if (!fs.existsSync(keyFile)) return false;
            encryptionKey = fs.readFileSync(keyFile, 'utf-8');
        }
        if (!fs.existsSync(path.join(userDataDir, 'launcher-data.json'))) return false;
        const Store = require('electron-store');
        const store = new Store({ name: 'launcher-data', cwd: userDataDir, encryptionKey });
        const cc = (store.get('configClient', []) || []).find(i => i && i.ID === 1);
        const lc = (cc && cc.launcher_config) || {};
        return lc.perfMode === 'light';
    } catch (e) {
        return false;
    }
}

module.exports = { isLightMode };
