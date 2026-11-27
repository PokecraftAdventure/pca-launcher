/**
 * Pokecraft Adventure Launcher
 *
 * Que pantalla se ve mientras se carga y se juega: el launcher (anillo o Inicio) o los registros, nunca las dos, o ninguna
 * ("Ocultar todo": solo queda el icono de la bandeja). Todos los caminos pasan por aqui: los botones "Ver registros" y
 * "Launcher", la bandeja y el ajuste "Durante el juego" que se aplica al abrirse el juego.
 *
 * - Con el juego cargando el launcher solo se OCULTA (ahi corren el anillo y la descarga de cartas); con el juego abierto
 *   se destruye su ventana para ahorrar memoria (parkWindow ya cae a ocultar si hay cartas o mantenimiento en curso).
 * - Sin juego (los registros de la ultima sesion) "Ver registros" no oculta el launcher.
 * - Cerrar con la X la ventana que se ve = Ocultar todo.
 *
 * Las ventanas se reciben de fuera (app.js) para poder probar las reglas sin Electron.
 */
function createViews(MainWindow, LogWindow) {
    /** El juego carga o esta abierto (la sesion de juego lo informa a MainWindow). */
    function playing() {
        return MainWindow.gameState() !== 'idle';
    }

    /** Oculta el launcher: ventana oculta al cargar, destruida con el juego ya abierto. */
    function putLauncherAway() {
        if (MainWindow.gameState() === 'running') MainWindow.parkWindow();
        else MainWindow.hideWindow();
    }

    /**
     * @param {'launcher'|'logs'|'hidden'} view
     * @param {{focus?: boolean}} opts focus false = no quitar el teclado al juego (al abrirse el juego)
     */
    function go(view, { focus = true } = {}) {
        if (view === 'launcher') {
            MainWindow.showWindow({ focus });      // primero el launcher y luego se cierran los registros: nunca queda "nada" a medias
            LogWindow.close();
        } else if (view === 'logs') {
            LogWindow.open({ focus });
            if (playing()) putLauncherAway();      // primero los registros y luego se oculta el launcher: nunca queda "nada" a medias
        } else if (view === 'hidden') {
            LogWindow.close();
            putLauncherAway();
        }
    }

    /**
     * El juego se cerro. Cierre normal (o cancelado): vuelve el launcher en Inicio y se cierran los registros.
     * Cierre por error: solo los registros, con la pantalla del error; desde ahi el jugador vuelve al launcher con "Launcher".
     */
    function gameClosed({ abnormal = false, cancelled = false } = {}) {
        const failed = abnormal && !cancelled;
        MainWindow.gameClosed({ show: false });
        if (failed) {
            LogWindow.open({ focus: true });
            MainWindow.hideWindow();               // si el launcher estaba a la vista se oculta; si estaba apartado no hay nada que hacer
        } else {
            go('launcher');
        }
    }

    /** Ajustes > Durante el juego ('launcher' | 'log' | 'background') aplicado al abrirse la ventana del juego. */
    function applyDuringGame(mode) {
        go(mode === 'log' ? 'logs' : mode === 'launcher' ? 'launcher' : 'hidden', { focus: false });
    }

    /**
     * Se cerro la ultima ventana. Con el juego en curso y el launcher apartado no se hace nada (queda la bandeja: es "Ocultar
     * todo", y apartar la ventana tambien pasa por aqui). Sin juego (p. ej. la X en los registros tras un error) vuelve el launcher.
     */
    function allClosed(quit) {
        if (MainWindow.isQuitting()) return quit();
        if (MainWindow.isParked()) {
            if (!playing()) MainWindow.showWindow();
            return;
        }
        if (!MainWindow.isBusy()) quit();
    }

    return { go, applyDuringGame, gameClosed, allClosed, playing };
}

module.exports = { createViews };
