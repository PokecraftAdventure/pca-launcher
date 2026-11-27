/**
 * Pokecraft Adventure Launcher
 * Estado compartido de noticias (Inicio y Noticias). Usa core/news.js (news.json del repositorio publico,
 * con copia en disco para cuando no hay red). Se refresca como mucho cada 5 minutos y solo al entrar a la pantalla.
 */
const { getNews } = require('./assets/js/core/news.js');
const cfg = require('./launcher.config.json');

const TTL = 5 * 60 * 1000;
const state = { items: null, fromCache: false, error: null, at: 0 };
let pending = null;

/** @returns {Promise<typeof state>} */
function loadNews(force = false) {
    if (!force && state.items && Date.now() - state.at < TTL) return Promise.resolve(state);
    if (pending) return pending;
    pending = getNews({ timeoutMs: 6000 }).then(r => {
        Object.assign(state, { items: r.items, fromCache: r.fromCache, error: r.error, at: Date.now() });
        window.dispatchEvent(new CustomEvent('news-updated'));
        return state;
    }).finally(() => { pending = null; });
    return pending;
}

/** Fallo real: hay URL configurada, no se pudo leer y tampoco hay copia guardada. */
const failed = () => !!state.error && !(state.items || []).length && !!cfg.newsUrl;
const find = id => (state.items || []).find(n => n.id === id);

export { loadNews, state as newsState, failed, find };
