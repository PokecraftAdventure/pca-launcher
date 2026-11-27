/**
 * Aviso flotante unico del launcher (capa global, por encima de paneles, barras y vistas).
 * No ocupa sitio: no mueve nada de lo de alrededor.
 *
 * Usarlo solo para lo que el jugador NO ve ya en otra parte: un error, un resultado final o una razon
 * por la que un boton no hace nada. El avance de una tarea lo muestra la barra de abajo (beginTask):
 * no repetirlo aqui.
 *
 * toast(texto, kind = 'ok' | 'error', sticky = false). toast('') lo oculta.
 */
let timer = null;

export default function toast(text, kind = 'ok', sticky = false) {
    const el = document.querySelector('.pca-toast');
    if (!el) return;
    clearTimeout(timer);
    el.querySelector('.pca-toast-text').textContent = text || '';
    el.title = text || '';
    el.classList.toggle('error', kind === 'error');
    el.hidden = !text;
    if (text && !sticky) timer = setTimeout(() => { el.hidden = true; }, toastMs(text, kind));
}

// El tiempo en pantalla crece con el largo del texto (~18 caracteres por segundo de lectura mas un margen para verlo aparecer):
// un aviso corto sigue siendo breve y uno largo (una ruta, un error) no desaparece antes de poder leerlo.
function toastMs(text, kind = 'ok') {
    const base = kind === 'error' ? 6000 : 4000;
    return Math.min(15000, Math.max(5000, base + String(text || '').length * 55));
}

document.addEventListener('click', e => { if (e.target.closest && e.target.closest('.pca-toast')) toast(''); });
