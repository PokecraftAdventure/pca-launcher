/**
 * Pokecraft Adventure Launcher
 * Visor 3D del jugador (Perfil: personaje completo; Inicio: busto). Usa skinview3d (MIT, assets/js/lib).
 * La textura sale de los datos de la cuenta o de un archivo/URL; sin skin se usa una provisional.
 * Solo dibuja mientras esta visible (setActive) para que el consumo sea casi nulo en segundo plano.
 */
const sv = require('./assets/js/lib/skinview3d.bundle.js');
const fs = require('fs');
import { isHidden, onHiddenChange } from './windowstate.js';

const skins = require('./assets/js/core/skins.js');

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const SPIN_SPEED = 0.5;   // giro automatico: algo mas lento que antes (0.7)

// Skin provisional (formato 64x64), pintada en codigo con los colores de la marca.
function placeholderSkin() {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const x = c.getContext('2d');
    const R = (col, a, b, w, h) => { x.fillStyle = col; x.fillRect(a, b, w, h); };
    const SKIN = '#dcb48a', HAIR = '#5a3b1e', SHIRT = '#6a33d8', LEGS = '#2a2250', EYE = '#1b1730';
    R(SKIN, 0, 0, 32, 16);                          // cabeza
    R(HAIR, 8, 0, 8, 8);                            // pelo (arriba)
    R(HAIR, 8, 8, 8, 2); R(HAIR, 0, 8, 8, 4); R(HAIR, 16, 8, 8, 4); R(HAIR, 24, 8, 8, 5);
    R(EYE, 9, 12, 2, 1); R(EYE, 13, 12, 2, 1);      // ojos
    R(SHIRT, 16, 16, 24, 16);                       // torso
    R(SKIN, 40, 16, 16, 16);                        // brazo derecho
    R(LEGS, 0, 16, 16, 16);                         // pierna derecha
    R(SKIN, 32, 48, 16, 16);                        // brazo izquierdo
    R(LEGS, 16, 48, 16, 16);                        // pierna izquierda
    return c.toDataURL('image/png');
}
let PLACEHOLDER = null;
const PLACEHOLDER_WAIT_MS = 900;

class PlayerView {
    /**
     * @param {HTMLCanvasElement} canvas
     * @param {{mode?:'full'|'bust', follow?:boolean, frame?:{zoom:number,y:number,yaw?:number}}} opt  full = cuerpo completo
     *   girable; bust = cabeza y torso (`frame` ajusta su encuadre y hacia donde mira)
     */
    constructor(canvas, { mode = 'full', follow = true, animation = 'natural', spin = false, frame = null } = {}) {
        this.look = { x: 0, y: 0 };      // hacia donde mira la cabeza (-1..1)
        this.cur = { x: 0, y: 0 };
        this.active = false;
        this.lite = !!window.pcaLite;     // modo ligero: un solo fotograma, sin animacion (utils/performance.js)
        this.interacting = false;         // en modo ligero solo se dibuja en los instantes que abre kick()
        this.animWanted = null;

        this.viewer = new sv.SkinViewer({ canvas, width: canvas.clientWidth || 300, height: canvas.clientHeight || 300, renderPaused: true });
        const v = this.viewer;
        v.controls.enableZoom = false;
        v.controls.enablePan = false;
        this.rotates = mode === 'full';   // solo el cuerpo completo se puede girar (y nunca en modo Ligero)
        v.controls.enableRotate = this.rotates && !this.lite;
        v.fov = 30;

        if (mode === 'bust') {
            const p = v.playerObject.skin;
            p.leftLeg.visible = false; p.rightLeg.visible = false;
            v.zoom = frame ? frame.zoom : 1.9;
            v.playerWrapper.position.y = frame ? frame.y : -9;
            if (frame && frame.yaw) v.playerWrapper.rotation.y = frame.yaw;
        } else {
            v.zoom = 0.95;
            v.autoRotateSpeed = SPIN_SPEED;
            // Solo gira hacia los lados, con inercia suave; doble clic lo devuelve al frente.
            v.controls.minPolarAngle = v.controls.maxPolarAngle = Math.PI / 2;
            v.controls.enableDamping = true;
            v.controls.dampingFactor = 0.08;
            v.controls.saveState();
            canvas.addEventListener('dblclick', () => { v.controls.reset(); this.kick(900); });
            // Al tocarlo se detiene el giro automatico; si esta activado, vuelve a los segundos.
            canvas.addEventListener('pointerdown', () => { if (this.lite) return; v.autoRotate = false; clearTimeout(this.rt); this.pointerDown = true; this.interacting = true; this.sync(); });
            canvas.addEventListener('pointerup', () => { if (this.lite) return; clearTimeout(this.rt); this.pointerDown = false; this.kick(900); if (this.spin) this.rt = setTimeout(() => { v.autoRotate = true; }, 4000); });
        }
        this.spin = false;

        // Animacion por defecto ("Natural"): respira y la cabeza sigue al cursor.
        this.setAnimation(mode === 'bust' ? 'natural' : animation);
        if (mode === 'full') this.setSpin(spin);

        if (follow) {
            this.onMove = e => {
                const r = canvas.getBoundingClientRect();
                if (!r.width) return;
                this.look.x = clamp((e.clientX - (r.left + r.width / 2)) / 450, -1, 1);
                this.look.y = clamp((e.clientY - (r.top + r.height / 3)) / 350, -1, 1);
            };
            window.addEventListener('pointermove', this.onMove);
        }

        // Ajusta el lienzo a su caja cuando es visible
        this.ro = new ResizeObserver(() => {
            const w = canvas.clientWidth, h = canvas.clientHeight;
            // Cambiar el tamano vacia el lienzo un instante: solo se hace si de verdad cambio.
            if (w > 0 && h > 0 && (w !== v.width || h !== v.height)) { v.setSize(w, h); v.render(); this.kick(300); }
        });
        this.ro.observe(canvas);

        this.offHidden = onHiddenChange(() => this.sync());
        this.onPerf = e => this.setLite(!!(e.detail && e.detail.lite));
        window.addEventListener('perf-change', this.onPerf);
        // La skin de verdad llega justo despues: la provisional solo aparece si no se pide ninguna (evita un cambiazo al abrir).
        this.placeholderTimer = setTimeout(() => { if (this.wanted === undefined) this.setSkin(null); }, PLACEHOLDER_WAIT_MS);
    }

    /**
     * Animacion del personaje: natural (por defecto), walk, run, wave, crouch o still (sin movimiento).
     * La cabeza solo sigue al cursor en "natural".
     */
    setAnimation(id) {
        const v = this.viewer;
        this.animWanted = id;   // lo que el jugador eligio; en modo ligero se ve quieto sin perder la eleccion
        const reduce = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
        if ((reduce || this.lite) && id !== 'still') id = 'still';
        const make = {
            walk: () => new sv.WalkingAnimation(),
            run: () => new sv.RunningAnimation(),
            wave: () => new sv.WaveAnimation('right'),
            crouch: () => new sv.CrouchAnimation(),
            natural: () => new sv.FunctionAnimation((player, t) => {
                const s = t * 2;
                player.skin.leftArm.rotation.z = Math.sin(s) * 0.03 + 0.06;
                player.skin.rightArm.rotation.z = Math.sin(s + Math.PI) * 0.03 - 0.06;
                this.cur.x += (this.look.x - this.cur.x) * 0.12;
                this.cur.y += (this.look.y - this.cur.y) * 0.12;
                player.skin.head.rotation.y = this.cur.x * 0.7;
                player.skin.head.rotation.x = this.cur.y * 0.4;
            })
        }[id];
        try { v.animation = null; v.playerObject.skin.resetJoints?.(); v.playerObject.resetJoints?.(); } catch (e) { /* sin reinicio de articulaciones */ }
        v.animation = make ? make() : null;
    }

    /** Giro automatico lento (apagado por defecto: el personaje gira al arrastrarlo). */
    setSpin(on) {
        this.spin = !!on;
        clearTimeout(this.rt);
        this.viewer.autoRotate = this.spin && !this.lite;
    }

    /** Modo ligero: personaje estatico y de frente, sin girarlo; solo se dibuja al cambiar de skin o de tamano. */
    setLite(on) {
        this.lite = !!on;
        if (this.rotates) {
            this.viewer.controls.enableRotate = !this.lite;
            if (this.lite) { this.pointerDown = false; this.viewer.controls.reset(); }
        }
        this.setAnimation(this.animWanted || 'natural');
        this.viewer.autoRotate = this.spin && !this.lite;
        this.kick(700);
    }

    /** En modo ligero: dibuja durante unos instantes (un fotograma nuevo) y se vuelve a pausar. */
    kick(ms = 700) {
        this.interacting = true;
        clearTimeout(this.kt);
        this.sync();
        this.kt = setTimeout(() => { if (!this.pointerDown) { this.interacting = false; this.sync(); } }, ms);
    }

    /** source: URL, data URL o null (skin provisional). model: 'default' (clasica) | 'slim' (delgada). */
    setSkin(source, model = 'default') {
        // Al abrir, varios avisos piden la MISMA skin (cuenta, historial, Mojang): recargarla hacia parpadear al personaje.
        const key = `${model}|${source || ''}`;
        if (key === this.wanted) return this.job;
        this.wanted = key;
        // Las cargas van una tras otra: si no, una pisa a la anterior y el personaje puede quedar en blanco.
        this.job = (this.job || Promise.resolve()).then(() => this.loadSkin(source, model)).catch(() => { });
        return this.job;
    }

    async loadSkin(source, model) {
        if (!PLACEHOLDER) PLACEHOLDER = placeholderSkin();
        try {
            await this.viewer.loadSkin(source || PLACEHOLDER, { model: source ? model : 'default' });
        } catch (e) {
            console.warn('Skin 3D:', e);
            this.wanted = null;                     // fallo (p. ej. sin red): la proxima peticion lo vuelve a intentar
            if (source) await this.viewer.loadSkin(PLACEHOLDER, { model: 'default' });
        }
        this.kick(500);
    }

    /**
     * Skin que debe verse ahora: la actual de la biblioteca (core/skins.js: la activa de QuickSkin o, si no hay,
     * la de Mojang) y, si no hay ninguna, la del perfil de la cuenta o la provisional.
     */
    showCurrent(account) {
        if (account) this.account = account;
        try {
            const a = this.account;
            const cur = skins.getCurrent(a ? { account: { name: a.name, uuid: a.uuid } } : undefined);
            if (cur && cur.file) {
                const url = 'data:image/png;base64,' + fs.readFileSync(cur.file).toString('base64');
                return this.setSkin(url, cur.model === 'slim' ? 'slim' : 'default');
            }
        } catch (e) { console.warn('Skin actual:', e); }
        return this.setAccount(this.account);
    }

    /** Cuenta del launcher: usa la skin de su perfil si existe. */
    setAccount(data) {
        const s = data?.profile?.skins?.[0];
        const src = s?.base64 || s?.url || null;
        return this.setSkin(src, String(s?.variant || '').toUpperCase() === 'SLIM' ? 'slim' : 'default');
    }

    /** Solo dibuja cuando esta visible: sin esto el consumo en segundo plano seria constante. */
    setActive(on) {
        this.active = !!on;
        this.sync();
        if (on) this.kick(600);
    }

    sync() { this.viewer.renderPaused = !(this.active && !isHidden() && (!this.lite || this.interacting)); }

    dispose() {
        window.removeEventListener('pointermove', this.onMove);
        clearTimeout(this.placeholderTimer);
        window.removeEventListener('perf-change', this.onPerf);
        clearTimeout(this.kt);
        this.offHidden?.();
        this.ro.disconnect();
        this.viewer.dispose();
    }
}

export { PlayerView };
