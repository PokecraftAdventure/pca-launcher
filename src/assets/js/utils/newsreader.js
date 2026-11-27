/**
 * Pokecraft Adventure Launcher
 * Ventana de lectura de una noticia (imagen vertical a la izquierda, texto con formato de Discord a la derecha).
 * Las de TikTok no se leen aqui: abren el video en el navegador. Solo la de la tienda lleva "Ir a la tienda".
 */
import { mdToHtml, esc, cssUrl, timeAgo, normalize, LABEL, ICONS } from './newsview.js';

const { shell } = require('electron');

let modal = null;

function build() {
    modal = document.createElement('div');
    modal.className = 'nr-modal';
    modal.setAttribute('aria-hidden', 'true');
    modal.innerHTML = '<div class="nr-box" role="dialog"></div>';
    document.body.appendChild(modal);
    modal.addEventListener('click', e => {
        if (e.target === modal || e.target.closest('.nr-x')) return close();
        const link = e.target.closest('[data-link]');
        if (link) return shell.openExternal(link.dataset.link);
        if (e.target.closest('.nr-store')) goStore(modal.dataset.url);
    });
    document.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });
}

/** "Ir a la tienda": la tienda del launcher (pestana "Tienda"); una direccion de otro sitio sigue yendo al navegador. */
function goStore(url) {
    const tab = document.querySelector('.topbar .tab[data-panel="store"]');     // la direccion de la tienda vive en la pestana
    let own = !url;
    try { own = own || new URL(url).hostname === new URL(tab.dataset.url).hostname; } catch (e) { /* direccion rara: navegador */ }
    if (own) { close(); tab.click(); return; }
    shell.openExternal(url);
}

function close() {
    if (!modal) return;
    modal.classList.remove('open');
    modal.setAttribute('aria-hidden', 'true');
}

/** Abre una noticia: TikTok va al navegador; el resto se lee dentro del launcher. */
function openNews(raw) {
    if (!raw) return;
    const n = normalize(raw);
    if (n.type === 'tiktok' && /^https?:\/\//i.test(n.url)) return shell.openExternal(n.url);
    if (!modal) build();
    const store = n.type === 'store';
    modal.dataset.url = n.url || '';
    modal.classList.toggle('store', store);
    modal.querySelector('.nr-box').innerHTML = `
        <div class="nr-img"${n.image ? ` style="background-image:url('${cssUrl(n.image)}')"` : ''}></div>
        <div class="nr-main">
            <div class="nr-head"><span class="n-tag ${n.type}">${LABEL[n.type] || 'Anuncio'}</span><span class="nr-ago">${esc(timeAgo(n.date))}</span>
                <button type="button" class="nr-x" aria-label="Cerrar">×</button></div>
            <div class="nr-title">${esc(n.title)}</div>
            ${n.author ? `<div class="nr-author"><span class="n-av big">${esc(n.author.trim().charAt(0).toUpperCase())}</span><div><b>${esc(n.author)}</b></div></div>` : ''}
            <div class="nr-sep"></div>
            <div class="nr-body">${mdToHtml(n.body)}</div>
            ${store ? `<div class="nr-foot"><span>Las compras se hacen en nuestra tienda oficial</span><button type="button" class="nr-store">${ICONS.shop}Ir a la tienda</button></div>` : ''}
        </div>`;
    modal.classList.add('open');
    modal.setAttribute('aria-hidden', 'false');
    modal.querySelector('.nr-body').scrollTop = 0;
}

export { openNews };
