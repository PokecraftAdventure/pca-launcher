/**
 * Botones que no se pueden usar ahora, CON su motivo: se ven apagados (aria-disabled) y al pulsarlos sale el aviso que
 * explica por que. No se usa `disabled`: un boton deshabilitado no recibe el clic y parece roto.
 * lock(selector, motivo)  ·  unlock(selector)
 */
import toast from './toast.js';

const reasons = new Map();   // selector -> motivo

function paint(selector, on) {
    document.querySelectorAll(selector).forEach(el => {
        if (on) el.setAttribute('aria-disabled', 'true'); else el.removeAttribute('aria-disabled');
    });
}

function lock(selector, reason) { reasons.set(selector, reason); paint(selector, true); }
function unlock(selector) { reasons.delete(selector); paint(selector, false); }

// En captura: llega antes que el manejador del boton y lo detiene.
document.addEventListener('click', e => {
    if (!e.target.closest) return;
    for (const [selector, reason] of reasons) {
        if (!e.target.closest(selector)) continue;
        e.preventDefault();
        e.stopImmediatePropagation();
        toast(reason, 'error');
        return;
    }
}, true);

export { lock, unlock };
