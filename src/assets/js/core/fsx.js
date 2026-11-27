/**
 * Pokecraft Adventure Launcher
 *
 * Borrar y copiar carpetas SIN fs.rmSync ni fs.cpSync. En el Node de Electron 40 (24.11), con tildes u otros caracteres
 * no ASCII en la ruta: rmSync no borra nada y no avisa, y cpSync cierra el proceso. Afecta a nombres de archivo y a
 * usuarios de Windows con tilde (nombres con acentos). unlinkSync, rmdirSync y copyFileSync si funcionan.
 */
const fs = require('fs');
const path = require('path');

const lstat = p => { try { return fs.lstatSync(p); } catch (e) { if (e.code === 'ENOENT') return null; throw e; } };

/**
 * Borra un archivo o una carpeta con todo su contenido. Si no existe, no hace nada. Nunca sigue enlaces ni uniones:
 * quita el enlace y deja intacto a donde apunta. Lanza si algo no se puede borrar.
 */
function removeSync(target) {
    const st = lstat(target);
    if (!st) return;
    if (st.isDirectory()) {
        for (const name of fs.readdirSync(target)) removeSync(path.join(target, name));
        fs.rmdirSync(target);
        return;
    }
    try { fs.unlinkSync(target); } catch (e) {
        if (e.code === 'ENOENT') return;
        if (!st.isSymbolicLink()) throw e;
        fs.rmdirSync(target);            // union de carpeta en Windows
    }
}

/** Copia una carpeta (o un archivo) sin pisar nada fuera del destino. */
function copySync(from, to) {
    if (fs.statSync(from).isDirectory()) {
        fs.mkdirSync(to, { recursive: true });
        for (const name of fs.readdirSync(from)) copySync(path.join(from, name), path.join(to, name));
        return;
    }
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(from, to);
}

module.exports = { removeSync, copySync };
