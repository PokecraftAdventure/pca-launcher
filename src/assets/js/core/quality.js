/**
 * Pokecraft Adventure Launcher
 *
 * Calidades graficas. Un options.txt base (teclas, packs, volumenes) mas una
 * capa pequena por calidad: claves graficas, Iris (shaders), Sodium y el pack
 * Fresh Animations. `chunkThreads` son los hilos de Sodium (0 = los elige segun el equipo). Nunca toca teclas, volumenes ni otros ajustes del jugador.
 *
 * El servidor usa view-distance 10 y simulation-distance 6, asi que en el
 * cliente solo importa renderDistance por debajo de 10.
 */
const fs = require('fs');
const path = require('path');

const FRESH_ANIMATIONS = 'file/Fresh Animations.zip';
const FRESH_ANCHOR = 'file/Fresh Moves.zip';   // Fresh Animations va justo antes
const MAIN_RP = 'file/COBBLEVERSE RP.zip';
// JigglyRadio trae su propio sonido de subir de nivel (el aviso de PokeNotifier): va por debajo de Cobblemon Interface.
const RADIO = 'file/JigglyRadio.zip';
const INTERFACE_RP = 'file/Cobblemon Interface.zip';

// Shader seleccionado en todas las calidades (la tecla K lo enciende y apaga); esta en assets-manifest.json.
const SHADER = 'ComplementaryUnbound_r5.8.1.zip';

const PRESETS = {
    minimo: {
        label: 'Mínimo',
        options: { ao: 'false', renderDistance: '6', simulationDistance: '6', renderClouds: '"false"', particles: '2', entityShadows: 'false', biomeBlendRadius: '0', mipmapLevels: '0', entityDistanceScaling: '0.5', maxFps: '30', enableVsync: 'false' },
        iris: { enableShaders: 'false', shaderPack: SHADER },
        sodium: { weather_quality: 'FAST', leaves_quality: 'FAST', enable_vignette: false },
        chunkThreads: 0,
        freshAnimations: false
    },
    medio: {
        label: 'Medio',
        options: { ao: 'true', renderDistance: '8', simulationDistance: '6', renderClouds: '"fast"', particles: '1', entityShadows: 'false', biomeBlendRadius: '2', mipmapLevels: '2', entityDistanceScaling: '0.75', maxFps: '60', enableVsync: 'false' },
        iris: { enableShaders: 'false', shaderPack: SHADER },
        sodium: { weather_quality: 'DEFAULT', leaves_quality: 'DEFAULT', enable_vignette: false },
        chunkThreads: 0,
        freshAnimations: true
    },
    alto: {
        label: 'Alto',
        options: { ao: 'true', renderDistance: '10', simulationDistance: '6', renderClouds: '"true"', particles: '0', entityShadows: 'true', biomeBlendRadius: '3', mipmapLevels: '4', entityDistanceScaling: '1.0', maxFps: '120', enableVsync: 'false' },
        iris: { enableShaders: 'true', shaderPack: SHADER },
        sodium: { weather_quality: 'DEFAULT', leaves_quality: 'DEFAULT', enable_vignette: false },
        chunkThreads: 2,
        freshAnimations: true
    },
    ultra: {
        label: 'Ultra',
        options: { ao: 'true', renderDistance: '10', simulationDistance: '6', renderClouds: '"true"', particles: '0', entityShadows: 'true', biomeBlendRadius: '3', mipmapLevels: '4', entityDistanceScaling: '1.5', maxFps: '260', enableVsync: 'false' },
        iris: { enableShaders: 'true', shaderPack: SHADER },
        sodium: { weather_quality: 'DEFAULT', leaves_quality: 'DEFAULT', enable_vignette: false },
        chunkThreads: 4,
        freshAnimations: true
    }
};

const DEFAULT_QUALITY = 'minimo';

// ---------- texto de options.txt (conserva el fin de linea del archivo) ----------

const eolOf = text => (text.includes('\r\n') ? '\r\n' : '\n');
const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function setKeys(text, map) {
    const eol = eolOf(text);
    for (const [key, value] of Object.entries(map)) {
        const re = new RegExp('^' + esc(key) + ':.*?(\\r?)$', 'm');
        if (re.test(text)) text = text.replace(re, (m, cr) => `${key}:${value}${cr}`);
        else text = text.replace(/(\r?\n)?$/, eol) + `${key}:${value}${eol}`;
    }
    return text;
}

function getPackList(text) {
    const m = text.match(/^resourcePacks:(\[.*\])\r?$/m);
    return m ? JSON.parse(m[1]) : [];
}

function setPackList(text, list) {
    return setKeys(text, { resourcePacks: JSON.stringify(list) });
}

function withFreshAnimations(list, wanted) {
    const out = list.filter(p => p !== FRESH_ANIMATIONS);
    if (!wanted) return out;
    let at = out.indexOf(FRESH_ANCHOR);
    if (at < 0) at = out.indexOf(MAIN_RP);
    if (at < 0) at = out.length;
    out.splice(at, 0, FRESH_ANIMATIONS);
    return out;
}

/** En la lista, cuanto mas al final mas prioridad: deja JigglyRadio justo debajo de Cobblemon Interface. */
function radioUnderInterface(list) {
    const radio = list.indexOf(RADIO), ui = list.indexOf(INTERFACE_RP);
    if (ui < 0 || radio < ui) return list;
    const out = list.filter(p => p !== RADIO);
    out.splice(ui, 0, RADIO);
    return out;
}

function applyToOptionsText(text, quality) {
    const p = PRESETS[quality];
    if (!p) throw new Error('Calidad desconocida: ' + quality);
    text = setKeys(text, p.options);
    return setPackList(text, withFreshAnimations(getPackList(text), p.freshAnimations));
}

function addPacks(text, ids) {
    const list = getPackList(text);
    const add = ids.filter(id => !list.includes(id));
    return add.length ? setPackList(text, list.concat(add)) : text;
}

// ---------- Iris, Sodium y resourcepackoverrides ----------

function applyToIris(text, quality) {
    const p = PRESETS[quality].iris;
    const eol = eolOf(text);
    for (const [k, v] of Object.entries(p)) {
        const re = new RegExp('^' + esc(k) + '=.*?(\\r?)$', 'm');
        if (re.test(text)) text = text.replace(re, (m, cr) => `${k}=${v}${cr}`);
        else text = text.replace(/(\r?\n)?$/, eol) + `${k}=${v}${eol}`;
    }
    return text;
}

function applyToSodium(jsonText, quality) {
    const data = JSON.parse(jsonText);
    data.quality = Object.assign({}, data.quality, PRESETS[quality].sodium);
    data.performance = Object.assign({}, data.performance, { chunk_builder_threads: PRESETS[quality].chunkThreads });
    return JSON.stringify(data, null, 2) + '\n';
}

function applyToPackOverrides(jsonText, quality) {
    const data = JSON.parse(jsonText);
    if (Array.isArray(data.default_packs)) {
        data.default_packs = radioUnderInterface(withFreshAnimations(data.default_packs, PRESETS[quality].freshAnimations));
    }
    return JSON.stringify(data, null, 2) + '\n';
}

/**
 * Aplica una calidad a los archivos que existan en la instancia.
 * El juego debe estar cerrado. Devuelve los archivos modificados.
 * `only` limita los archivos (rutas relativas); sin el, se aplican todos.
 */
function applyToInstance(instanceDir, quality, only) {
    const targets = [
        ['options.txt', applyToOptionsText],
        ['config/iris.properties', applyToIris],
        ['config/sodium-options.json', applyToSodium],
        ['config/resourcepackoverrides.json', applyToPackOverrides]
    ];
    const changed = [];
    for (const [rel, fn] of targets) {
        if (only && !only.includes(rel)) continue;
        const file = path.join(instanceDir, ...rel.split('/'));
        if (!fs.existsSync(file)) continue;
        const before = fs.readFileSync(file, 'utf8');
        let after;
        try { after = fn(before, quality); } catch (e) { continue; }
        if (after !== before) {
            fs.writeFileSync(file, after);
            changed.push(rel);
        }
    }
    return changed;
}

// ---------- sugerencia automatica ----------

const INTEL = 0x8086, NVIDIA = 0x10de, AMD = 0x1002;

/**
 * @param {{totalMemBytes:number, gpus:Array<{vendorId:number,active?:boolean}>}} hw
 * @returns {{quality:string, reason:string}}
 */
function suggest(hw) {
    const gb = (hw.totalMemBytes || 0) / 1024 ** 3;
    const vendors = (hw.gpus || []).map(g => g.vendorId);
    const onlyIntel = vendors.length > 0 && vendors.every(v => v === INTEL);
    const dedicated = vendors.some(v => v === NVIDIA || v === AMD);
    if (gb && gb <= 8.5) return { quality: 'minimo', reason: `Tienes ${gb.toFixed(0)} GB de RAM` };
    if (onlyIntel) return { quality: 'minimo', reason: 'Tu gráfica es integrada' };
    if (gb >= 15 && dedicated) return { quality: 'alto', reason: `${gb.toFixed(0)} GB de RAM y gráfica dedicada` };
    return { quality: 'medio', reason: 'Equipo intermedio' };
}

/** Memoria por defecto del juego en GB: 6, limitada a la mitad de la RAM. */
function defaultMemoryGb(totalMemBytes) {
    const gb = totalMemBytes / 1024 ** 3;
    const max = Math.max(2, Math.min(6, Math.floor(gb / 2)));
    return { min: Math.min(2, max), max };
}

module.exports = {
    PRESETS, DEFAULT_QUALITY, FRESH_ANIMATIONS,
    getPackList, setPackList, setKeys,
    applyToOptionsText, applyToIris, applyToSodium, applyToPackOverrides, applyToInstance,
    addPacks, suggest, defaultMemoryGb
};
