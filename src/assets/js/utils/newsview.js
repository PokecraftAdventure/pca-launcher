/**
 * Pokecraft Adventure Launcher
 * Vistas de noticias (Inicio, Noticias y ventana de lectura) y estados vacios. Solo genera HTML.
 * Todo el texto que viene de Discord se escapa antes de mostrarse.
 */

const ICONS = {
    news: '<svg viewBox="0 0 24 24"><path d="M4 5h13v14H6a2 2 0 01-2-2zM17 9h3v8a2 2 0 01-2 2M7 9h7M7 13h7"/></svg>',
    shop: '<svg viewBox="0 0 24 24"><path d="M3 4h2l2.5 11h10L20 7H6.5"/><circle cx="9" cy="19" r="1.4"/><circle cx="17" cy="19" r="1.4"/></svg>',
    wifi: '<svg viewBox="0 0 24 24"><path d="M2 9a15 15 0 0120 0M5.5 12.5a10 10 0 0113 0M9 16a5 5 0 016 0"/><circle cx="12" cy="19.5" r="1" fill="currentColor"/><path d="M3 3l18 18"/></svg>',
    play: '<svg viewBox="0 0 24 24"><path d="M8 5.5v13l11-6.5z" fill="currentColor" stroke="none"/></svg>'
};

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const cssUrl = u => String(u || '').replace(/['"()\\\s]/g, c => encodeURIComponent(c));

/** "hace 2 dias", "hace 1 semana"... (sin abreviaturas). */
function timeAgo(date) {
    const t = new Date(date).getTime();
    if (!t) return '';
    const s = Math.max(0, Math.floor((Date.now() - t) / 1000));
    const unit = (n, one, many) => `hace ${n} ${n === 1 ? one : many}`;
    if (s < 60) return 'hace un momento';
    const m = Math.floor(s / 60); if (m < 60) return unit(m, 'minuto', 'minutos');
    const h = Math.floor(m / 60); if (h < 24) return unit(h, 'hora', 'horas');
    const d = Math.floor(h / 24); if (d < 7) return unit(d, 'día', 'días');
    const w = Math.floor(d / 7); if (d < 30) return unit(w, 'semana', 'semanas');
    const mo = Math.floor(d / 30); if (mo < 12) return unit(mo, 'mes', 'meses');
    const y = Math.floor(d / 365); return unit(y, 'año', 'años');
}

/** Estado vacio: icono, titulo, texto y un boton (id para enlazar el clic). */
function emptyState({ icon = 'news', title, text, button }) {
    const btn = button
        ? `<button class="empty-btn ${button.primary ? 'primary' : ''}" data-action="${button.action}">${button.img ? `<img src="${button.img}" alt="">` : ''}${esc(button.label)}</button>`
        : '';
    return `<div class="empty-state">
        <div class="empty-ico">${ICONS[icon] || ICONS.news}</div>
        <div class="empty-title">${esc(title)}</div>
        <div class="empty-text">${esc(text)}</div>${btn}</div>`;
}

const DISCORD_BTN = { label: 'Abrir Discord', action: 'discord', img: 'assets/images/svgs/discord.svg' };

const EMPTY = {
    none: () => emptyState({ icon: 'news', title: 'Aún no hay noticias', text: 'Cuando el staff publique algo, lo verás aquí. Mientras tanto, entérate de todo en Discord.', button: DISCORD_BTN }),
    store: () => emptyState({ icon: 'shop', title: 'Sin anuncios de la tienda por ahora', text: 'Cuando haya novedades de la tienda, aparecerán aquí.', button: { label: 'Ver todas las noticias', action: 'clear-filter' } }),
    announcement: () => emptyState({ icon: 'news', title: 'Sin anuncios por ahora', text: 'Cuando el staff publique un anuncio, aparecerá aquí.', button: { label: 'Ver todas las noticias', action: 'clear-filter' } }),
    event: () => emptyState({ icon: 'news', title: 'Sin eventos por ahora', text: 'Cuando el staff anuncie un evento, aparecerá aquí.', button: { label: 'Ver todas las noticias', action: 'clear-filter' } }),
    tiktok: () => emptyState({ icon: 'news', title: 'Sin videos de TikTok por ahora', text: 'Cuando haya videos nuevos, aparecerán aquí.', button: { label: 'Ver todas las noticias', action: 'clear-filter' } }),
    error: () => emptyState({ icon: 'wifi', title: 'No pudimos cargar las noticias', text: 'Revisa tu conexión a internet. Puedes seguir usando el launcher.', button: { label: 'Reintentar', action: 'retry', primary: true } })
};

/** Normaliza un elemento del JSON de noticias. */
function normalize(n) {
    return {
        id: String(n.id ?? ''),
        type: n.type || 'announcement',
        title: n.title || '',
        body: n.body || '',
        author: n.author || '',
        date: n.date || null,
        image: n.image || '',
        url: n.url || '',
        pinned: n.pinned === true   // fijada por el staff en Discord: es lo unico que se destaca en Inicio
    };
}

const LABEL = { announcement: 'Anuncio', store: 'Tienda', event: 'Evento', tiktok: 'TikTok' };

// ---------- Texto de Discord -> HTML seguro ----------

/** Texto plano corto (sin formato) para resumenes en tarjetas. */
function plain(src, max = 150) {
    const t = String(src || '')
        .replace(/```[\s\S]*?```/g, ' ').replace(/<a?:\w+:\d+>|<[@#][!&]?\d+>/g, '')
        .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/^[#>\-*\s]+/gm, '').replace(/[*_~`|]/g, '')
        .replace(/\s+/g, ' ').trim();
    return t.length > max ? t.slice(0, max - 1).trimEnd() + '…' : t;
}

/** Subconjunto del formato de Discord: negrita, cursiva, subrayado, tachado, codigo, titulos, listas, citas y enlaces. */
function mdToHtml(src) {
    let s = esc(src);
    const blocks = [], inl = [];
    s = s.replace(/```(?:[a-z]+\n)?([\s\S]*?)```/g, (m, c) => { blocks.push(c); return `\u0000${blocks.length - 1}\u0000`; });
    s = s.replace(/`([^`\n]+)`/g, (m, c) => { inl.push(c); return `\u0001${inl.length - 1}\u0001`; });
    s = s.replace(/&lt;a?:\w+:\d+&gt;/g, '').replace(/&lt;[@#][!&]?\d+&gt;/g, '');
    s = s.replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g, (m, t, u) => `<a data-link="${u}">${t}</a>`);
    s = s.replace(/(^|[\s(])(https?:\/\/[^\s<)]+)/g, (m, p, u) => `${p}<a data-link="${u}">${u}</a>`);
    s = s.replace(/^#{1,3} +(.+)(\n|$)/gm, (m, t) => `<div class="md-h">${t}</div>`);
    s = s.replace(/^&gt; +(.+)(\n|$)/gm, (m, t) => `<div class="md-q">${t}</div>`);
    s = s.replace(/^[-*] +/gm, '• ');
    s = s.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/__(.+?)__/g, '<u>$1</u>').replace(/~~(.+?)~~/g, '<s>$1</s>');
    s = s.replace(/\*(?!\s)(.+?)\*/g, '<i>$1</i>').replace(/(^|\W)_(?!\s)(.+?)_(?=\W|$)/g, '$1<i>$2</i>');
    s = s.replace(/\n/g, '<br>');
    s = s.replace(/\u0001(\d+)\u0001/g, (m, i) => `<code>${inl[i]}</code>`);
    s = s.replace(/\u0000(\d+)\u0000/g, (m, i) => `<pre>${blocks[i].replace(/^\n|\n$/g, '')}</pre>`);
    return s;
}

// ---------- Tarjetas ----------

const imgStyle = n => (n.image ? ` style="background-image:url('${cssUrl(n.image)}')"` : '');
const tag = n => `<span class="n-tag ${n.type}">${LABEL[n.type] || 'Anuncio'}</span>`;
const initial = n => esc((n.author || '•').trim().charAt(0).toUpperCase() || '•');
const meta = n => `<div class="n-meta"><span class="n-av">${initial(n)}</span><span>${esc([n.author, timeAgo(n.date)].filter(Boolean).join(' · '))}</span></div>`;
const playIco = n => (n.type === 'tiktok' ? `<span class="n-play">${ICONS.play}</span>` : '');

/** Tarjeta vertical: imagen alta arriba, etiqueta, titulo y autor abajo. */
const cardV = n => `<article class="n-card v ${n.type}" data-id="${esc(n.id)}"><div class="n-img"${imgStyle(n)}>${playIco(n)}</div>
    <div class="n-info">${tag(n)}<div class="n-title">${esc(n.title)}</div>${meta(n)}</div></article>`;

/** Tarjeta ancha de la tienda: imagen vertical a la izquierda y texto; solo la tienda se destaca. */
const cardWide = (n, label) => `<article class="n-card wide store" data-id="${esc(n.id)}"><div class="n-img"${imgStyle(n)}></div>
    <div class="n-info"><span class="n-tag store solid">${esc(label)}</span><div class="n-title big">${esc(n.title)}</div>
    <div class="n-text">${esc(plain(n.body))}</div>${meta(n)}<span class="n-cart">${ICONS.shop}</span></div></article>`;

/** Fila delgada: miniatura vertical pequena, titulo, autor y etiqueta. */
const cardRow = n => `<article class="n-card row ${n.type}" data-id="${esc(n.id)}"><div class="n-thumb"${imgStyle(n)}></div>
    <div class="n-info"><div class="n-title">${esc(n.title)}</div>${meta(n)}</div>${tag(n)}</article>`;

const PER_PAGE = { announcement: 8, event: 8, tiktok: 5, store: 4 };

/**
 * Pagina de Noticias segun el filtro.
 * Todas: la noticia mas reciente de la tienda (ancha) + tres tarjetas; sin tienda, hasta 5 tarjetas.
 * Con 3 o menos se usan filas. Anuncios: filas (8 por pagina). TikTok: 5 verticales. Tienda: la mas nueva
 * grande y el resto en violeta.
 * @returns {{html:string, pages:number, page:number}}
 */
function newsPage(items, filter = 'all', page = 0) {
    const all = items.map(normalize);
    const wrap = (cls, inner) => `<div class="n-grid ${cls}">${inner}</div>`;

    if (filter === 'all') {
        const store = all.find(n => n.type === 'store');
        const rest = all.filter(n => n !== store);
        if (store && rest.length >= 3) return { pages: 1, page: 0, html: wrap('g4', cardWide(store, 'Tienda · lo más reciente') + rest.slice(0, 3).map(cardV).join('')) };
        if (store) return { pages: 1, page: 0, html: wrap('stack', `<div class="n-top">${cardWide(store, 'Tienda · lo más reciente')}</div>` + `<div class="n-grid rows">${rest.slice(0, 4).map(cardRow).join('')}</div>`) };
        const few = all.slice(0, 5);
        return { pages: 1, page: 0, html: few.length <= 3 ? wrap('rows', few.map(cardRow).join('')) : wrap('g5', few.map(cardV).join('')) };
    }

    const list = all.filter(n => n.type === filter);
    const per = PER_PAGE[filter] || 5;
    const pages = Math.max(1, Math.ceil(list.length / per));
    page = Math.min(Math.max(0, page), pages - 1);
    const slice = list.slice(page * per, page * per + per);

    if (filter === 'announcement' || filter === 'event') return { pages, page, html: wrap('rows', slice.map(cardRow).join('')) };
    if (filter === 'tiktok') return { pages, page, html: wrap('g5', slice.map(cardV).join('')) };
    // tienda: en la primera pagina, la mas nueva destacada
    if (page === 0) return { pages, page, html: wrap('g4', cardWide(slice[0], 'Nuevo · tienda') + slice.slice(1).map(cardV).join('')) };
    return { pages, page, html: wrap('g4', slice.map(cardV).join('')) };
}

/**
 * Inicio: la tarjeta grande y dos pequenas (`news`) y, aparte, el anuncio de la tienda con la foto de la publicacion (`shop`,
 * vacio si no hay anuncio de tienda). Devuelve { news, shop } en HTML.
 * Solo lo que el staff FIJO en Discord (`pinned`) se llama "destacado" y va primero (la mas nueva fijada en la grande).
 * Sin fijados, la grande es la noticia mas reciente de cualquier tipo, con su etiqueta normal y sin "destacado".
 * La tienda no compite con las noticias: tiene su sitio (a menos que ella misma este fijada, entonces compite como una fijada).
 */
function homeNews(items) {
    const all = items.map(normalize);
    const store = all.find(n => n.type === 'store' && !n.pinned);
    const rest = all.filter(n => n !== store);
    const ordered = [...rest.filter(n => n.pinned), ...rest.filter(n => !n.pinned)];   // `all` ya viene de la mas nueva a la mas vieja
    const [first, ...others] = ordered;
    const label = (n, more = '') => `${LABEL[n.type] || 'Anuncio'}${n.pinned ? ' · destacado' : ''}${more}`;
    let html = '';
    if (first) {
        html += `<div class="news-featured${first.pinned ? ' pinned' : ''}" data-id="${esc(first.id)}"><div class="news-thumb"${imgStyle(first)}></div><div class="news-body">
            <div class="news-label">${label(first)}</div>
            <div class="news-title">${esc(first.title)}</div>
            <div class="news-text">${esc(plain(first.body))}</div>
            <div class="news-meta">${esc([first.author, timeAgo(first.date)].filter(Boolean).join(' · '))}</div></div></div>`;
    }
    const minis = others.slice(0, 2);
    if (minis.length) {
        html += `<div class="news-row">${minis.map(n => `<div class="news-mini" data-id="${esc(n.id)}"><div class="news-thumb"${imgStyle(n)}></div><div class="news-body">
            <div class="news-label">${label(n)}</div><div class="news-title">${esc(n.title)}</div>
            <div class="news-meta">${esc([n.author, timeAgo(n.date)].filter(Boolean).join(' · '))}</div></div></div>`).join('')}</div>`;
    }
    return { news: html, shop: store ? homeShop(store) : '' };
}

/**
 * Anuncio de la tienda en Inicio: la foto entera a la izquierda y, de fondo, la misma foto desenfocada (cambia con cada
 * publicacion). Sin foto: icono de tienda sobre violeta.
 */
function homeShop(n) {
    const photo = imgStyle(n);
    return `<div class="news-store${photo ? '' : ' no-img'}" data-id="${esc(n.id)}">${photo ? `<div class="shop-bg"${photo}></div>` : ''}
        <div class="shop-img"${photo}>${photo ? '' : ICONS.shop}</div>
        <div class="shop-body"><span class="shop-tag">${ICONS.shop}Tienda</span>
        <div class="news-title">${esc(n.title)}</div><div class="news-text">${esc(plain(n.body))}</div>
        <div class="news-meta">${esc([n.author, timeAgo(n.date)].filter(Boolean).join(' · '))}</div></div></div>`;
}

export { timeAgo, EMPTY, homeNews, newsPage, normalize, mdToHtml, esc, cssUrl, ICONS, LABEL };
