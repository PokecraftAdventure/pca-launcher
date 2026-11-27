/**
 * Pokecraft Adventure Launcher
 *
 * Estado del servidor junto a JUGAR: se vuelve a consultar cada cierto tiempo para no ensenar informacion vieja.
 *  - Solo mientras se puede ver (ventana a la vista y sin juego en curso): oculto no consume nada.
 *  - Al volver a verse, si el dato es viejo se ensena "Comprobando" hasta tener uno nuevo.
 *  - "Sin conexion" exige dos fallos seguidos: un corte suelto no se anuncia como caida.
 */

const INTERVAL_MS = 30000;
const LITE_INTERVAL_MS = 120000;
const RETRY_MS = 3000;

/**
 * @param {object} o
 *   check(target) -> Promise<boolean>   true si el servidor responde
 *   show(estado)                        'checking' | 'online' | 'offline'
 *   visible() -> boolean, lite() -> boolean
 *   now, setTimer, clearTimer, wait     sustituibles en las pruebas
 */
function createServerWatch({ check, show, visible = () => true, lite = () => false, now = Date.now,
    setTimer = setTimeout, clearTimer = clearTimeout, wait = ms => new Promise(r => setTimeout(r, ms)),
    intervalMs = INTERVAL_MS, liteIntervalMs = LITE_INTERVAL_MS, retryMs = RETRY_MS }) {
    let target = null, timer = null, running = null, generation = 0, checkedAt = 0;
    const every = () => (lite() ? liteIntervalMs : intervalMs);

    const ask = async t => { try { return (await check(t)) === true; } catch (e) { return false; } };

    function schedule() {
        clearTimer(timer);
        timer = null;
        if (target) timer = setTimer(() => refresh(), every());
    }

    /** Consulta ahora (si se puede ver). Una sola a la vez. */
    function refresh() {
        if (!target) return Promise.resolve();
        if (!visible()) { schedule(); return Promise.resolve(); }
        if (running) return running;
        const mine = generation, t = target;
        if (checkedAt && now() - checkedAt > every() + retryMs * 2) show('checking');   // el dato que se ve ya es viejo
        const job = (async () => {
            let up = await ask(t);
            if (!up && mine === generation) { await wait(retryMs); if (mine === generation) up = await ask(t); }
            if (mine !== generation) return;                 // cambio el servidor consultado: este resultado ya no vale
            checkedAt = now();
            show(up ? 'online' : 'offline');
        })().finally(() => { if (running === job) { running = null; schedule(); } });
        running = job;
        return job;
    }

    /** Servidor a vigilar ({ ip, port }); null = ninguno (se ensena sin conexion). */
    function setTarget(t) {
        generation++;
        target = t || null;
        running = null;
        checkedAt = 0;
        clearTimer(timer);
        if (!target) { show('offline'); return Promise.resolve(); }
        show('checking');
        return refresh();
    }

    return { setTarget, refresh };
}

module.exports = { createServerWatch };
