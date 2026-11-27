/**
 * Pokecraft Adventure Launcher
 *
 * Textos cortos para el jugador.
 */

/** Tamano legible: bytes, KB o MB segun el valor (5 KB ya no sale como "0.0 MB"). */
function formatSize(bytes) {
    const b = Math.max(0, Number(bytes) || 0);
    if (b < 1024) return `${b} bytes`;
    if (b < 1048576) return `${Math.max(1, Math.round(b / 1024))} KB`;
    return `${(b / 1048576).toFixed(1)} MB`;
}

module.exports = { formatSize };
