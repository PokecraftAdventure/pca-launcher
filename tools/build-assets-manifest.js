/**
 * Pokecraft Adventure Launcher - herramienta de desarrollo (no se empaqueta).
 *
 * Consulta Modrinth una vez y fija en src/assets-manifest.json las versiones,
 * URLs, hashes y tamanos exactos de lo que el launcher descarga. En tiempo de
 * ejecucion el launcher no usa la API de Modrinth, solo su CDN.
 *
 * Uso: node tools/build-assets-manifest.js [version-de-cobbleverse]
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { markReplaced } = require('../src/assets/js/core/screens');
const { isReplacedOrDropped } = require('../src/assets/js/core/localconfigs');

const COBBLEVERSE_VERSION = process.argv[2] || '1.7.42';
const UA = 'PokecraftAdventure-Launcher/0.1 (manifest-tool)';
const OUT = path.join(__dirname, '..', 'src', 'assets-manifest.json');

// Configs de Cobbleverse que NO se entregan desde el launcher.
const CONFIG_DENY = [
    /server/i,                       // configs de servidor por nombre
    /^defaultoptions(\/|-|\.)/i,     // el launcher escribe su propio options.txt
    /^chatplus(\/|\.|$)/i,           // las entrega AutoModpack
    /^ascension_pass(\/|\.|$)/i,     // las entrega AutoModpack
    /^(ftbessentials|ftblibrary|kits|easyafk|openpartiesandclaims|worldedit|spark|luckperms|chunky|c2me|tab|advanced-chat|essentialcommands)/i,
    /^pokecraft/i,
    /^litematica|^malilib/i,
    /sodium-fingerprint/i,           // depende del hardware
    /\.bak$/i,
    /_cache\.json$/i
];
// Ajustes de un shader o de un pack que el jugador cambia: se entregan como config "seed", no como parte del pack.
const PLAYER_SETTINGS = /^(shaderpacks\/[^/]+\.txt|resourcepacks\/[^/]+\.rpo)$/;
// Configs que el launcher reemplaza cuando cambia su version (look fijo).
const CONFIG_MANAGED = [/^fancymenu(\/|\.|$)/i];

async function api(p) {
    const res = await fetch('https://api.modrinth.com/v2' + p, { headers: { 'User-Agent': UA } });
    if (!res.ok) throw new Error(`API ${p}: ${res.status}`);
    return res.json();
}

async function range(url, a, b) {
    const res = await fetch(url, { headers: { 'User-Agent': UA, Range: `bytes=${a}-${b}` } });
    if (res.status !== 206 && res.status !== 200) throw new Error(`Range ${url}: ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
}

async function readZipDirectory(url, size) {
    const tail = await range(url, size - (1 << 20), size - 1);
    const eocd = tail.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
    const cdSize = tail.readUInt32LE(eocd + 12);
    const cdOff = tail.readUInt32LE(eocd + 16);
    const cd = tail.length >= size - cdOff
        ? tail.subarray(tail.length - (size - cdOff)).subarray(0, cdSize)
        : await range(url, cdOff, cdOff + cdSize - 1);
    const entries = {};
    let p = 0;
    while (p + 46 <= cd.length && cd.readUInt32LE(p) === 0x02014b50) {
        const method = cd.readUInt16LE(p + 10);
        const crc = cd.readUInt32LE(p + 16);
        const csize = cd.readUInt32LE(p + 20);
        const usize = cd.readUInt32LE(p + 24);
        const nl = cd.readUInt16LE(p + 28), el = cd.readUInt16LE(p + 30), cl = cd.readUInt16LE(p + 32);
        const off = cd.readUInt32LE(p + 42);
        const name = cd.subarray(p + 46, p + 46 + nl).toString('utf8');
        entries[name] = { method, crc, csize, usize, off };
        p += 46 + nl + el + cl;
    }
    return entries;
}

async function readEntry(url, e) {
    const lh = await range(url, e.off, e.off + 400);
    const start = e.off + 30 + lh.readUInt16LE(26) + lh.readUInt16LE(28);
    const data = await range(url, start, start + e.csize - 1);
    return e.method === 8 ? zlib.inflateRawSync(data) : data;
}

function primary(version) {
    const f = version.files.find(x => x.primary) || version.files[0];
    return { url: f.url, file: f.filename, size: f.size, sha512: f.hashes.sha512, sha1: f.hashes.sha1 };
}

async function pickVersion(slug, predicate) {
    const versions = await api(`/project/${slug}/version`);
    const v = versions.find(predicate);
    if (!v) throw new Error(`Sin version valida para ${slug}`);
    return v;
}

(async () => {
    // 1) Cobbleverse (Modrinth)
    const versions = await api('/project/cobbleverse/version');
    const cv = versions.find(v => v.version_number === COBBLEVERSE_VERSION);
    if (!cv) throw new Error('No existe Cobbleverse ' + COBBLEVERSE_VERSION);
    const mrpack = primary(cv);
    console.log('Cobbleverse', cv.version_number, mrpack.file, (mrpack.size / 1048576).toFixed(1) + ' MB');

    const entries = await readZipDirectory(mrpack.url, mrpack.size);
    const index = JSON.parse((await readEntry(mrpack.url, entries['modrinth.index.json'])).toString('utf8'));
    const defaultOptions = (await readEntry(mrpack.url, entries['overrides/config/defaultoptions/options.txt'])).toString('utf8');
    const resourcePacks = JSON.parse(defaultOptions.match(/^resourcePacks:(\[.*\])\s*$/m)[1]);

    // 2) Packs enlazados en el indice de Cobbleverse (con hash), sin los "Credits Only"
    const linked = index.files
        .filter(f => /^(resourcepacks|shaderpacks)\//.test(f.path) && !path.basename(f.path).startsWith('z DO NOT ENABLE z'))
        .map(f => ({ dest: f.path, url: f.downloads[0], size: f.fileSize, sha512: f.hashes.sha512 }));

    // 3) Archivos de overrides de packs y shaders (salen del propio .mrpack)
    const packFiles = Object.entries(entries)
        .filter(([n]) => /^overrides\/(resourcepacks|shaderpacks)\//.test(n) && !n.endsWith('/'))
        .map(([n, e]) => ({ entry: n, dest: n.slice('overrides/'.length), size: e.usize, crc32: e.crc }));
    const overrides = packFiles.filter(f => !PLAYER_SETTINGS.test(f.dest));

    // 4) Configs de cliente permitidas
    const configs = Object.keys(entries)
        .filter(n => n.startsWith('overrides/config/') && !n.endsWith('/'))
        .map(n => n.slice('overrides/config/'.length))
        .map(rel => {
            const e = entries['overrides/config/' + rel];
            const denied = CONFIG_DENY.some(re => re.test(rel)) || isReplacedOrDropped(rel);
            const kind = CONFIG_MANAGED.some(re => re.test(rel)) ? 'managed' : 'seed';
            return { path: 'config/' + rel, entry: 'overrides/config/' + rel, size: e.usize, crc32: e.crc, kind, denied };
        })
        .concat(packFiles.filter(f => PLAYER_SETTINGS.test(f.dest))
            .map(f => ({ path: f.dest, entry: f.entry, size: f.size, crc32: f.crc32, kind: 'seed', denied: false })));

    // 5) Fusion Connected Glass (anadido por el usuario) y CobbleTCG (segundo plano)
    const fusionV = await pickVersion('fusion-connected-glass', v => v.files.some(f => f.filename === 'Fusion Connected Glass v1.0.1 for Minecraft 1.20-1.21.8.zip'));
    const fusionF = fusionV.files.find(f => f.filename === 'Fusion Connected Glass v1.0.1 for Minecraft 1.20-1.21.8.zip');
    const fusion = { dest: 'resourcepacks/' + fusionF.filename, url: fusionF.url, size: fusionF.size, sha512: fusionF.hashes.sha512 };

    const tcgSlugs = ['cobbletcg-resourcepacks', 'cobbletcg-resorcepack2', 'cobbletcg-resorcepack3', 'cobbletcg-resorcepack4', 'cobbletcg-resourcepack5'];
    // Version fijada para que coincida con el mod cobbletcg 1.5.0 del servidor.
    const tcgPin = { 'cobbletcg-resourcepack5': 'CobbleTCG_ResourcePack5-1.5.0' };
    const tcg = [];
    for (const slug of tcgSlugs) {
        const all = await api(`/project/${slug}/version`);
        const v = tcgPin[slug] ? all.find(x => x.version_number === tcgPin[slug]) : all[0];
        if (!v) throw new Error('Sin version fijada para ' + slug);
        const p = primary(v);
        tcg.push({ slug, version: v.version_number, dest: 'resourcepacks/' + p.file, url: p.url, size: p.size, sha512: p.sha512, packId: 'file/' + p.file });
    }

    // 6) Comprobacion: todo pack activo por defecto debe poder obtenerse
    const available = new Set([...linked.map(l => l.dest), ...overrides.map(o => o.dest)]);
    const missing = resourcePacks.filter(p => p.startsWith('file/')).filter(p => !available.has('resourcepacks/' + p.slice(5)));
    if (missing.length) console.warn('AVISO: packs activos sin fuente:', missing);

    const previous = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : {};
    const manifest = {
        generated: new Date().toISOString().slice(0, 10),
        cobbleverse: { version: COBBLEVERSE_VERSION, mrpack },
        resourcePacks,
        linked,
        overrides,
        configs,
        fusion,
        tcg,
        screens: previous.screens          // las pone `npm run screens`; sustituyen configs de Cobbleverse
    };
    markReplaced(manifest);
    fs.writeFileSync(OUT, JSON.stringify(manifest, null, 2) + '\n');

    const used = configs.filter(c => !c.denied);
    console.log(`\nManifiesto escrito: ${path.relative(process.cwd(), OUT)}`);
    console.log(` packs activos por defecto: ${resourcePacks.length} (file/: ${resourcePacks.filter(p => p.startsWith('file/')).length})`);
    console.log(` enlazados: ${linked.length} (${(linked.reduce((a, b) => a + b.size, 0) / 1048576).toFixed(0)} MB) | overrides de packs/shaders: ${overrides.length}`);
    console.log(` configs: ${configs.length} en total | entregadas: ${used.length} | excluidas: ${configs.length - used.length} | gestionadas: ${used.filter(c => c.kind === 'managed').length}`);
    console.log(` TCG: ${tcg.length} packs (${(tcg.reduce((a, b) => a + b.size, 0) / 1048576).toFixed(0)} MB)`);
})().catch(e => { console.error('ERROR', e); process.exit(1); });
