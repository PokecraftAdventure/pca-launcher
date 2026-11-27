/**
 * Pokecraft Adventure Launcher
 *
 * Filtro y busqueda de lineas del registro. Lo comparten el registro del proceso principal
 * (core/gamelog.js) y su copia en las ventanas (core/gamelog-client.js).
 */

/**
 * Funcion que dice si una linea cumple el filtro. El texto de busqueda se prepara una sola vez.
 * filter: 'all' | 'warn' (avisos y errores) | 'error'. query: texto (sin distinguir mayusculas).
 */
function predicate({ filter = 'all', query = '' } = {}) {
    const q = query.trim().toLowerCase();
    const level = filter === 'warn' ? e => e.level !== 'info' : filter === 'error' ? e => e.level === 'error' : () => true;
    return q ? e => level(e) && e.text.toLowerCase().includes(q) : level;
}

const matches = (e, opts) => predicate(opts)(e);

/** Las ultimas `limit` lineas que cumplen el filtro, en orden cronologico. */
function view(lines, { filter = 'all', query = '', limit = 600 } = {}) {
    const ok = predicate({ filter, query });
    const out = [];
    for (let i = lines.length - 1; i >= 0 && out.length < limit; i--) if (ok(lines[i])) out.push(lines[i]);
    return out.reverse();
}

module.exports = { matches, view };
