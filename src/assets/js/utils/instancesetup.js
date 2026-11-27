/**
 * Pokecraft Adventure Launcher
 * Prepara lo que depende de la carpeta de la instancia: la biblioteca de skins (core/skins.js) y el
 * registro anterior del juego (core/gamelog-client.js). Se llama al arrancar y cada vez que puede haber cambiado
 * la carpeta (abrir Perfil, mover la instalacion). Todo con try/catch: si algo falla, el launcher sigue.
 */
const path = require('path');
const { gameLog } = require('./assets/js/core/gamelog-client.js');
const skins = require('./assets/js/core/skins.js');
import { currentLayout } from './installlayout.js';

/** @returns {Promise<object|null>} el layout de la instalacion, o null si no se pudo leer. */
async function setupInstance() {
    try {
        let layout = null, instanceDir, logsDir;
        if (window.pcaInstanceDirOverride) {
            // Gancho de pruebas: permite apuntar a otra carpeta sin tocar la instalacion real.
            instanceDir = window.pcaInstanceDirOverride;
            logsDir = path.join(instanceDir, 'logs');
        } else {
            layout = await currentLayout();
            instanceDir = layout.instanceDir;
            logsDir = layout.logsDir;
        }
        skins.configure(instanceDir);
        try { await gameLog.setLogFile(path.join(logsDir, 'latest.log')); } catch (e) { console.warn('Registro anterior:', e); }
        return layout;
    } catch (e) {
        console.warn('Instancia:', e);
        return null;
    }
}

/** Pide a Mojang la skin de la cuenta (sin esperar; refreshMojang nunca falla). */
function refreshSkinFor(account) {
    if (account) skins.refreshMojang({ name: account.name, uuid: account.uuid });
}

export { setupInstance, refreshSkinFor };
