/**
 * Pokecraft Adventure Launcher
 *
 * Comprobacion simple de conexion: cualquier respuesta HTTP de la CDN de
 * Modrinth (aunque sea un error) significa que hay internet.
 */
const nodeFetch = require('node-fetch');
const dns = require('dns').promises;
const netMod = require('net');

async function isOnline(url = 'https://cdn.modrinth.com/', timeoutMs = 5000) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
        await nodeFetch(url, { method: 'HEAD', signal: ctrl.signal });
        return true;
    } catch (e) {
        return false;
    } finally {
        clearTimeout(t);
    }
}

/**
 * Minecraft resuelve el registro SRV de un dominio (_minecraft._tcp.<dominio>) cuando no se
 * indica puerto. Algunos servicios lo usan: play.example.org apunta a otro host y puerto.
 * La libreria de estado del launcher no lo hace, asi que se resuelve aqui antes de consultar.
 * @returns {Promise<{ip:string, port:number}>} el destino real, o el original si no hay SRV
 */
async function resolveMinecraftAddress(host, port = 25565, resolver = dns.resolveSrv.bind(dns), timeoutMs = 3000) {
    if (!host || Number(port) !== 25565 || netMod.isIP(host)) return { ip: host, port: Number(port) };
    try {
        const records = await Promise.race([
            resolver('_minecraft._tcp.' + host),
            new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), timeoutMs))
        ]);
        if (records && records.length) {
            records.sort((a, b) => a.priority - b.priority || b.weight - a.weight);
            return { ip: records[0].name, port: records[0].port };
        }
    } catch (e) { /* sin SRV: se usa el dominio tal cual */ }
    return { ip: host, port: Number(port) };
}

module.exports = { isOnline, resolveMinecraftAddress };
