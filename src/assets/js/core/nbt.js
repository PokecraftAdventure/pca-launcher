/**
 * Pokecraft Adventure Launcher
 *
 * Escritor minimo de servers.dat (NBT sin comprimir): una lista "servers" de
 * compuestos con "name" e "ip". Solo lo necesario para dejar el servidor en la
 * lista de multijugador.
 */
const TAG_END = 0, TAG_BYTE = 1, TAG_STRING = 8, TAG_LIST = 9, TAG_COMPOUND = 10;

function str(s) {
    const b = Buffer.from(s, 'utf8');
    const len = Buffer.alloc(2);
    len.writeUInt16BE(b.length);
    return Buffer.concat([len, b]);
}

const named = (type, name, payload) => Buffer.concat([Buffer.from([type]), str(name), payload]);

function buildServersDat(servers) {
    const items = servers.map(s => Buffer.concat([
        named(TAG_STRING, 'ip', str(s.ip)),
        named(TAG_STRING, 'name', str(s.name)),
        named(TAG_BYTE, 'hidden', Buffer.from([0])),
        Buffer.from([TAG_END])
    ]));
    const count = Buffer.alloc(4);
    count.writeInt32BE(items.length);
    const list = named(TAG_LIST, 'servers', Buffer.concat([Buffer.from([TAG_COMPOUND]), count, ...items]));
    return Buffer.concat([Buffer.from([TAG_COMPOUND]), str(''), list, Buffer.from([TAG_END])]);
}

module.exports = { buildServersDat };
