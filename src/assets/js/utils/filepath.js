/**
 * Pokecraft Adventure Launcher
 * Ruta real de un archivo elegido en un <input type="file">. Desde Electron 32 File.path ya no existe:
 * se usa webUtils.getPathForFile.
 */
const electron = require('electron');

function filePath(file) {
    if (!file) return '';
    try {
        if (electron.webUtils && electron.webUtils.getPathForFile) return electron.webUtils.getPathForFile(file) || '';
    } catch (e) { /* se prueba file.path */ }
    return file.path || '';
}

export { filePath };
