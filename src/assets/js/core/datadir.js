/**
 * Pokecraft Adventure Launcher
 *
 * Directorio de datos propios del launcher (estadisticas, copia de noticias...). Por defecto
 * <appData>/.pokecraftadventure, fuera de la carpeta de instalacion para que sobreviva a moverla.
 */
const os = require('os');
const path = require('path');
const paths = require('./paths');

let override = null;

/** Para pruebas o para fijar otro directorio (null = por defecto). */
function configure(dir) {
    override = dir || null;
}

function dataDir() {
    if (override) return override;
    const appData = process.env.APPDATA || path.join(os.homedir(), '.config');
    return paths.defaultInstallDir(appData);
}

module.exports = { configure, dataDir };
