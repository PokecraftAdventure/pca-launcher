/**
 * Pokecraft Adventure Launcher
 * Estado de la ventana segun el proceso principal. NO se usa visibilitychange ni document.hidden:
 * tras ocultar y volver a mostrar la ventana quedan en "hidden" aunque se vea. La fuente fiable son
 * los eventos launcher:hidden y launcher:shown.
 */
const { ipcRenderer } = require('electron');

let hidden = false;
const subs = new Set();

function set(value) {
    hidden = value;
    for (const fn of subs) { try { fn(hidden); } catch (e) { console.warn('windowstate:', e); } }
}

try {
    ipcRenderer.on('launcher:hidden', () => set(true));
    ipcRenderer.on('launcher:shown', () => set(false));
} catch (e) { /* sin IPC: se asume visible */ }

/** true mientras la ventana esta oculta en la bandeja. */
const isHidden = () => hidden;

/** Suscribe una funcion (hidden:boolean) a los cambios. Devuelve la funcion para cancelar. */
function onHiddenChange(fn) {
    subs.add(fn);
    return () => subs.delete(fn);
}

export { isHidden, onHiddenChange };
