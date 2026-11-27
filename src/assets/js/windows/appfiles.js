/**
 * Pokecraft Adventure Launcher
 *
 * Archivos de la aplicacion que abren las ventanas. Se resuelven desde la carpeta de este archivo y no con el nombre
 * "src": en el instalador la carpeta se llama "app" (build.js).
 */
const path = require('path');

const ROOT = path.join(__dirname, '..', '..', '..');
const appFile = (...parts) => path.join(ROOT, ...parts);
const ICON = appFile('assets', 'images', 'icon', 'icon.ico');

module.exports = { appFile, ICON };
