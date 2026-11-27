/**
 * Pokecraft Adventure Launcher
 * "Crear informe para soporte": lo usan Ajustes, la barra inferior, el cuadro de error y los registros.
 * Solo se ejecuta cuando el jugador lo pide; no envia nada por si mismo.
 */
const { ipcRenderer } = require('electron');
const qualityCore = require('./assets/js/core/quality.js');
const { buildLogZip } = require('./assets/js/core/logzip.js');
const { formatSize } = require('./assets/js/core/format.js');
const { showFile } = require('./assets/js/utils/openfolder.js');
const pcaManifest = require('./assets-manifest.json');
const pcaPkg = require('../package.json');
import database from './database.js';
import { currentLayout } from './installlayout.js';

/** Devuelve un texto para el jugador con el resultado. Lanza si falla. `prepareError`: fallo al preparar el juego, se incluye. */
async function createLogFile(prepareError) {
    const cc = await new database().readData('configClient');
    const res = await buildLogZip({
        prepareError,
        layout: await currentLayout(),
        outDir: await ipcRenderer.invoke('desktop-path'),
        info: {
            'Launcher': pcaPkg.version,
            'Cobbleverse': pcaManifest.cobbleverse.version,
            'Calidad': cc.launcher_config.quality || qualityCore.DEFAULT_QUALITY,
            'Memoria máx': `${cc.java_config.java_memory.max} GB`
        }
    });
    showFile(res.path);
    return `Informe creado en tu Escritorio (${formatSize(res.bytes)}). Adjúntalo en tu ticket de Discord. ` +
        (res.hasCrash ? 'Incluye el informe del fallo. ' : '') + (res.truncated ? 'El registro se recortó para que quepa en Discord.' : '');
}

export { createLogFile };
