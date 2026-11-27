/**
 * Pokecraft Adventure Launcher
 *
 * Estadisticas del jugador: horas jugadas, ultima vez y primera vez. Se guardan en el directorio
 * de datos del launcher (por defecto <appData>/.pokecraftadventure/playstats.json), no en la carpeta
 * de instalacion, para que sobrevivan si el jugador la mueve.
 * Las horas son las del servidor cuando el mod de cliente ya las guardo en la instancia (config/pca_play_time.json,
 * una entrada por nombre de jugador); si no, las que ha contado el launcher.
 *   startSession(ts) al lanzar el juego, endSession(ts) al cerrarse, getStats(jugador) para mostrarlas.
 */
const fs = require('fs');
const path = require('path');
const datadir = require('./datadir');

const MAX_SESSION_MS = 7 * 24 * 3600 * 1000;   // una sesion "abierta" mas larga que esto se considera un cierre perdido

function file() {
    return path.join(datadir.dataDir(), 'playstats.json');
}

function load() {
    try {
        const d = JSON.parse(fs.readFileSync(file(), 'utf8'));
        return {
            totalMs: Number.isFinite(d.totalMs) && d.totalMs > 0 ? d.totalMs : 0,
            lastPlayed: Number.isFinite(d.lastPlayed) ? d.lastPlayed : null,
            firstPlayed: Number.isFinite(d.firstPlayed) ? d.firstPlayed : null,
            openSince: Number.isFinite(d.openSince) ? d.openSince : null
        };
    } catch (e) {
        return { totalMs: 0, lastPlayed: null, firstPlayed: null, openSince: null };
    }
}

function save(d) {
    const f = file();
    fs.mkdirSync(path.dirname(f), { recursive: true });
    const tmp = f + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(d, null, 2));
    fs.renameSync(tmp, f);
}

/** Empieza una sesion de juego. ts en milisegundos (Date.now()). */
function startSession(ts = Date.now()) {
    const d = load();
    d.openSince = ts;
    if (d.firstPlayed == null) d.firstPlayed = ts;
    save(d);
}

/** Termina la sesion y suma su duracion. Sin sesion abierta no suma nada. */
function endSession(ts = Date.now()) {
    const d = load();
    if (d.openSince != null) {
        const ms = ts - d.openSince;
        if (ms > 0 && ms <= MAX_SESSION_MS) d.totalMs += ms;
    }
    d.openSince = null;
    d.lastPlayed = ts;
    if (d.firstPlayed == null) d.firstPlayed = ts;
    save(d);
}

const TICKS_PER_HOUR = 20 * 3600;

/** Horas que registra el servidor para `name`, o null si todavia no han llegado a esta instancia. */
function serverHours({ instanceDir, name } = {}) {
    if (!instanceDir || !name) return null;
    try {
        const { players } = JSON.parse(fs.readFileSync(path.join(instanceDir, 'config', 'pca_play_time.json'), 'utf8'));
        const key = String(name).toLowerCase();
        const ticks = Object.hasOwn(players, key) ? players[key].ticks : null;
        return Number.isFinite(ticks) && ticks >= 0 ? ticks / TICKS_PER_HOUR : null;
    } catch (e) {
        return null;
    }
}

/**
 * @param {{instanceDir:string, name:string}} [player] instalacion y cuenta en uso
 * @returns {{hoursPlayed:number, lastPlayed:number|null, firstPlayed:number|null}} (hoursPlayed con un decimal)
 */
function getStats(player) {
    const d = load();
    const hours = serverHours(player) ?? d.totalMs / 3600000;
    return {
        hoursPlayed: Math.round(hours * 10) / 10,
        lastPlayed: d.lastPlayed,
        firstPlayed: d.firstPlayed
    };
}

module.exports = { startSession, endSession, getStats };
