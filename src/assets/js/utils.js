const { ipcRenderer } = require('electron')
const { Status } = require('minecraft-java-core')
const { resolveMinecraftAddress } = require('./assets/js/core/net.js');
const { createServerWatch } = require('./assets/js/core/serverwatch.js');
const config = require('./launcher.config.json');

import database from './utils/database.js';
import toast from './utils/toast.js';
import { refreshSkinFor } from './utils/instancesetup.js';
import { isHidden, onHiddenChange } from './utils/windowstate.js';

function changePanel(id) {
    const panel = document.querySelector(`.panels .${id}`);
    if (!panel) return;
    document.querySelector('.panels .active')?.classList.remove('active');
    panel.classList.add('active');
    document.body.dataset.view = id;
    document.querySelectorAll('.topbar .tab').forEach(t => t.classList.toggle('on', t.dataset.panel === id));
    window.dispatchEvent(new CustomEvent('panel-change', { detail: id }));
}

const appdata = () => ipcRenderer.invoke('appData')

/** Cabeza de la skin (8x8 con su capa exterior) como data URL; '' si la imagen no se puede leer. */
function headTexture(source) {
    return new Promise(resolve => {
        const image = new Image();
        image.onload = () => {
            const canvas = document.createElement('canvas');
            canvas.width = canvas.height = 8;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(image, 8, 8, 8, 8, 0, 0, 8, 8);
            ctx.drawImage(image, 40, 8, 8, 8, 0, 0, 8, 8);
            resolve(canvas.toDataURL());
        };
        image.onerror = () => resolve('');
        image.src = source;
    });
}

async function addAccount(data) {
    const base64 = data?.profile?.skins?.[0]?.base64;
    const head = base64 ? await headTexture(base64) : '';
    const div = document.createElement("div");
    div.classList.add("account");
    div.id = data.ID;
    const premium = data?.meta?.type === 'Xbox';
    div.innerHTML = `
        <div class="profile-image" ${head ? 'style="background-image: url(' + head + ');"' : ''}></div>
        <div class="profile-infos">
            <div class="profile-pseudo">${data.name}</div>
            <div class="badges"><span class="badge">${premium ? 'PREMIUM' : 'NO PREMIUM'}</span><span class="badge use">EN USO</span></div>
        </div>
        <div class="acc-actions">
            <button type="button" class="use-profile">Usar</button>
            <button type="button" class="delete-profile" id="${data.ID}">Quitar</button>
        </div>
    `
    const list = document.querySelector('.accounts-list');
    return list.insertBefore(div, list.querySelector('#add'));
}

function accountSelect(data) {
    document.querySelector('.account-select')?.classList.remove('account-select');
    document.getElementById(`${data.ID}`)?.classList.add('account-select');
    setPlayer(data);
}

// Jugador actual: nombre, busto y tipo de cuenta (Inicio). Premium usa el busto 3D; sin cuenta premium, Steve.
function setPlayer(data) {
    if (!data) return;
    const name = data.name || 'Jugador';
    const premium = data?.meta?.type === 'Xbox';
    const q = s => document.querySelector(s);
    if (q('.player-name')) q('.player-name').textContent = name;
    if (q('.info-account')) q('.info-account').textContent = premium ? 'Premium' : 'No premium';
    const bust = q('.bust');
    if (bust && !bust.hidden) showBust(bust, name, premium);
    refreshSkinFor(data);   // skin de Mojang de la cuenta, sin esperar
    window.dispatchEvent(new CustomEvent('player-change', { detail: data }));
}

/** Busto de imagen (para cuando no hay visor 3D): el de la cuenta premium o Steve. */
function showBust(img, name, premium) {
    const fallback = 'assets/images/default/setve.png';
    img.onerror = () => { img.onerror = null; img.src = fallback; };
    img.src = premium ? `https://render.crafty.gg/3d/bust/${encodeURIComponent(name)}` : fallback;
}

// Estado del servidor junto a JUGAR: se refresca solo mientras se ve (core/serverwatch.js).
async function checkServer({ ip, port }) {
    // El dominio puede usar un registro SRV: se consulta el destino real.
    const real = await resolveMinecraftAddress(ip, port)
    const limit = new Promise(resolve => setTimeout(() => resolve({ error: true }), 8000));   // un servidor mudo no deja la consulta colgada
    const res = await Promise.race([new Status(real.ip, real.port).getStatus().catch(err => ({ error: err })), limit])
    return !!res && !res.error
}

function showServer(state) {
    const el = document.querySelector('.info-server');
    if (!el) return;
    el.classList.toggle('on', state === 'online');
    el.classList.toggle('off', state === 'offline');
    el.textContent = state === 'online' ? '● En línea' : state === 'offline' ? '● Sin conexión' : 'Comprobando...';
}

const serverWatch = createServerWatch({
    check: checkServer,
    show: showServer,
    visible: () => !isHidden() && !window.pcaGameRunning,
    lite: () => !!window.pcaLite
});
// Se vuelve a mirar en cuanto cambia lo que puede haber dejado el dato viejo.
onHiddenChange(hidden => { if (!hidden) serverWatch.refresh(); });
for (const ev of ['online', 'offline', 'game-closed']) window.addEventListener(ev, () => serverWatch.refresh());

/** Servidor cuyo estado se muestra ({ ip, port }). */
const setStatus = target => serverWatch.setTarget(target);

export { appdata, changePanel, config, database, toast, addAccount, accountSelect, setStatus, showBust }
