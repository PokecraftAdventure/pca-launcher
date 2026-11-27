/**
 * Pokecraft Adventure Launcher
 * Pantalla Noticias: filtros, tarjetas, paginacion y ventana de lectura.
 */
import { EMPTY, newsPage, timeAgo } from '../utils/newsview.js'
import { loadNews, newsState, failed, find } from '../utils/newsstore.js'
import { openNews } from '../utils/newsreader.js'
import { openDiscord } from '../utils/discord.js'


class News {
    static id = "news";
    async init() {
        this.filter = 'all'
        this.page = 0
        const root = document.querySelector('.news .container')
        root.querySelectorAll('.chip').forEach(chip => chip.addEventListener('click', () => this.setFilter(chip.dataset.filter)))
        root.addEventListener('click', e => {
            const a = e.target.closest('[data-action]')?.dataset.action
            if (a === 'discord') openDiscord()
            if (a === 'clear-filter') this.setFilter('all')
            if (a === 'retry') this.load(true)
            const card = e.target.closest('[data-id]')
            if (card) openNews(find(card.dataset.id))
            const pg = e.target.closest('[data-page]')
            if (pg && !pg.disabled) { this.page = Number(pg.dataset.page); this.render() }
        })
        window.addEventListener('panel-change', e => { if (e.detail === 'news') this.load() })
        window.addEventListener('news-updated', () => this.render())
    }

    async load(force = false) {
        document.querySelector('.news-page').classList.toggle('loading', !newsState.items)
        await loadNews(force)
        this.render()
    }

    setFilter(f) {
        this.filter = f
        this.page = 0
        document.querySelectorAll('.news .chip').forEach(c => c.classList.toggle('on', c.dataset.filter === f))
        this.render()
    }

    render() {
        const box = document.querySelector('.news-page')
        const pager = document.querySelector('.news-pager')
        const upd = document.querySelector('.news-updated')
        pager.innerHTML = ''
        upd.textContent = ''
        box.classList.remove('loading')
        if (!newsState.items) { box.innerHTML = ''; return }
        if (failed()) { box.innerHTML = EMPTY.error(); return }

        const all = newsState.items
        upd.textContent = newsState.fromCache ? 'Sin conexión · últimas noticias guardadas' : `Actualizado ${timeAgo(newsState.at)}`
        const has = this.filter === 'all' ? all.length : all.filter(n => n.type === this.filter).length
        if (!all.length) { box.innerHTML = EMPTY.none(); return }
        if (!has) { box.innerHTML = (EMPTY[this.filter] || EMPTY.none)(); return }

        const { html, pages, page } = newsPage(all, this.filter, this.page)
        this.page = page
        box.innerHTML = html
        if (pages > 1) pager.innerHTML = `<button class="pg" data-page="${page - 1}" ${page === 0 ? 'disabled' : ''} aria-label="Página anterior">‹</button>
            <span>Página ${page + 1} de ${pages}</span>
            <button class="pg" data-page="${page + 1}" ${page >= pages - 1 ? 'disabled' : ''} aria-label="Página siguiente">›</button>`
    }
}
export default News;
