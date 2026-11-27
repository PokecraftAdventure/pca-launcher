/**
 * Pokecraft Adventure Launcher
 *
 * Tienda oficial dentro del launcher (pestana "Tienda"). La web va en una vista nativa APARTE (WebContentsView) de la
 * ventana principal: sin Node, aislada (contextIsolation + sandbox) y con sesion propia, porque la ventana del launcher
 * si tiene Node y una pagina externa nunca debe cargarse en ella. Solo se navega dentro del dominio de la tienda; lo demas
 * (enlaces externos, ventanas nuevas) se abre en el navegador del sistema.
 *
 * Forma de la ventana:
 *  - Al abrir la tienda la ventana pasa a VERTICAL (la tienda es una web pensada para movil) y al salir recupera su
 *    tamano, posicion y estado de maximizada.
 *  - Cuando la pagina termina de cargar, el launcher entra en modo INMERSIVO: la cabecera y la barra de JUGAR se esconden
 *    y la pagina ocupa casi todo. Al llevar el raton al borde superior o inferior aparecen (la vista se DESPLAZA, mismo
 *    tamano, para no recolocar la pagina). La primera vez las barras se quedan visibles un rato para que se vea de donde salen.
 *    El raton se lee aqui (la vista tapa el DOM de la ventana, que no recibe eventos sobre ella).
 *
 * IPC (renderer -> principal): store:open {bounds, layout, url}, store:bounds, store:hide, store:nav.
 * IPC (principal -> renderer): store:state, store:offline, store:immersive (bool), store:reveal ('top'|'bottom'|null).
 */
const { WebContentsView, ipcMain, shell, screen } = require('electron');

const DEFAULT_URL = 'https://example.store.link/';
const hostOk = h => h === 'store.link' || h.endsWith('.store.link');
const VERTICAL = { width: 760, height: 940, minWidth: 560, minHeight: 640 };
const DEMO_MS = 2600;           // primera vez: las barras se quedan visibles antes de esconderse
const IMMERSIVE_MS = 1100;      // despues de cargar la pagina
const POLL_MS = 70;
const round = b => ({ x: Math.round(b.x), y: Math.round(b.y), width: Math.round(b.width), height: Math.round(b.height) });

function register(getWindow) {
    let view = null;
    let url = DEFAULT_URL;
    let saved = null;                   // tamano, posicion y minimo de la ventana antes de pasar a vertical
    let normal = null;                  // ultima posicion "normal" de la vista (la manda el renderer)
    let layout = { topH: 122, botH: 88, handle: 28, demo: false };
    let imm = false;                    // inmersivo
    let reveal = null;                  // null | 'top' | 'bottom'
    let poll = null, anim = null, immTimer = null, enterTicks = 0, leaveTicks = 0;
    let loaded = false;                 // la pagina ya cargo una vez en esta apertura
    const wired = new WeakSet();        // ventanas a las que ya se les puso el aviso de cambio de tamano

    const win = () => { const w = getWindow(); return w && !w.isDestroyed() ? w : null; };
    const emit = (channel, payload) => { const w = win(); if (w) w.webContents.send(channel, payload); };

    // ---- ventana vertical ----
    function toVertical() {
        const w = win();
        if (!w || saved) return;
        saved = { bounds: w.getBounds(), min: w.getMinimumSize(), max: w.isMaximized() };
        if (saved.max) w.unmaximize();
        const wa = screen.getDisplayMatching(saved.bounds).workArea;
        const width = Math.min(VERTICAL.width, wa.width), height = Math.min(VERTICAL.height, wa.height - 40);
        w.setMinimumSize(VERTICAL.minWidth, VERTICAL.minHeight);
        w.setBounds({ x: Math.round(wa.x + (wa.width - width) / 2), y: Math.round(wa.y + (wa.height - height) / 2), width, height });
    }
    function restoreWindow() {
        const w = win();
        if (!w || !saved) { saved = null; return; }
        const s = saved; saved = null;
        w.setMinimumSize(s.min[0], s.min[1]);
        w.setBounds(s.bounds);
        if (s.max) w.maximize();
    }

    // ---- inmersivo ----
    // Al mostrar una barra la vista se DESPLAZA (mismo tamano): la pagina no se recoloca, solo se tapa o destapa un borde.
    function immBounds(r) {
        const [W, H] = win().getContentSize();
        const hd = layout.handle;
        let y = hd;
        if (r === 'top') y = layout.topH;
        if (r === 'bottom') y = hd - layout.botH;
        return { x: 0, y, width: W, height: H - 2 * hd };
    }
    function tween(to, ms) {
        if (!view) return;
        if (anim) { clearInterval(anim); anim = null; }
        const v = view, from = v.getBounds(), t0 = Date.now();
        if (!ms) { v.setBounds(round(to)); return; }
        anim = setInterval(() => {
            const k = Math.min(1, (Date.now() - t0) / ms), e = 1 - Math.pow(1 - k, 3);
            try {
                v.setBounds(round({
                    x: from.x + (to.x - from.x) * e, y: from.y + (to.y - from.y) * e,
                    width: from.width + (to.width - from.width) * e, height: from.height + (to.height - from.height) * e
                }));
            } catch (e2) { k < 1 && clearInterval(anim); }
            if (k >= 1) { clearInterval(anim); anim = null; }
        }, 16);
    }
    function setReveal(r) {
        if (r === reveal || !win()) return;
        reveal = r;
        emit('store:reveal', r);
        tween(immBounds(r), 190);
    }
    function tick() {
        const w = win();
        if (!imm || !w || !view) return;
        const wb = w.getContentBounds(), p = screen.getCursorScreenPoint();
        const x = p.x - wb.x, y = p.y - wb.y, hd = layout.handle;
        const inside = w.isVisible() && !w.isMinimized() && x >= 0 && x < wb.width && y >= 0 && y < wb.height;
        if (reveal === null) {
            leaveTicks = 0;
            const want = !inside ? null : (y <= hd ? 'top' : (y >= wb.height - hd ? 'bottom' : null));
            enterTicks = want ? enterTicks + 1 : 0;
            if (want && enterTicks >= 2) { enterTicks = 0; setReveal(want); }     // 2 lecturas seguidas: no salta por rozar el borde
        } else {
            const edge = reveal === 'top' ? layout.topH + 6 : wb.height - layout.botH - 6;
            const keep = inside && (reveal === 'top' ? y <= edge : y >= edge);
            leaveTicks = keep ? 0 : leaveTicks + 1;
            if (leaveTicks >= 3) { leaveTicks = 0; setReveal(null); }
        }
    }
    function enterImmersive() {
        if (imm || !view || !win()) return;
        imm = true; reveal = null;
        emit('store:immersive', true);
        tween(immBounds(null), 260);
        poll = setInterval(tick, POLL_MS);
    }
    function exitImmersive(restoreView) {
        if (immTimer) { clearTimeout(immTimer); immTimer = null; }
        if (poll) { clearInterval(poll); poll = null; }
        if (anim) { clearInterval(anim); anim = null; }
        const was = imm;
        imm = false; reveal = null;
        if (was) emit('store:immersive', false);
        if (was && restoreView && view && normal) view.setBounds(round(normal));
    }

    // ---- la vista ----
    function sendState() {
        if (!view) return;
        const wc = view.webContents;
        emit('store:state', { url: wc.getURL(), loading: wc.isLoading(), back: wc.navigationHistory.canGoBack(), fwd: wc.navigationHistory.canGoForward() });
    }
    function create() {
        loaded = false;
        view = new WebContentsView({
            // Sin Node, aislada y con sesion propia: nada de la web toca el launcher.
            webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, partition: 'persist:tienda' }
        });
        const wc = view.webContents;
        wc.setWindowOpenHandler(({ url: u }) => { if (/^https?:/.test(u)) shell.openExternal(u); return { action: 'deny' }; });
        wc.on('will-navigate', (e, u) => {
            try { if (!hostOk(new URL(u).hostname)) { e.preventDefault(); shell.openExternal(u); } } catch (err) { e.preventDefault(); }
        });
        ['did-start-loading', 'did-stop-loading', 'did-navigate', 'did-navigate-in-page'].forEach(ev => wc.on(ev, sendState));
        // Solo la barra de desplazamiento de la pagina se viste con la paleta del launcher (el resto de la tienda no se toca).
        wc.on('dom-ready', () => wc.insertCSS('::-webkit-scrollbar{width:10px;height:10px;background:#15112a}::-webkit-scrollbar-thumb{background:rgba(183,148,255,.38);border-radius:6px;border:2px solid #15112a}::-webkit-scrollbar-thumb:hover{background:rgba(183,148,255,.6)}').catch(() => { }));
        wc.on('did-fail-load', (e, code, desc, u, isMain) => {
            if (isMain && code !== -3) { exitImmersive(true); emit('store:offline', desc); }      // -3 = carga cancelada por una navegacion nueva
        });
        // Al cargar por primera vez las barras se esconden (un momento despues, para que se vea que cargo).
        wc.on('did-finish-load', () => {
            if (loaded) return;
            loaded = true;
            immTimer = setTimeout(() => { immTimer = null; if (view && view.getVisible()) enterImmersive(); }, layout.demo ? DEMO_MS : IMMERSIVE_MS);
        });
        wc.loadURL(url);
    }
    ipcMain.on('store:open', (e, d) => {
        const w = win();
        if (!w) return;
        if (d && d.layout) layout = { ...layout, ...d.layout };
        if (d && d.bounds) normal = d.bounds;
        if (d && typeof d.url === 'string') {
            try { const u = new URL(d.url); if (u.protocol === 'https:' && hostOk(u.hostname)) url = u.href; } catch (err) { /* se queda la de siempre */ }
        }
        if (!wired.has(w)) {
            wired.add(w);
            // el jugador cambia el tamano con la tienda inmersiva: recolocar sin animar
            w.on('resize', () => { if (imm && view) tween(immBounds(reveal), 0); });
            // si la ventana se destruye (p. ej. al abrirse el juego con "Ocultar launcher") no queda nada colgando
            w.once('closed', () => { exitImmersive(false); view = null; loaded = false; saved = null; });
        }
        toVertical();
        if (!view) create();
        w.contentView.addChildView(view);
        view.setVisible(true);
        if (loaded && !imm) immTimer = setTimeout(() => { immTimer = null; enterImmersive(); }, 400);
        if (normal) view.setBounds(round(normal));
    });
    ipcMain.on('store:bounds', (e, b) => {
        normal = b;
        if (view && !imm) view.setBounds(round(b));
    });
    ipcMain.on('store:hide', () => {
        exitImmersive(false);
        if (view) view.setVisible(false);
        restoreWindow();
    });
    ipcMain.on('store:nav', (e, a) => {
        if (!view) return;
        const wc = view.webContents;
        if (a === 'back') wc.navigationHistory.goBack();
        if (a === 'fwd') wc.navigationHistory.goForward();
        if (a === 'reload') wc.reload();
        if (a === 'home') wc.loadURL(url);
        if (a === 'ext') shell.openExternal(wc.getURL() || url);
    });
}

module.exports = { register };
