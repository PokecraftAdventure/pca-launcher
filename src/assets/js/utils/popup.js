/** Ventana de espera "Iniciando sesion" (sin botones). Los errores van en toast.js y errordialog.js. */
const q = s => document.querySelector(s);

/** @param {{title:string, content:string, background?:boolean}} info `background: false` = sin oscurecer lo de detras */
export function openPopup({ title, content, background = true }) {
    q('.popup').style.display = 'flex';
    q('.popup').style.background = background ? 'rgba(5, 4, 12, 0.72)' : 'none';
    q('.popup-title').textContent = title;
    q('.popup-content').textContent = content;
}

export function closePopup() {
    q('.popup').style.display = 'none';
}
