/**
 * Pokecraft Adventure Launcher
 *
 * Rutas de instalacion. La carpeta de instalacion la elige el jugador; por
 * defecto es <appData>/.pokecraftadventure. La instancia del juego vive en
 * <instalacion>/instances/<nombre>, igual que espera minecraft-java-core.
 */
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');
const cfg = require('../../../launcher.config.json');
const { removeSync } = require('./fsx');

function defaultInstallDir(appData) {
    return path.join(appData, '.' + cfg.dataDirectory);
}

function resolveInstallDir(appData, configured) {
    return configured && String(configured).trim() ? path.resolve(configured) : defaultInstallDir(appData);
}

function layout(installDir) {
    const instanceDir = path.join(installDir, 'instances', cfg.instance.name);
    const launcherDir = path.join(installDir, '.launcher');
    return {
        installDir,
        instanceDir,
        modsDir: path.join(instanceDir, 'mods'),
        launcherDir,
        cacheDir: path.join(launcherDir, 'cache'),
        stateFile: path.join(launcherDir, 'state.json'),
        logsDir: path.join(instanceDir, 'logs'),
        crashDir: path.join(instanceDir, 'crash-reports')
    };
}

/** Evita escribir fuera de la instancia con rutas del manifiesto. */
function safeJoin(base, rel) {
    const full = path.resolve(base, ...String(rel).split('/'));
    const root = path.resolve(base) + path.sep;
    if (!full.startsWith(root)) throw new Error('Ruta fuera de la instancia: ' + rel);
    return full;
}

function ensureDir(dir) {
    fs.mkdirSync(dir, { recursive: true });
    return dir;
}

/** Espacio libre en la unidad de la carpeta (bytes) o null si no se puede saber. */
function freeSpace(dir) {
    try {
        let probe = path.resolve(dir);
        while (!fs.existsSync(probe)) {
            const parent = path.dirname(probe);
            if (parent === probe) break;
            probe = parent;
        }
        const st = fs.statfsSync(probe);
        return Number(st.bavail) * Number(st.bsize);
    } catch (e) {
        return null;
    }
}

/** Nombre de la subcarpeta propia: la raiz de la instalacion es siempre nuestra (T11/T13). */
const SUBFOLDER = 'Pokecraft Adventure';

/** Carpeta elegida por el jugador -> carpeta de instalacion real (<elegida>\Pokecraft Adventure). */
function withSubfolder(chosen) {
    const base = path.resolve(String(chosen));
    return path.basename(base).toLowerCase() === SUBFOLDER.toLowerCase() ? base : path.join(base, SUBFOLDER);
}

const GB = 1024 * 1024 * 1024;
// Minecraft + Fabric (assets, libraries, versions) ~1 GB, Java integrado ~0.5 GB, AutoModpack/mods/configs ~0.5 GB.
const BASE_INSTALL_BYTES = 2 * GB;

/**
 * Estimacion (bytes) de lo que ocupara una instalacion nueva. Base fija de Minecraft, Fabric, Java y
 * mods + el tamano de los archivos del manifiesto cuando lo declaran (campo `size` o `bytes`), con 10 % de margen.
 */
function estimateInstallBytes(manifest) {
    let extra = 0;
    const walk = (v, depth) => {
        if (!v || depth > 4) return;
        if (Array.isArray(v)) return v.forEach(x => walk(x, depth + 1));
        if (typeof v !== 'object') return;
        const n = Number(v.size != null ? v.size : v.bytes);
        if (Number.isFinite(n) && n > 0 && (v.url || v.path || v.file || v.name)) extra += n;
        else for (const k of Object.keys(v)) walk(v[k], depth + 1);
    };
    try { walk(manifest, 0); } catch (e) { /* sin manifiesto */ }
    return Math.ceil((BASE_INSTALL_BYTES + extra) * 1.1);
}

/**
 * Ruta recomendada para instalar: <unidad>\Pokecraft Adventure. Por defecto la unidad de appData; otra
 * unidad local solo si tiene el doble de espacio libre y al menos 20 GB.
 */
function recommendedInstallDir(appData) {
    const home = path.resolve(appData);
    let best = { dir: path.join(home, SUBFOLDER), free: freeSpace(home) || 0 };
    if (process.platform === 'win32') {
        const sysRoot = path.parse(home).root.toUpperCase();
        for (const letter of 'CDEFGHIJKLMNOPQRSTUVWXYZ') {
            const root = letter + ':\\';
            if (root === sysRoot) continue;
            const free = freeSpace(root);
            if (free != null && free >= 20 * GB && free >= best.free * 2) best = { dir: path.join(root, SUBFOLDER), free };
        }
    }
    return best.dir;
}

/**
 * Valida la carpeta de instalacion final (ya con subcarpeta).
 * @returns {{ok:boolean, errors:string[], warnings:string[]}}
 */
function checkFolder(dir) {
    const errors = [], warnings = [];
    const full = path.resolve(String(dir || ''));
    const low = full.toLowerCase();
    if (!dir || !String(dir).trim()) return { ok: false, errors: ['Elige una carpeta.'], warnings };
    if (path.parse(full).root === full) errors.push('No se puede instalar en la raíz de una unidad.');
    const sys = [process.env.SystemRoot, process.env.ProgramFiles, process.env['ProgramFiles(x86)'], process.env.ProgramData]
        .filter(Boolean).map(p => path.resolve(p).toLowerCase());
    if (sys.some(p => low === p || low.startsWith(p + path.sep))) errors.push('Esa es una carpeta del sistema. Elige otra, por ejemplo en Documentos o en otra unidad.');
    if (/[;!]/.test(full)) errors.push('La ruta contiene ";" o "!", que Java no admite. Elige otra carpeta.');
    if (/[^\x20-\x7e]/.test(full)) warnings.push('La ruta tiene acentos o símbolos especiales. Si el juego no abre, elige una ruta sin ellos.');
    if (full.startsWith('\\\\')) warnings.push('Es una carpeta de red: el juego irá más lento y puede fallar si se pierde la conexión.');
    if (/onedrive/i.test(full)) warnings.push('Está dentro de OneDrive: la sincronización puede ralentizar el juego y ocupar espacio en la nube.');
    if (!errors.length) {
        // Escritura real en la carpeta (o en el ancestro mas cercano que exista, que es donde se crearia).
        let probe = full;
        while (!fs.existsSync(probe)) {
            const parent = path.dirname(probe);
            if (parent === probe) break;
            probe = parent;
        }
        try {
            const f = path.join(probe, '.pca-write-test-' + process.pid);
            fs.writeFileSync(f, '');
            removeSync(f);
        } catch (e) {
            errors.push('No se puede escribir en esa carpeta. Elige otra.');
        }
    }
    return { ok: errors.length === 0, errors, warnings };
}

/**
 * Argumento de JVM para que el juego escriba logs/latest.log.
 * minecraft-java-core pasa la configuracion de log4j como ruta relativa y log4j la rechaza
 * ("unknown protocol"), asi que el juego no registraba nada. Los JVM_ARGS propios van despues
 * y prevalecen, por eso se pasa como URL file:// absoluta.
 */
function log4jArg(installDir) {
    return '-Dlog4j.configurationFile=' + pathToFileURL(path.join(installDir, 'assets', 'log_configs', 'client-1.12.xml')).href;
}

module.exports = {
    log4jArg, defaultInstallDir, resolveInstallDir, layout, safeJoin, ensureDir, freeSpace,
    withSubfolder, estimateInstallBytes, recommendedInstallDir, checkFolder, SUBFOLDER
};
