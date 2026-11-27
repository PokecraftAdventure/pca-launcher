/**
 * Pokecraft Adventure Launcher
 *
 * Escala comun de la interfaz segun el tamano de la ventana: en ventanas grandes crecen juntos textos, botones, tarjetas y
 * barras. Hasta 1280 x 720 no cambia nada (tampoco en el minimo ni en la tienda vertical: nunca encoge). Por encima crece
 * mas despacio que la ventana, para ganar legibilidad y tambien espacio.
 */
const BASE = { width: 1280, height: 720 };
const GROWTH = 0.6;     // de cada 1 que crece la ventana, 0,6 se convierte en tamano y el resto en espacio
const MAX = 2;
const STEP = 0.05;      // a saltos pequenos: arrastrar el borde no reajusta la interfaz en cada pixel

/** Factor para una ventana de `width` x `height` (pixeles independientes del dispositivo: ya incluyen la escala de Windows). */
function scaleFor(width, height) {
    const ratio = Math.min(width / BASE.width, height / BASE.height);
    if (!(ratio > 1)) return 1;
    const scale = Math.min(MAX, 1 + (ratio - 1) * GROWTH);
    return Math.round(Math.floor(scale / STEP + 1e-6) * STEP * 100) / 100;
}

module.exports = { scaleFor };
