/**
 * Pokecraft Adventure Launcher
 * Abrir una carpeta del Explorador y traerla al PRIMER PLANO. Windows a veces la deja detras de otras ventanas o reutiliza una
 * ya abierta; despues de abrirla se pide activar la ventana cuyo titulo es el nombre de la carpeta (WScript AppActivate).
 * Es un ayuda "lo mejor posible": si falla, la carpeta queda abierta como antes.
 */
const { shell } = require('electron');
const path = require('path');
const { spawn } = require('child_process');

const ACTIVATE = "$s = New-Object -ComObject WScript.Shell; for ($i = 0; $i -lt 12; $i++) { if ($s.AppActivate($env:PCA_FOLDER_TITLE)) { break }; Start-Sleep -Milliseconds 250 }";

/** Trae al frente la ventana del Explorador que muestra `folder`. No espera ni lanza errores. */
function bringToFront(folder) {
    if (process.platform !== 'win32') return;
    const title = path.basename(folder) || folder;
    try {
        const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command', ACTIVATE], {
            env: { ...process.env, PCA_FOLDER_TITLE: title }, windowsHide: true, stdio: 'ignore', detached: true
        });
        child.on('error', () => {});
        child.unref();
    } catch (e) { /* sin primer plano: la carpeta ya esta abierta */ }
}

/** Abre una carpeta. Devuelve '' si salio bien o el texto del error (como shell.openPath). */
async function openFolder(folder) {
    const err = await shell.openPath(folder);
    if (!err) bringToFront(folder);
    return err;
}

/** Abre la carpeta que contiene el archivo, con el archivo seleccionado. */
function showFile(file) {
    shell.showItemInFolder(file);
    bringToFront(path.dirname(file));
}

module.exports = { openFolder, showFile };
