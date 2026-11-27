/**
 * Pokecraft Adventure Launcher
 *
 * Perfil: personaje 3D, biblioteca de skins (core/skins.js), datos de juego y "Mis cuentas".
 * Las skins se cambian con el juego CERRADO: la elegida queda pendiente y se aplica al entrar al servidor.
 */
import { changePanel, accountSelect, database, showBust } from '../utils.js';
import { openPopup, closePopup } from '../utils/popup.js';
import { timeAgo } from '../utils/newsview.js';
import { PlayerView } from '../utils/playerview.js';
import { setupInstance, refreshSkinFor } from '../utils/instancesetup.js';
import { currentPlayer } from '../utils/installlayout.js';
import { filePath } from '../utils/filepath.js';
import { renderPose } from '../utils/poserender.js';
import { lock, unlock } from '../utils/lock.js';

const fs = require('fs');

const playstats = require('./assets/js/core/playstats.js');
const skins = require('./assets/js/core/skins.js');

// Animacion si el jugador no eligio otra: camina. En modo ligero el visor la deja quieta (PlayerView.setAnimation).
const DEFAULT_ANIM = 'walk';

class Profile {
    static id = "profile";

    async init() {
        this.db = new database();
        this.current = null;
        this.urls = new Map();          // hash -> data URL del PNG
        this.slimHint = new Map();      // hash -> 'slim' (skins agregadas en esta sesion)
        const q = s => document.querySelector(s);
        this.modal = q('.acc-modal');
        document.body.appendChild(this.modal);          // la ventana flotante cubre toda la pantalla

        // Personaje 3D completo; si el 3D no esta disponible, se usa el busto de imagen.
        try { this.view = new PlayerView(q('.pf-canvas'), { mode: 'full' }); }
        catch (e) { console.warn('Visor 3D:', e); q('.pf-canvas').hidden = true; q('.pf-bust').hidden = false; }

        this.setupMenu();
        this.loadPrefs();

        this.grid = q('.pf-grid');
        this.msg = q('.pf-msg');
        this.file = q('.pf-file');
        q('.pf-add').addEventListener('click', () => this.askFile());
        this.file.addEventListener('change', () => this.addFile(this.file.files[0]));
        this.grid.addEventListener('click', e => {
            const item = e.target.closest('.sk-item');
            if (e.target.closest('.sk-del')) return this.askRemove(item);
            if (e.target.closest('.sk-yes')) return this.remove(item.dataset.hash);
            if (e.target.closest('.sk-no')) return this.closeConfirm();
            if (e.target.closest('.sk-confirm')) return;
            const c = e.target.closest('.sk-card');
            if (c) { this.closeConfirm(); this.pick(c.dataset.hash); }
        });
        this.grid.addEventListener('keydown', e => { if (e.key === 'Escape' && this.grid.querySelector('.sk-confirm')) { e.stopPropagation(); this.closeConfirm(); } });

        q('.pf-change').addEventListener('click', () => this.openAccounts());
        q('.acc-x').addEventListener('click', () => this.closeAccounts());
        q('.acc-close').addEventListener('click', () => this.closeAccounts());
        this.modal.addEventListener('click', e => { if (e.target === this.modal) this.closeAccounts(); });
        document.addEventListener('keydown', e => { if (e.key === 'Escape') this.closeAccounts(); });
        this.modal.querySelector('.accounts-list').addEventListener('click', e => this.listClick(e));

        window.addEventListener('player-change', e => this.setPlayer(e.detail));
        window.addEventListener('open-accounts', () => this.openAccounts());
        // El aviso "Cierra el juego..." no debe quedarse cuando el juego ya se cerro.
        window.addEventListener('game-closed', () => this.showMsg(''));
        window.addEventListener('perf-change', () => this.applyPrefs());   // las animaciones se bloquean o liberan al cambiar de modo
        window.addEventListener('panel-change', e => {
            this.view?.setActive(e.detail === 'profile');
            if (e.detail !== 'profile') this.closeMenu();
            if (e.detail === 'profile') this.onOpen();
        });
        skins.events.on('changed', () => { if (this.isOpen()) this.refresh(); else this.apply3D(); });
        this.refresh();
    }

    /* ---------- Animaciones del personaje ---------- */
    setupMenu() {
        const fab = document.querySelector('.pf-fab'), pop = document.querySelector('.pf-pop');
        this.fab = fab; this.pop = pop;
        fab.addEventListener('click', () => (pop.hidden ? this.openMenu() : this.closeMenu()));
        document.addEventListener('click', e => { if (!pop.hidden && !pop.contains(e.target) && !fab.contains(e.target)) this.closeMenu(); });
        document.addEventListener('keydown', e => {
            if (pop.hidden) return;
            if (e.key === 'Escape') { this.closeMenu(true); return; }
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                e.preventDefault();
                const rows = [...pop.querySelectorAll('.pf-row')];
                const i = rows.indexOf(document.activeElement);
                rows[(i + (e.key === 'ArrowDown' ? 1 : -1) + rows.length) % rows.length].focus();
            }
        });
        pop.addEventListener('click', e => {
            const row = e.target.closest('.pf-row');
            if (!row) return;
            if (row.dataset.anim) { this.setAnim(row.dataset.anim); this.closeMenu(true); }
            else if (row.classList.contains('pf-spin')) this.setSpinPref(row.getAttribute('aria-checked') !== 'true');
        });
    }

    openMenu() {
        this.pop.hidden = false;
        this.fab.setAttribute('aria-expanded', 'true');
        this.pop.querySelector('.pf-row.on')?.focus();
    }

    closeMenu(focusFab = false) {
        if (!this.pop || this.pop.hidden) return;
        this.pop.hidden = true;
        this.fab.setAttribute('aria-expanded', 'false');
        if (focusFab) this.fab.focus();
    }

    // Preferencias guardadas en la configuracion del launcher: animacion y giro automatico (apagado por defecto).
    async loadPrefs() {
        try {
            const lc = (await this.db.readData('configClient'))?.launcher_config || {};
            this.anim = lc.profileAnim || DEFAULT_ANIM;
            this.spin = !!lc.profileSpin;
        } catch (e) { this.anim = DEFAULT_ANIM; this.spin = false; }
        this.applyPrefs();
    }

    applyPrefs() {
        try { this.view?.setAnimation(this.anim); this.view?.setSpin(this.spin); } catch (e) { console.warn('Animacion:', e); }
        // En modo Ligero el personaje esta quieto: se marca "Quieto" y el resto avisa por que no se puede usar.
        const lite = !!window.pcaLite, MOVES = '.pf-row:not([data-anim="still"])';
        this.pop.querySelector('.pf-note').hidden = !lite;
        if (lite) lock(MOVES, 'Las animaciones están desactivadas en modo Ligero. Actívalas en Ajustes > Rendimiento.');
        else unlock(MOVES);
        this.pop.querySelectorAll('[data-anim]').forEach(r => {
            const on = r.dataset.anim === (lite ? 'still' : this.anim);
            r.classList.toggle('on', on);
            r.setAttribute('aria-checked', String(on));
        });
        this.pop.querySelector('.pf-spin').setAttribute('aria-checked', String(this.spin));
    }

    async savePref(key, value) {
        try { await this.db.editConfig(c => { c.launcher_config[key] = value; }); }
        catch (e) { console.warn('Preferencia:', e); }
    }

    setAnim(id) { this.anim = id; this.applyPrefs(); this.savePref('profileAnim', id); }
    setSpinPref(on) { this.spin = on; this.applyPrefs(); this.savePref('profileSpin', on); }

    isOpen() { return !!document.querySelector('.panels .profile.active'); }

    // Argumento { account } para core/skins.js: cada cuenta tiene su lista, su skin en uso y su skin pendiente.
    acc() {
        const c = this.current;
        return c ? { account: { name: c.name, uuid: c.uuid } } : undefined;
    }

    // Al abrir Perfil: instancia al dia, historial sincronizado y skin de Mojang refrescada (sin esperar).
    async onOpen() {
        this.showMsg('');
        this.loadStats();
        await setupInstance();
        try { skins.sync(this.acc()); } catch (e) { console.warn('Skins:', e); }
        refreshSkinFor(this.current);
        await this.refresh();
        this.showApplyResult();
    }

    /* ---------- Mis skins ---------- */
    showMsg(text, ok = false) {
        this.msg.querySelector('.pf-msg-text').textContent = text || '';
        this.msg.title = text || '';   // si el texto no cabe en dos lineas, se lee completo al pasar el cursor
        this.msg.hidden = !text;
        this.msg.classList.toggle('ok', ok);
    }

    // Aviso (una sola vez) de lo que paso con la ultima skin pendiente al entrar al servidor.
    showApplyResult() {
        try {
            const r = skins.getApplyResult(this.acc());
            if (!r || !r.time) return;
            // Una clave por cuenta: el resultado de una no tapa el de otra.
            let key = 'pcaSkinResultSeen';
            key += ':' + skins.accountKey(this.acc()?.account);
            let seen = 0;
            try { seen = Number(localStorage.getItem(key)) || 0; } catch (e) { /* sin almacenamiento */ }
            if (r.time <= seen) return;
            try { localStorage.setItem(key, String(r.time)); } catch (e) { /* sin almacenamiento */ }
            if (r.status === 'applied') this.showMsg('Tu skin se aplicó al entrar al servidor.', true);
            else this.showMsg(`No se pudo aplicar tu skin${r.detail ? `: ${r.detail}` : ''}. Vuelve a elegirla e inténtalo de nuevo.`);
        } catch (e) { /* sin resultado */ }
    }

    dataUrl(hash, file) {
        if (this.urls.has(hash)) return this.urls.get(hash);
        let url = '';
        try { url = 'data:image/png;base64,' + fs.readFileSync(file).toString('base64'); } catch (e) { /* copia perdida */ }
        if (url) this.urls.set(hash, url);
        return url;
    }

    modelOf(s) { return this.slimHint.get(s.hash) || (s.model === 'slim' ? 'slim' : 'classic'); }

    // Pone en el personaje 3D la skin pendiente (si hay) o la actual.
    apply3D() {
        if (!this.view) return;
        try {
            const pend = skins.getPending(this.acc());
            if (pend) {
                const s = skins.getHistory(this.acc()).find(h => h.hash === pend);
                const url = s && this.dataUrl(s.hash, s.file);
                if (url) return this.view.setSkin(url, this.modelOf(s) === 'slim' ? 'slim' : 'default');
            }
        } catch (e) { if (this.current) console.warn('Skin pendiente:', e); }   // sin cuenta aun (antes del inicio de sesion) es normal
        this.view.showCurrent(this.current);
    }

    async refresh() {
        const rev = this.rev = (this.rev || 0) + 1;   // si llega otra actualizacion mientras tanto, esta se descarta
        let list = [], pend = null;
        try { list = skins.getHistory(this.acc()).filter(s => this.dataUrl(s.hash, s.file)); pend = skins.getPending(this.acc()); }
        catch (e) { if (this.current) console.warn('Historial de skins:', e); }
        this.grid.hidden = !list.length;
        document.querySelector('.pf-empty').hidden = list.length > 0;
        // Pose 3D de cada skin (tres cuartos), dibujada una sola vez por skin.
        const previews = await Promise.all(list.map(s => renderPose(s.hash, this.urls.get(s.hash), this.modelOf(s))));
        if (rev !== this.rev) return;
        this.grid.textContent = '';
        list.forEach((s, i) => {
            const isPend = pend === s.hash && !s.active;
            const b = document.createElement('button');
            b.type = 'button';
            b.className = 'sk-card' + (isPend ? ' pend' : '');
            b.dataset.hash = s.hash;
            b.setAttribute('aria-pressed', String(isPend));
            const tag = isPend ? 'Se aplicará al jugar' : '';
            b.setAttribute('aria-label', `${s.name}${tag ? ', ' + tag.toLowerCase() : ''}`);
            const prev = document.createElement('div'); prev.className = 'sk-prev';
            const im = document.createElement('img'); im.alt = ''; im.src = previews[i];
            prev.appendChild(im);
            const info = document.createElement('div'); info.className = 'sk-info';
            const n = document.createElement('span'); n.className = 'sk-name'; n.textContent = s.name; n.title = s.name;
            const u = document.createElement('span'); u.className = 'sk-use' + (isPend ? ' pend' : ' off'); u.textContent = tag || ' ';
            info.append(n, u);
            b.append(prev, info);
            const item = document.createElement('div');
            item.className = 'sk-item';
            item.dataset.hash = s.hash;
            item.setAttribute('role', 'listitem');
            const del = document.createElement('button');
            del.type = 'button';
            del.className = 'sk-del';
            // core/skins.js manda `removable`/`protectedBy` por cuenta: la skin de Mojang y la unica skin no se pueden eliminar.
            const blocked = s.removable === false;
            const why = s.protectedBy === 'MOJANG_SKIN' ? 'Es tu skin de Mojang' : 'Es tu única skin: agrega otra antes de eliminarla';
            del.setAttribute('aria-label', blocked ? `${s.name}: ${why}` : `Eliminar ${s.name}`);
            del.title = blocked ? why : 'Eliminar skin';
            if (blocked) { del.disabled = true; del.classList.add('locked'); }
            del.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>';
            item.append(b, del);
            this.grid.appendChild(item);
        });
        this.apply3D();
    }

    gameBusy() {
        if (!window.pcaGameRunning) return false;
        this.showMsg('Cierra el juego para cambiar de skin: se aplica al volver a entrar al servidor.');
        return true;
    }

    // Elegir una skin del historial: queda pendiente y se aplica al entrar al servidor.
    pick(hash) {
        this.showMsg('');   // cualquier accion nueva sustituye al aviso anterior
        if (this.gameBusy()) return;
        try {
            if (skins.getHistory(this.acc()).find(h => h.hash === hash)?.active && !skins.getPending(this.acc())) return;
            skins.reuse(hash, this.acc());
            const s = skins.getHistory(this.acc()).find(h => h.hash === hash);
            this.showMsg(`«${s ? s.name : 'La skin'}» se aplicará la próxima vez que entres al servidor.`, true);
        } catch (e) {
            this.showMsg(`No se pudo elegir esa skin: ${e.message || e}`);
        }
        this.refresh().then(() => this.grid.querySelector('.sk-card.pend')?.focus({ preventScroll: false }));
    }

    /* ---------- Eliminar una skin de la biblioteca ---------- */
    closeConfirm() { this.grid.querySelectorAll('.sk-confirm').forEach(n => n.remove()); }

    askRemove(item) {
        this.showMsg('');
        if (this.gameBusy()) return;
        this.closeConfirm();
        const box = document.createElement('div');
        box.className = 'sk-confirm';
        box.setAttribute('role', 'alertdialog');
        box.setAttribute('aria-label', 'Confirmar eliminación');
        box.innerHTML = '<p>¿Eliminar esta skin?</p><button type="button" class="sk-yes">Eliminar</button><button type="button" class="sk-no">Cancelar</button>';
        item.appendChild(box);
        box.querySelector('.sk-no').focus();
    }

    remove(hash) {
        this.closeConfirm();
        if (this.gameBusy()) return;
        try {
            const name = skins.getHistory(this.acc()).find(h => h.hash === hash)?.name || 'La skin';
            skins.removeSkin(hash, this.acc());
            this.showMsg(`«${name}» se eliminó de tu biblioteca.`, true);
        } catch (e) {
            this.showMsg(`No se pudo eliminar esa skin: ${e.message || e}`);
        }
        this.refresh();
    }

    askFile() {
        this.showMsg('');
        if (this.gameBusy()) return;
        this.file.value = '';
        this.file.click();
    }

    async addFile(file) {
        if (!file || this.gameBusy()) return;
        if (!/\.png$/i.test(file.name) || (file.type && file.type !== 'image/png')) {
            return this.showMsg('Ese archivo no es un .png. Elige una imagen PNG de tu skin.');
        }
        const url = await new Promise(res => {
            const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => res(null); r.readAsDataURL(file);
        });
        const img = url && await new Promise(res => { const i = new Image(); i.onload = () => res(i); i.onerror = () => res(null); i.src = url; });
        if (!img) return this.showMsg('No se pudo leer esa imagen. Prueba con otro archivo .png.');
        const okSize = img.width >= 64 && img.width <= 1024 && img.width % 64 === 0 && (img.height === img.width || img.height === img.width / 2);
        if (!okSize) return this.showMsg(`Esa imagen mide ${img.width}×${img.height} píxeles. Una skin debe medir 64×64 (o 64×32) píxeles.`);
        let slim = false;
        if (img.height === img.width) {   // brazos delgados: la columna exterior del brazo esta vacia
            const c = document.createElement('canvas'); c.width = c.height = img.width;
            const x = c.getContext('2d'); x.drawImage(img, 0, 0);
            const k = img.width / 64;
            slim = x.getImageData(Math.round(55 * k), Math.round(25 * k), 1, 1).data[3] === 0;
        }
        try {
            await setupInstance();
            const name = file.name.replace(/\.png$/i, '').slice(0, 40) || 'Skin nueva';
            const r = skins.importSkin(filePath(file), name, this.acc());
            if (slim) this.slimHint.set(r.hash, 'slim');
            skins.queueApply(r.hash, this.acc());
            this.showMsg(r.existed
                ? `«${r.name}» ya estaba en tu biblioteca. Se aplicará la próxima vez que entres al servidor.`
                : `Listo: «${r.name}» se agregó y se aplicará la próxima vez que entres al servidor.`, true);
            try { skins.sync(this.acc()); } catch (e) { /* el historial se pone al dia al cerrar el juego */ }
        } catch (e) {
            this.showMsg(`No se pudo agregar la skin: ${e.message || e}`);
        }
        await this.refresh();
        this.grid.querySelector('.sk-card.pend')?.scrollIntoView({ inline: 'nearest', block: 'nearest' });
    }

    openAccounts() { this.modal.classList.add('open'); this.modal.setAttribute('aria-hidden', 'false'); }
    closeAccounts() { this.modal.classList.remove('open'); this.modal.setAttribute('aria-hidden', 'true'); }

    setPlayer(data) {
        if (!data) return;
        const changed = !this.current || this.current.ID !== data.ID || this.current.name !== data.name;
        this.current = data;
        const premium = data?.meta?.type === 'Xbox';
        if (changed) {   // otra cuenta = otra lista de skins, otra skin en uso y otros avisos
            this.showMsg('');
            this.closeConfirm();
            this.loadStats();
            this.refresh().then(() => { if (this.isOpen()) this.showApplyResult(); });
        }
        const q = s => document.querySelector(s);
        q('.pf-name').textContent = data.name || 'Jugador';
        q('.pf-type').textContent = premium ? 'Cuenta premium' : 'Cuenta no premium';
        this.apply3D();
        showBust(q('.pf-bust'), data.name, premium);
    }

    async loadStats() {
        const q = s => document.querySelector(s);
        try {
            const st = playstats.getStats(await currentPlayer(this.db));
            const h = st.hoursPlayed;
            q('.pf-hours').textContent = h >= 1 ? `${Math.floor(h)} h` : `${Math.round(h * 60)} min`;
            q('.pf-last').textContent = st.lastPlayed ? timeAgo(st.lastPlayed) : '—';
            q('.pf-since').textContent = st.firstPlayed ? new Date(st.firstPlayed).toLocaleDateString('es', { month: 'long', year: 'numeric' }) : '—';
        } catch (e) { console.warn('Datos del perfil:', e); }
    }

    async listClick(e) {
        const card = e.target.closest('.account');
        if (!card) return;
        try {
            if (card.id === 'add') {
                document.querySelector('.cancel-home').style.display = 'inline';
                document.dispatchEvent(new Event('login:reset'));
                this.closeAccounts();
                return changePanel('login');
            }
            if (e.target.closest('.delete-profile')) return await this.removeAccount(card.id);

            openPopup({ title: 'Iniciando sesión', content: 'Espera un momento...' });
            const account = await this.db.readData('accounts', Number(card.id));   // la base guarda el ID como numero y compara con ===
            accountSelect(account);
            await this.db.editConfig(c => { c.account_selected = account.ID; });
        } catch (err) {
            console.error(err);
        } finally {
            closePopup();
        }
    }

    async removeAccount(id) {
        const list = this.modal.querySelector('.accounts-list');
        await this.db.deleteData('accounts', Number(id));
        const el = list.querySelector(`[id="${id}"]`);
        if (el) list.removeChild(el);

        if (list.children.length == 1) { this.closeAccounts(); return changePanel('login'); }

        const configClient = await this.db.readData('configClient');
        if (configClient.account_selected == id) {
            const all = await this.db.readAllData('accounts');
            configClient.account_selected = all[0].ID;
            accountSelect(all[0]);
            await this.db.updateData('configClient', configClient);
        }
    }
}
export default Profile;
