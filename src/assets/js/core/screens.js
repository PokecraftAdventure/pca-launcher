/**
 * Pokecraft Adventure Launcher
 *
 * Pantallas propias del juego (menu de FancyMenu, pantalla de arranque y pack "PCA Interface"). Van
 * dentro del launcher (src/assets/pantallas, copiadas con `npm run screens`) y la lista esta en
 * `manifest.screens`: { files: [{ path, size, sha256 }], pack: 'file/PCA Interface.zip' }.
 *  - Se comprueban por hash en cada JUGAR (y al reparar): lo que falte o este cambiado se vuelve a poner.
 *  - config/fancymenu sustituye ENTERA a la de Cobbleverse: la que hubiera se aparta a
 *    config/fancymenu.anterior (no se borra). Se imponen tambien si AutoModpack entrega las suyas.
 *  - Las imagenes del visor de carga (IMAGES_DIR) las entrega AutoModpack: el launcher solo las pone si la
 *    carpeta esta vacia; nunca las comprueba, reemplaza ni retira.
 *  - El pack es la identidad del servidor: en cada JUGAR se deja activo y arriba del todo.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const quality = require('./quality');
const { safeJoin, ensureDir } = require('./paths');
const { removeSync, copySync } = require('./fsx');

const SCREENS_DIR = path.join(__dirname, '..', '..', 'pantallas');
const MENU_DIR = 'config/fancymenu';
const IMAGES_DIR = 'config/fancymenu/slideshows/pokedex/images';

const sha256File = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const isImage = rel => rel.startsWith(IMAGES_DIR + '/');

/** Marca como excluidas las configs de Cobbleverse que ahora entrega el launcher con sus pantallas. Modifica `manifest`. */
function markReplaced(manifest) {
    if (!manifest.screens) return manifest;
    const own = new Set(manifest.screens.files.map(f => f.path));
    for (const c of manifest.configs) if (own.has(c.path) || c.path.startsWith(MENU_DIR + '/')) c.denied = true;
    return manifest;
}

const filesIn = dir => {
    try { return fs.readdirSync(dir, { recursive: true, withFileTypes: true }).filter(d => d.isFile()).map(d => path.join(d.parentPath || d.path, d.name)); }
    catch (e) { return []; }
};

/** Las copias de AutoModpack (una por servidor) de una carpeta de la instancia. */
function autoModpackCopies(inst, rel) {
    const modpacks = path.join(inst, 'automodpack', 'modpacks');
    try { return fs.readdirSync(modpacks).map(h => path.join(modpacks, h, ...rel.split('/'))); } catch (e) { return []; }
}

/** Aparta la carpeta de FancyMenu que hubiera (una vez) para que no queden pantallas ajenas mezcladas con las propias. */
function replaceMenuFolder(inst, state) {
    if (state.menuReplaced) return null;
    const dir = safeJoin(inst, MENU_DIR);
    let backup = null;
    if (fs.existsSync(dir)) {
        let n = 1;
        do { backup = dir + '.anterior' + (n > 1 ? '-' + n : ''); n++; } while (fs.existsSync(backup));
        try { fs.renameSync(dir, backup); } catch (e) { return null; }   // en uso: se intenta la proxima vez
        // Las imagenes que ya entrega AutoModpack siguen en su sitio.
        for (const copy of autoModpackCopies(inst, IMAGES_DIR)) {
            if (filesIn(copy).length) copySync(copy, safeJoin(inst, IMAGES_DIR));
        }
    }
    for (const rel of Object.keys(state.managed)) if (rel.startsWith(MENU_DIR + '/')) delete state.managed[rel];
    state.menuReplaced = true;
    return backup;
}

/** Los archivos de las pantallas que hay que (volver a) poner: faltan o no coinciden con su hash. */
function damagedScreens({ layout, manifest }) {
    if (!manifest.screens) return [];
    const inst = layout.instanceDir;
    const noImages = !filesIn(safeJoin(inst, IMAGES_DIR)).length;
    return manifest.screens.files.filter(f => {
        if (isImage(f.path)) return noImages;
        try { return sha256File(safeJoin(inst, f.path)) !== f.sha256; } catch (e) { return true; }   // falta o esta cambiado
    });
}

/**
 * Deja en la instancia las pantallas del launcher. Sin `manifest.screens` no hace nada.
 * @returns {string[]} rutas escritas
 */
function syncScreens({ layout, manifest, state }) {
    const screens = manifest.screens;
    if (!screens) return [];
    const sourceDir = screens.dir || SCREENS_DIR;                    // `dir` solo lo usan las pruebas
    const inst = layout.instanceDir;
    ensureDir(inst);
    replaceMenuFolder(inst, state);

    const written = [];
    for (const f of damagedScreens({ layout, manifest })) {
        const dest = safeJoin(inst, f.path);
        const data = fs.readFileSync(safeJoin(sourceDir, f.path));       // readFileSync: tambien lee dentro del app.asar
        ensureDir(path.dirname(dest));
        fs.writeFileSync(dest, data);
        written.push(f.path);
    }

    // Retira solo lo que entrego antes el launcher y ya no esta en la lista.
    const now = new Set(screens.files.map(f => f.path));
    const configs = new Set(manifest.configs.filter(c => !c.denied && c.kind === 'managed').map(c => c.path));
    for (const rel of new Set([...(state.screens || []), ...Object.keys(state.managed).filter(r => r.startsWith(MENU_DIR + '/'))])) {
        if (now.has(rel) || configs.has(rel) || isImage(rel)) continue;
        try { removeSync(safeJoin(inst, rel)); } catch (e) { continue; }
        delete state.managed[rel];
    }
    state.screens = [...now];
    return written;
}

/** El pack al final de la lista (en options.txt, el final es la maxima prioridad). */
const packOnTop = (list, pack) => (list[list.length - 1] === pack ? list : [...list.filter(p => p !== pack), pack]);

/**
 * Deja activo y arriba del todo el pack de las pantallas en options.txt. Se llama en cada JUGAR y al reparar.
 * Devuelve true si cambio options.txt.
 */
function ensureScreensPack(inst, manifest) {
    const pack = manifest.screens && manifest.screens.pack;
    const optionsFile = path.join(inst, 'options.txt');
    if (!pack || !fs.existsSync(optionsFile) || !fs.existsSync(safeJoin(inst, 'resourcepacks/' + pack.replace(/^file\//, '')))) return false;
    const before = fs.readFileSync(optionsFile, 'utf8');
    let list;
    try { list = quality.getPackList(before); } catch (e) { return false; }   // lista ilegible: no se toca
    if (!list.length) return false;
    const next = packOnTop(list, pack);
    if (next === list) return false;
    fs.writeFileSync(optionsFile, quality.setPackList(before, next));
    return true;
}

module.exports = { SCREENS_DIR, IMAGES_DIR, autoModpackCopies, markReplaced, syncScreens, damagedScreens, ensureScreensPack, packOnTop };
