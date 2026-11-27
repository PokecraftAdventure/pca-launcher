/**
 * Pokecraft Adventure Launcher
 * Pose 3D de una skin como imagen (tres cuartos, brazos relajados) para las tarjetas del historial.
 * Cada skin se dibuja una sola vez (se guarda por hash) y de una en una; no queda ningun visor vivo.
 */
const sv = require('./assets/js/lib/skinview3d.bundle.js');

const W = 200, H = 340;
const cache = new Map();   // hash -> Promise<dataURL>
let queue = Promise.resolve();

async function draw(url, model) {
    const canvas = document.createElement('canvas');
    const v = new sv.SkinViewer({ canvas, width: W, height: H, preserveDrawingBuffer: true, renderPaused: true });
    try {
        await v.loadSkin(url, { model: model === 'slim' ? 'slim' : 'default' });
        v.fov = 30;
        v.zoom = 0.95;
        v.controls.enableRotate = false;
        v.playerObject.rotation.y = -0.55;
        v.playerObject.skin.leftArm.rotation.z = 0.08;
        v.playerObject.skin.rightArm.rotation.z = -0.08;
        v.render();
        return canvas.toDataURL('image/png');
    } finally {
        v.dispose();
    }
}

/** @returns {Promise<string>} data URL de la pose, o '' si no se pudo dibujar. */
function renderPose(hash, url, model) {
    const key = `${hash}|${model === 'slim' ? 'slim' : 'classic'}`;
    if (cache.has(key)) return cache.get(key);
    const p = queue.then(() => draw(url, model)).catch(e => { console.warn('Pose 3D:', e); return ''; });
    queue = p;
    cache.set(key, p);
    return p;
}

export { renderPose };
