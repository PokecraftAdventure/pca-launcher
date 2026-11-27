/**
 * Pokecraft Adventure Launcher
 *
 * Pestana "Tienda" (lado del renderer). La web NO se carga aqui: va en una vista nativa aparte que gestiona el proceso
 * principal (windows/storeView.js). Esta parte pone el marco y la navegacion (atras, adelante, recargar...), las
 * lengüetas "Menu" y "Jugar" del modo inmersivo y avisa de las medidas de lo que se destapa.
 * Se carga como script normal (launcher.html), despues de launcher.js.
 */
(() => {
    const { ipcRenderer } = require('electron')
    const storeTab = document.querySelector('.topbar .tab[data-panel="store"]')
    if (!storeTab) return

    const I = d => `<svg viewBox="0 0 24 24" aria-hidden="true">${d}</svg>`
    const ICON = {
        back: I('<path d="M15 5l-7 7 7 7"/>'),
        fwd: I('<path d="M9 5l7 7-7 7"/>'),
        reload: I('<path d="M20 12a8 8 0 1 1-2.6-5.9"/><path d="M20 4v5h-5"/>'),
        home: I('<path d="M4 11l8-7 8 7"/><path d="M6 10v9h12v-9"/>'),
        ext: I('<path d="M14 4h6v6"/><path d="M20 4l-9 9"/><path d="M18 14v5H5V6h5"/>'),
        close: I('<path d="M6 6l12 12M18 6L6 18"/>'),
        lock: I('<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>')
    }
    const NAV_H = 48, GAP = 8, HANDLE = 28
    const storeUrl = storeTab.dataset.url || ''     // la direccion de la tienda vive en la propia pestana

    // ---- marco y navegacion ----
    const layer = document.createElement('div')
    layer.id = 'store-layer'
    layer.hidden = true
    layer.innerHTML = `
      <div class="st-head" role="toolbar" aria-label="Navegación de la tienda">
        <button class="st-b st-ico" data-a="back" title="Atrás" aria-label="Atrás" disabled>${ICON.back}</button>
        <button class="st-b st-ico" data-a="fwd" title="Adelante" aria-label="Adelante" disabled>${ICON.fwd}</button>
        <button class="st-b st-ico" data-a="reload" title="Recargar" aria-label="Recargar">${ICON.reload}</button>
        <button class="st-b st-ico" data-a="home" title="Inicio de la tienda" aria-label="Inicio de la tienda">${ICON.home}</button>
        <div class="st-title"><span class="st-lock">${ICON.lock}</span><b>Tienda oficial</b><small class="st-host"></small></div>
        <span class="st-spin" aria-hidden="true"></span>
        <button class="st-b st-ico" data-a="ext" title="Abrir en el navegador" aria-label="Abrir en el navegador">${ICON.ext}</button>
        <button class="st-b st-close" data-a="close">${ICON.close}Cerrar</button>
      </div>
      <div class="st-slot"></div>`
    document.body.appendChild(layer)
    const slot = layer.querySelector('.st-slot')
    const host = layer.querySelector('.st-host')
    try { host.textContent = new URL(storeUrl).hostname } catch (e) { /* sin direccion: queda vacio */ }
    const $ = s => layer.querySelector(s)
    const tabs = () => [...document.querySelectorAll('.topbar .tab')]

    // ---- lengüetas (modo inmersivo): una pastilla con etiqueta en cada franja; dicen que hay detras ----
    const CHEV_UP = I('<path d="M6 15l6-6 6 6"/>')
    const PILL = {
        top: `<span>Menú</span>${I('<path d="M6 9l6 6 6-6"/>')}`,
        bottom: `${I('<path d="M7 5l12 7-12 7z"/>')}<span>Jugar</span>${CHEV_UP}`
    }
    for (const w of ['top', 'bottom']) {
        const h = document.createElement('div')
        h.className = 'st-hint st-hint-' + w
        h.innerHTML = `<div class="st-pill">${PILL[w]}</div>`
        document.body.appendChild(h)
    }

    // La lengüeta de abajo refleja el estado de JUGAR igual que Inicio (Preparando con puntos que avanzan, Abriendo, En juego...):
    // con la barra escondida no se veria nada del proceso. Lee lo que ya pinta la barra de Inicio, no lo recalcula.
    const bpill = document.querySelector('.st-hint-bottom .st-pill')
    let psig = ''
    function syncPlay() {
        const inst = document.querySelector('.play-instance'), t = document.querySelector('.bar-title'), pb = document.querySelector('.bar-progress')
        if (!inst || !t || !pb) return
        const busy = inst.classList.contains('play-busy'), game = inst.classList.contains('play-ingame')
        const off = !busy && !game && (t.classList.contains('tone-warn') || t.classList.contains('tone-error'))
        const pctEl = t.querySelector('.bar-pct'), pct = pctEl ? pctEl.textContent.trim() : ''
        const c = t.cloneNode(true); c.querySelectorAll('.bar-pct,.dots,b').forEach(n => n.remove())
        const title = c.textContent.trim()
        const w = busy && pb.firstElementChild ? pb.firstElementChild.style.width : ''
        const sig = [busy, game, off, title, pct, w].join('|')
        if (sig === psig) return          // solo se rehace cuando cambia algo: asi los puntos no reinician su animacion
        psig = sig
        bpill.classList.toggle('busy', busy); bpill.classList.toggle('ingame', game); bpill.classList.toggle('warn', off)
        if (!busy && !game && !off) { bpill.innerHTML = PILL.bottom; return }
        bpill.textContent = ''
        const txt = document.createElement('span'); txt.className = 'st-txt'
        txt.textContent = busy ? (title || 'Preparando') : (game ? (title || 'Juego en marcha') : title)
        if (busy && pct) txt.textContent += ' ' + pct
        if (busy && !pct) { const d = document.createElement('span'); d.className = 'dots'; d.setAttribute('aria-hidden', 'true'); txt.appendChild(d) }
        bpill.appendChild(txt)
        bpill.insertAdjacentHTML('beforeend', CHEV_UP)
        if (busy) { const p = document.createElement('i'); p.className = 'st-prog' + (w ? '' : ' ind'); if (w) p.style.width = w; bpill.appendChild(p) }
    }
    new MutationObserver(syncPlay).observe(document.querySelector('.bottombar'), { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['class', 'style'] })
    syncPlay()

    // ---- abrir y cerrar ----
    let seen = false          // ya se mostro la ayuda de primera vez (las barras visibles un rato antes de esconderse)
    try { seen = localStorage.getItem('pca.storeHintSeen') === '1' } catch (e) { /* sin almacenamiento */ }
    let prevTab = null, imm = false

    function place() {
        const p = document.querySelector('.panels').getBoundingClientRect()
        Object.assign(layer.style, { left: p.left + 'px', top: p.top + 'px', width: p.width + 'px', height: p.height + 'px' })
        const r = slot.getBoundingClientRect()
        return { x: r.left, y: r.top, width: r.width, height: r.height }
    }
    // alturas de lo que se destapa: salen del propio diseno de las barras
    function measure() {
        const tb = document.querySelector('.topbar').getBoundingClientRect()
        const bb = document.querySelector('.bottombar')
        const mb = parseFloat(getComputedStyle(bb).marginBottom) || 0
        document.documentElement.style.setProperty('--st-top', Math.ceil(tb.bottom) + 'px')
        return { topH: Math.ceil(tb.bottom) + 2 + NAV_H + GAP, botH: Math.ceil(bb.offsetHeight + mb) + GAP, handle: HANDLE, demo: !seen }
    }
    function open() {
        prevTab = document.querySelector('.topbar .tab.on')
        tabs().forEach(t => t.classList.toggle('on', t === storeTab))
        layer.hidden = false
        document.body.classList.add('store-open')
        ipcRenderer.send('store:open', { bounds: place(), layout: measure(), url: storeUrl })
    }
    function resetImmersive() {
        imm = false
        document.body.classList.remove('store-immersive', 'reveal-top', 'reveal-bottom')
    }
    // restoreTab: volver a marcar la pestana de antes (si el jugador elige otra, ella misma se marca)
    function close(restoreTab) {
        layer.hidden = true
        document.body.classList.remove('store-open')
        resetImmersive()
        ipcRenderer.send('store:hide')
        storeTab.classList.remove('on')
        if (restoreTab && prevTab) prevTab.classList.add('on')
    }
    // la ventana cambia de tamano al entrar y salir (vertical): recolocar la vista (en inmersivo lo hace el proceso principal)
    const sync = () => { if (!layer.hidden && !imm) ipcRenderer.send('store:bounds', place()) }
    new ResizeObserver(sync).observe(document.querySelector('.panels'))
    window.addEventListener('resize', sync)

    layer.addEventListener('click', e => {
        const b = e.target.closest('.st-b'); if (!b || b.disabled) return
        if (b.dataset.a === 'close') return close(true)
        ipcRenderer.send('store:nav', b.dataset.a)
    })
    ipcRenderer.on('store:state', (_, s) => {
        $('[data-a=back]').disabled = !s.back; $('[data-a=fwd]').disabled = !s.fwd
        layer.classList.toggle('loading', s.loading)
        if (s.loading) layer.classList.remove('offline')
        try { host.textContent = new URL(s.url).hostname } catch (e) { /* about:blank u otra: se deja */ }
    })
    ipcRenderer.on('store:offline', () => { host.textContent = 'Sin conexión'; layer.classList.add('offline') })
    ipcRenderer.on('store:immersive', (_, on) => {
        imm = on
        if (on && !seen) { seen = true; try { localStorage.setItem('pca.storeHintSeen', '1') } catch (e) { /* sin almacenamiento */ } }
        document.body.classList.toggle('store-immersive', on)
        if (!on) { document.body.classList.remove('reveal-top', 'reveal-bottom'); sync() }
    })
    ipcRenderer.on('store:reveal', (_, r) => {
        document.body.classList.toggle('reveal-top', r === 'top')
        document.body.classList.toggle('reveal-bottom', r === 'bottom')
    })

    // pestana "Tienda" del encabezado; cualquier otra pestana cierra la tienda
    document.addEventListener('click', e => {
        const t = e.target.closest('.topbar .tab')
        if (!t) return
        if (t === storeTab) { e.stopPropagation(); return layer.hidden ? open() : close(true) }
        if (!layer.hidden) close(false)
    }, true)
    // el launcher cambia de pantalla por su cuenta (p. ej. al empezar a cargar el juego: anillo): la tienda se cierra
    window.addEventListener('panel-change', () => { if (!layer.hidden) close(false) })
})()
