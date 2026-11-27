/**
 * Cuadro de error para lo que IMPIDE jugar (hoy: no se pudo preparar el juego). Interrumpe a proposito:
 * no se puede pasar por alto. Los demas errores y resultados van en el aviso flotante (toast.js).
 *
 * showErrorDialog({ message, onRetry, onLog }). Esc o "Cerrar" lo quitan; el tabulador no sale del cuadro.
 * El texto se pone con textContent: un mensaje de error nunca se interpreta como HTML.
 */
let current = null;   // { onRetry, onLog, returnTo }

const el = () => document.querySelector('.pca-dialog');
const buttons = box => [...box.querySelectorAll('button:not(:disabled)')];

function closeErrorDialog() {
    const box = el();
    if (!box || box.hidden) return;
    box.hidden = true;
    const back = current && current.returnTo;
    current = null;
    if (back && back.isConnected) back.focus();
}

function onClick(e) {
    const action = e.target.closest && e.target.closest('button[data-action]');
    if (!action || !current) return;
    const { onRetry, onLog } = current;
    if (action.dataset.action === 'log') {
        action.disabled = true;                                   // crear el archivo tarda: sin dobles clics
        Promise.resolve(onLog && onLog()).finally(() => { action.disabled = false; });
        return;
    }
    closeErrorDialog();
    if (action.dataset.action === 'retry' && onRetry) onRetry();
}

function onKey(e) {
    if (e.key === 'Escape') { e.preventDefault(); return closeErrorDialog(); }
    if (e.key !== 'Tab') return;
    const list = buttons(el());
    if (!list.length) return;
    const i = list.indexOf(document.activeElement);
    e.preventDefault();
    list[(i + (e.shiftKey ? -1 : 1) + list.length) % list.length].focus();
}

export default function showErrorDialog({ message, onRetry, onLog }) {
    const box = el();
    if (!box) return;
    const returnTo = box.hidden ? document.activeElement : current && current.returnTo;
    current = { onRetry, onLog, returnTo };
    box.querySelector('.pca-dialog-message').textContent = message || '';
    if (!box.dataset.ready) {
        box.addEventListener('click', onClick);
        box.addEventListener('keydown', onKey);
        box.dataset.ready = '1';
    }
    box.hidden = false;
    box.querySelector('button[data-action="retry"]').focus();
}
