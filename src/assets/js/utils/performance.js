/**
 * Pokecraft Adventure Launcher
 * Rendimiento del launcher: "full" (completo) o "light" (ligero: sin animaciones, sin desenfoque, personaje 3D
 * en un solo fotograma, sondeos mas espaciados y escena de fondo mas pequena). Se aplica al instante.
 *  - body.lite: el CSS apaga animaciones, transiciones y desenfoques (launcher.css).
 *  - window.pcaLite: lo leen el visor 3D y los sondeos.
 *  - evento "perf-change" ({ detail: { lite } }): lo escuchan los visores 3D.
 */
const GB = 1073741824;

/** Modo recomendado segun la RAM del equipo: 8 GB o menos -> ligero. */
export function recommendedMode(totalMemBytes) {
    return totalMemBytes / GB <= 8 ? 'light' : 'full';
}

/** Modo guardado ('full' si no se ha elegido). */
export function savedMode(launcherConfig) {
    return launcherConfig?.perfMode === 'light' ? 'light' : 'full';
}

export function setPerformance(mode) {
    const lite = mode === 'light';
    window.pcaLite = lite;
    document.body.classList.toggle('lite', lite);
    try { window.pcaBackground?.setLite(lite); } catch (e) { /* sin fondo */ }
    window.dispatchEvent(new CustomEvent('perf-change', { detail: { lite } }));
}
