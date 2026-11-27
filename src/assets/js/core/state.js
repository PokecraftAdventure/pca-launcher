/**
 * Pokecraft Adventure Launcher
 *
 * Estado propio del launcher dentro de la carpeta de instalacion. Sirve para
 * saber que archivos gestiona (y por tanto cuales puede retirar), que configs
 * ya escribio una vez y que calidad aplico.
 */
const fs = require('fs');
const path = require('path');

const EMPTY = () => ({
    version: 1,
    owned: {},          // archivos de packs/shaders que gestiona el launcher
    seeded: {},         // configs escritas una vez (no se vuelven a escribir)
    managed: {},        // configs gestionadas: crc32 de la version aplicada
    screens: [],        // pantallas del juego entregadas (para retirar las que sobren)
    menuReplaced: false,// config/fancymenu ya es la del launcher
    files: {},          // opciones iniciales ya escritas (options.txt, servers.dat...)
    quality: null,      // ultima calidad aplicada
    tcg: {}             // por slug: { done, added }
});

function load(stateFile) {
    try {
        return Object.assign(EMPTY(), JSON.parse(fs.readFileSync(stateFile, 'utf8')));
    } catch (e) {
        return EMPTY();
    }
}

function save(stateFile, state) {
    fs.mkdirSync(path.dirname(stateFile), { recursive: true });
    const tmp = stateFile + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
    fs.renameSync(tmp, stateFile);
}

module.exports = { load, save, EMPTY };
