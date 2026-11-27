import { config, database, changePanel, toast } from '../utils.js'
import { currentLayout, currentPlayer } from '../utils/installlayout.js'
import showErrorDialog from '../utils/errordialog.js'
import { homeNews, EMPTY, timeAgo, esc } from '../utils/newsview.js'
import { createLogFile } from '../utils/logfile.js'
import { PlayerView } from '../utils/playerview.js'
import { setupInstance } from '../utils/instancesetup.js'
import { loadNews, newsState, failed, find as findNews } from '../utils/newsstore.js'
import { openNews } from '../utils/newsreader.js'
import { openDiscord, isDiscordInvite } from '../utils/discord.js'

const { shell, ipcRenderer } = require('electron')
const os = require('os')
const corePaths = require('./assets/js/core/paths.js')
const { serverAddress } = require('./assets/js/core/instance.js')
const { runTcg, finalizeTcg, isRunning: tcgIsRunning } = require('./assets/js/core/tcg.js')
const qualityCore = require('./assets/js/core/quality.js')
const { isOnline } = require('./assets/js/core/net.js')
// El juego y su registro viven en el proceso principal (core/session.js); aqui solo se leen por IPC.
const { gameLog } = require('./assets/js/core/gamelog-client.js')
const assetsManifest = require('./assets-manifest.json')
const skins = require('./assets/js/core/skins.js')
const playstats = require('./assets/js/core/playstats.js')

class Home {
    static id = "home";
    async init() {
        window.pcaHome = this   // lo usan la pantalla de carga (cancelar) y Ajustes (barra de tareas y cartas)
        this.db = new database();
        setupInstance()   // carpeta de skins y registro anterior
        this.news()
        this.socialLinks()
        document.querySelector('.play-instance').addEventListener('click', () => {
            // Mientras carga, el propio boton es "Cancelar" (en el mismo sitio donde se pulso JUGAR)
            if (this.cancelable()) return this.cancelGame()
            if (!this.playDisabled) this.startGame()
        })
        this.watchPlayState()
        this.loadStats()
        this.bust()
        this.watchGame()
        document.querySelector('.open-log').addEventListener('click', () => ipcRenderer.send('view:go', 'logs'))
        document.querySelector('.link-change-account').addEventListener('click', () => { changePanel('profile'); window.dispatchEvent(new CustomEvent('open-accounts')) })
        document.querySelector('.bar-create-log').addEventListener('click', () => this.createLog())
        // Contrato con el proceso principal (chat tecnico): si esta oculto, se pausan los temporizadores.
        ipcRenderer.on('launcher:hidden', () => { this.hidden = true })
        ipcRenderer.on('launcher:shown', () => { this.hidden = false; this.checkPlayState() })
    }

    // Busto 3D del jugador (la cabeza sigue al cursor). Sin 3D se queda la imagen.
    bust() {
        try {
            // Encuadre de la ficha del Inicio: apoyado en el borde de abajo y girado hacia sus datos.
            this.view = new PlayerView(document.querySelector('.bust-canvas'), { mode: 'bust', frame: { zoom: 1.45, y: -7.4, yaw: -0.32 } })
        } catch (e) {
            console.warn('Visor 3D:', e)
            document.querySelector('.bust-canvas').hidden = true
            document.querySelector('.bust').hidden = false
            return
        }
        window.addEventListener('player-change', e => { this.view.showCurrent(e.detail); this.loadStats() })
        skins.events.on('changed', () => this.view.showCurrent())
        window.addEventListener('panel-change', e => this.view.setActive(e.detail === 'home'))
        this.view.setActive(!!document.querySelector('.panels .home.active'))
    }

    async createLog(prepareError) {
        try {
            toast(await createLogFile(prepareError))
        } catch (e) {
            toast('No se pudo crear el informe: ' + (e.message || String(e)), 'error')
        }
    }

    // Resumen del jugador: horas jugadas y ultima vez.
    async loadStats() {
        const set = (sel, text) => { const el = document.querySelector(sel); if (el) el.textContent = text }
        try {
            const st = playstats.getStats(await currentPlayer(this.db))
            const h = st.hoursPlayed
            set('.info-hours', h >= 1 ? `${Math.floor(h)} h` : `${Math.round(h * 60)} min`)
            set('.info-last', st.lastPlayed ? timeAgo(st.lastPlayed) : '—')
        } catch (e) { console.warn('Resumen del jugador:', e) }
    }

    // Noticias: se comparten con la pantalla Noticias (utils/newsstore.js). Al pulsar una se abre su lectura.
    async news() {
        const box = document.querySelector('.news-list'), shop = document.querySelector('.home-shop')
        // Sin anuncio de tienda la ficha del jugador ocupa toda la columna.
        const show = (news, store = '') => {
            box.innerHTML = news
            shop.innerHTML = store
            shop.parentElement.classList.toggle('no-shop', !store)
        }
        const draw = () => {
            if (!newsState.items) return
            if (failed()) show(EMPTY.error())
            else if (!newsState.items.length) show(EMPTY.none())
            else { const h = homeNews(newsState.items); show(h.news, h.shop) }
        }
        const onClick = e => {
            const a = e.target.closest('[data-action]')?.dataset.action
            if (a === 'discord') openDiscord()
            if (a === 'retry') { box.innerHTML = ''; loadNews(true) }
            const card = e.target.closest('[data-id]')
            if (card) openNews(findNews(card.dataset.id))
        }
        box.addEventListener('click', onClick)
        shop.addEventListener('click', onClick)
        window.addEventListener('news-updated', draw)
        window.addEventListener('panel-change', e => { if (e.detail === 'home') loadNews() })
        loadNews()
    }

    socialLinks() {
        document.querySelectorAll('.soc').forEach(e => {
            e.addEventListener('click', () => {
                const url = e.dataset.url;
                if ('https:' !== new URL(url).protocol) return;
                if (isDiscordInvite(url)) return openDiscord();     // la app de Discord primero
                shell.openExternal(url)
            })
        })
    }

    // ---- Barra inferior ----
    // state: ready | busy | offline | ingame | error. El boton JUGAR y los textos siguen el diseno aprobado.
    setBar({ state = 'ready', title = '', sub = '', progress = null, label = 'PREPARANDO' } = {}, fromTask = false) {
        // Mientras dura una tarea de mantenimiento (mover, reparar) la barra es SUYA: ningun otro aviso (conexion, juego...) la pisa.
        if (this.task && !fromTask) return
        const q = sel => document.querySelector(sel)
        const box = q('.play-instance'), btn = q('.play-btn')
        box.classList.toggle('play-disabled', state === 'offline')
        box.classList.toggle('play-busy', state === 'busy')
        box.classList.toggle('play-ingame', state === 'ingame')
        // Cancelable: mientras se prepara o se abre el juego (antes de que se abra su ventana) JUGAR pasa a ser CANCELAR.
        const cancelable = state === 'busy' && !this.cancelling && !fromTask   // una tarea de mantenimiento no se cancela
        box.classList.toggle('play-cancelable', cancelable)
        this.playDisabled = state === 'offline' || state === 'busy' || state === 'ingame'
        btn.disabled = this.playDisabled && !cancelable
        // En "preparando" y "abriendo" los tres puntos avanzan (animacion de estilo, sin temporizadores).
        // Solo se reescribe lo que cambia: setBar() llega ~9 veces por segundo durante la carga y rehacer el elemento de los puntos
        // reiniciaba su animacion (que empieza en vacio) antes de que se viera ningun punto.
        const pl = q('.play-label'), lk = state === 'busy' ? (cancelable ? 'cancel' : 'busy|' + label) : state
        if (pl.dataset.k !== lk) {
            pl.dataset.k = lk
            if (state === 'busy' && cancelable) pl.innerHTML = '<svg class="cancel-ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>CANCELAR'
            else if (state === 'busy') pl.innerHTML = `${esc(label)}<span class="dots" aria-hidden="true"></span>`
            else pl.textContent = state === 'ingame' ? 'EN JUEGO' : 'JUGAR'
        }
        const t = q('.bar-title')
        if (state !== 'busy') delete t.dataset.h
        t.className = 'bar-title tone-' + ({ ready: 'ok', offline: 'warn', error: 'error' }[state] || 'text')
        if (state === 'ready') t.innerHTML = '<span><b>✓</b>Listo para jugar</span>'
        else if (state === 'offline') t.textContent = 'Sin conexión'
        else if (state === 'error') t.textContent = 'El juego se cerró inesperadamente'
        else {
            const h = progress != null
                ? `<span>${esc(title)}</span><span class="bar-pct">${Math.round(progress * 100)} %</span>`
                : `<span>${esc(title)}<span class="dots" aria-hidden="true"></span></span>`   // sin porcentaje: puntos que avanzan, para que se entienda que hay que esperar
            if (t.dataset.h !== h) { t.dataset.h = h; t.innerHTML = h }
        }
        q('.bar-sub').textContent = state === 'offline' ? 'Se necesita internet para jugar'
            : state === 'error' ? 'Crea el informe y envíalo al staff por Discord' : sub
        q('.bar-server')?.classList.toggle('show', state === 'ready')   // decide si se puede jugar: va junto a JUGAR
        const pb = q('.bar-progress')
        pb.classList.toggle('show', state === 'busy')
        pb.classList.toggle('indeterminate', state === 'busy' && progress == null)   // sin porcentaje: la barra se mueve
        pb.firstElementChild.style.width = progress != null ? `${Math.round(progress * 100)}%` : ''
        this.watchBusy(state, `${state}|${title}|${progress == null ? '' : Math.round(progress * 100)}`)
        q('.open-log').classList.toggle('show', state === 'ingame' || state === 'error')
        q('.bar-create-log').classList.toggle('show', state === 'error')
    }

    // Si la barra lleva 10 s sin cambiar, avisa que puede tardar (solo en "busy" y con la ventana visible).
    watchBusy(state, key) {
        if (key !== this.barKey) { this.barKey = key; this.barChangedAt = Date.now() }
        if (state !== 'busy') { clearInterval(this.busyTick); this.busyTick = null; return }
        if (this.busyTick) return
        this.barChangedAt = Date.now()
        this.busyTick = setInterval(() => {
            if (this.hidden) return
            if (Date.now() - this.barChangedAt >= 10000) {
                const sub = document.querySelector('.bar-sub')
                if (sub && !sub.textContent) sub.textContent = 'Esto puede tardar un momento. No cierres el launcher.'
            }
        }, 2000)
    }

    // ---- Tareas de mantenimiento (mover la instalacion, reparar archivos) ----
    // Mientras dura una, JUGAR pasa a "MOVIENDO..." / "REPARANDO..." (con los puntos animados, como "Preparando"), la barra de abajo
    // muestra el avance y cuanto falta, en TODAS las pantallas, y no se puede jugar hasta que llegue al 100 %.
    // Devuelve { update(fraccion), end() } o null si ya hay una tarea o el juego esta en marcha.
    beginTask({ label, title }) {
        if (this.task || window.pcaGameRunning) return null
        const task = { label, title, fraction: 0, sub: '' }
        this.task = task
        window.pcaTask = true
        // Sin tiempo restante (no se puede estimar con fiabilidad): solo el porcentaje y, debajo, el paso en curso.
        const render = () => this.setBar({ state: 'busy', label, title, progress: task.fraction, sub: task.sub }, true)
        render()
        this.notifyState()
        window.dispatchEvent(new Event('task-change'))
        return {
            update: (fraction, text) => {
                if (this.task !== task) return
                task.fraction = Math.min(1, Math.max(task.fraction, Number(fraction) || 0))   // la barra nunca retrocede
                if (typeof text === 'string') task.sub = text
                render()
            },
            end: () => {
                if (this.task !== task) return
                this.task = null
                window.pcaTask = false
                this.notifyState()
                window.dispatchEvent(new Event('task-change'))
                // La barra vuelve a su estado AL MOMENTO (con la ultima conexion conocida): no espera a la comprobacion de red ni a que la ventana
                // este visible. Despues se confirma con una comprobacion real.
                this.idleBar(this.online !== false)
                this.checkPlayState()
            }
        }
    }

    // Texto y barra de las cartas TCG que se bajan en segundo plano (pct null = sin barra).
    setCards(text, pct = null) {
        const box = document.querySelector('.bg-download')
        box.classList.toggle('show', !!text)
        box.querySelector('.bg-text').textContent = text || ''
        const mini = box.querySelector('.mini-progress')
        mini.classList.toggle('hide', pct == null)
        if (pct != null) mini.firstElementChild.style.width = `${pct}%`
    }

    // Estado en reposo: listo, sin conexion o con el aviso del ultimo cierre inesperado.
    idleBar(online) {
        if (!online) this.setBar({ state: 'offline' })
        else this.setBar({ state: this.crashed ? 'error' : 'ready' })
    }

    // Al proceso principal solo le interesa si hay una descarga de cartas dentro de esta ventana (el juego lo da la sesion).
    notifyState() {
        let tcg = !!this.tcgRunning
        try { tcg = tcg || tcgIsRunning() } catch (e) { /* sin estado de cartas */ }
        try { ipcRenderer.send('launcher:state', { tcg, task: !!this.task }) } catch (e) { console.warn('launcher:state', e) }
    }

    async checkPlayState() {
        if (this.starting || this.gameRunning || this.hidden) return
        const online = await isOnline()
        this.online = online
        if (this.task) return      // empezo una tarea mientras se comprobaba la conexion: la barra es suya
        this.idleBar(online)
    }

    watchPlayState() {
        this.checkPlayState()
        // Modo ligero: el sondeo de conexion se hace 6 veces menos (cada 2 minutos)
        let n = 0
        setInterval(() => { n++; if (!window.pcaLite || n % 6 === 0) this.checkPlayState() }, 20000)
        window.addEventListener('online', () => this.checkPlayState())
        window.addEventListener('offline', () => this.checkPlayState())
    }

    // ---- Descarga en segundo plano de los packs de CobbleTCG ----
    startTcgBackground(layout) {
        if (this.tcgRunning) return
        this.tcgRunning = true
        this.notifyState()
        // Al cancelar la carga del juego tambien se corta esta descarga (el .part se conserva y continua la proxima vez).
        const abort = new AbortController()
        this.tcgAbort = abort
        runTcg({
            layout, manifest: assetsManifest, signal: abort.signal,
            onProgress: p => {
                if (abort.signal.aborted) return
                const pct = Math.round((p.done / p.total) * 100)
                this.setCards(`Descargando cartas ${pct} %`, pct)
            }
        }).then(downloaded => {
            // Solo se avisa si se bajaron AHORA: si ya estaban, no hay nada que contar.
            this.setCards(downloaded && this.gameRunning ? 'Cartas descargadas. Se activan al reiniciar el juego' : '')
            if (!this.gameRunning) finalizeTcg({ layout, manifest: assetsManifest })
        }).catch(err => {
            if (abort.signal.aborted) return this.setCards('')   // la corto el jugador al cancelar: no es un fallo ni hay aviso
            console.warn('TCG:', err)
            this.setCards('Descarga de cartas pausada. Se reanuda al abrir el launcher')
        }).finally(() => { this.tcgRunning = false; if (this.tcgAbort === abort) this.tcgAbort = null; this.notifyState() })
    }

    // Corta la descarga de cartas en curso (si la hay). Se usa al cancelar la carga del juego.
    stopTcg() {
        if (this.tcgAbort) { try { this.tcgAbort.abort() } catch (e) { /* ya cortada */ } }
    }

    async startGame() {
        if (this.playDisabled || this.starting || this.task) return
        this.starting = true
        this.crashed = false
        this.gameOpen = false
        this.cancelReq = false
        this.cancelling = false
        this.busySince = Date.now()
        this.setBar({ state: 'busy', title: 'Preparando', progress: null })
        this.notifyState()

        try {
            const configClient = await this.db.readData('configClient')
            const authenticator = await this.db.readData('accounts', configClient.account_selected)
            const { instance } = config
            const layout = await currentLayout()
            const quality = configClient.launcher_config.quality || qualityCore.DEFAULT_QUALITY
            const ram = qualityCore.defaultMemoryGb(os.totalmem())
            const mem = configClient.java_config.java_memory

            const opt = {
                authenticator,
                timeout: 10000,
                path: layout.installDir,
                instance: instance.name,
                version: instance.minecraft_version,
                detached: true,
                downloadFileMultiple: configClient.launcher_config.download_multi,
                intelEnabledMac: configClient.launcher_config.intelEnabledMac,

                loader: {
                    type: instance.loader_type,
                    build: instance.loader_version,
                    enable: instance.loader_type !== 'none'
                },

                verify: false,

                ignored: [],

                java: {
                    path: configClient.java_config.java_path,
                },

                // log4jArg: sin esto el juego no escribe latest.log (ver core/paths.js)
                JVM_ARGS: [corePaths.log4jArg(layout.installDir)],
                // Entra directo al servidor: AutoModpack empieza a descargar los mods sin que el jugador haga nada.
                GAME_ARGS: ['--quickPlayMultiplayer', serverAddress()],

                screen: {
                    width: configClient.game_config.screen_size.width,
                    height: configClient.game_config.screen_size.height
                },

                memory: {
                    min: `${Math.min(mem.min || ram.min, mem.max || ram.max) * 1024}M`,
                    max: `${(mem.max || ram.max) * 1024}M`
                }
            }

            // QuickSkin tiene una sola configuracion por instancia: se deja lista la skin de ESTA cuenta (con el juego cerrado).
            try {
                await setupInstance()
                // Se espera la consulta a Mojang (cache 24 h, maximo ~8 s sin red y no lanza): sin ella no se fuerza la skin por defecto.
                const account = { name: authenticator?.name, uuid: authenticator?.uuid }
                await skins.refreshMojang(account)
                skins.prepareLaunch({ account })
            } catch (e) { console.warn('Skins: no se pudo preparar la cuenta', e) }

            // El proceso principal prepara la instancia, lanza el juego y lleva el registro. Al abrirse el juego aplica "Durante el juego"
            // (launcher, registros u ocultar todo); si el launcher queda oculto con el juego abierto, su ventana se destruye
            // (ahorra memoria) y se recrea al cerrarse el juego o desde la bandeja.
            if (this.cancelReq) return this.cancelDone()      // cancelado antes de pasar el trabajo al proceso principal
            const res = await ipcRenderer.invoke('game:start', { launch: opt, quality, duringGame: configClient.launcher_config.duringGame })
            if (!res || !res.ok) throw new Error((res && res.error) || 'No se pudo iniciar el juego')
            if (this.cancelReq) await ipcRenderer.invoke('game:cancel')   // se pidio cancelar justo al empezar
        } catch (err) {
            this.failPrepare(`No se pudo preparar el juego: ${err.message || err}`)
        }
    }

    // El boton JUGAR es "Cancelar" mientras carga. El primer segundo ignora clics: un doble clic al pulsar JUGAR no debe cancelar.
    cancelable() {
        return this.starting && !this.gameOpen && !this.cancelling && !this.cancelReq && Date.now() - (this.busySince || 0) > 1000
    }

    // Cancelar la carga: desde que se pulsa JUGAR hasta que se abre la ventana del juego (despues se cierra el juego como siempre).
    async cancelGame() {
        if (!this.starting || this.gameOpen || this.cancelling) return
        this.cancelling = true
        this.cancelReq = true
        this.stopTcg()      // las cartas (se bajan mientras carga el juego) tambien se detienen
        clearInterval(this.beat)
        this.setBar({ state: 'busy', label: 'CANCELANDO', title: 'Cancelando', progress: null })
        const id = gameLog.state && gameLog.state.id
        // Si el proceso principal aun no tiene la sesion (se esta preparando la cuenta), startGame() lo nota en su siguiente comprobacion.
        if (id === 'preparing' || id === 'loading') {
            try { await ipcRenderer.invoke('game:cancel') } catch (e) { console.warn('Cancelar:', e) }
        }
    }

    cancelDone() {
        this.cancelReq = false
        this.cancelling = false
        this.resetUi()
        if (document.body.dataset.view === 'console') changePanel('home')
    }

    // ---- Estado del juego: llega del proceso principal (core/session.js) por game:* ----
    watchGame() {
        gameLog.on('state', s => this.onGameState(s))
        gameLog.on('progress', p => this.onGameProgress(p))
        gameLog.on('phase', () => { if (this.gameRunning && !this.cancelling) this.showLoad() })
        gameLog.on('closed', c => this.onGameClosed(c))
        // Si la ventana se abre (o se recrea) con el juego ya en marcha, se retoma desde la foto actual.
        gameLog.ready.then(() => this.restoreGame()).catch(e => console.warn('Estado del juego:', e))
    }

    restoreGame() {
        const s = gameLog.state
        if (this.starting || this.gameRunning) return
        if (s.id === 'preparing' || s.id === 'loading' || s.id === 'running') {
            this.starting = true
            this.onGameState(s, true)
        } else if ((s.id === 'closed' || s.id === 'error') && gameLog.abnormal) {
            // El juego se cerro de forma anormal mientras esta ventana no existia: se muestra el aviso (los registros los abre el proceso principal).
            this.crashed = true
            this.checkPlayState()
        }
    }

    onGameState(s, restored = false) {
        if (this.cancelling && (s.id === 'preparing' || s.id === 'loading' || s.id === 'running')) return   // ya se esta cancelando
        if (s.id === 'cancelling') {
            this.cancelling = true
            clearInterval(this.beat)
            this.setBar({ state: 'busy', label: 'CANCELANDO', title: 'Cancelando', progress: null })
        } else if (s.id === 'preparing') {
            this.starting = true
            window.pcaGameRunning = true
            this.notifyState()
            if (restored) this.setBar({ state: 'busy', title: 'Preparando', progress: null })
        } else if (s.id === 'loading') {
            this.enterLoading(restored)
        } else if (s.id === 'running') {
            this.enterRunning(s.detail, restored)
        } else if (s.id === 'error' && s.detail && s.detail.kind === 'prepare') {
            // Los fallos del lanzamiento llegan despues por game:closed; este es el de la preparacion (sin pantalla de cierre).
            this.failPrepare(s.detail.message)
        }
    }

    onGameProgress(p) {
        if (gameLog.state.id !== 'preparing') return
        this.setBar({ state: 'busy', title: p.label, progress: p.total ? p.current / p.total : null })
    }

    // El propio juego ya escribe en su registro: al cargar siempre se ve el anillo (desde ahi se pasa a los registros y se vuelve).
    async enterLoading(restored) {
        if (!this.gameRunning) {
            this.gameRunning = true
            window.pcaGameRunning = true
            this.starting = true
            this.notifyState()
            clearInterval(this.beat)
            this.beat = setInterval(() => { if (this.gameRunning && !this.hidden && !this.gameOpen) this.showLoad() }, 1000)
            changePanel('console')
            // las cartas se bajan mientras se juega
            if (!restored) {
                try { this.startTcgBackground(await currentLayout()) } catch (e) { console.warn('TCG:', e) }
            }
        }
        this.showLoad()
    }

    async enterRunning(detail, restored) {
        const first = !this.gameOpen
        if (!this.gameRunning) { this.gameRunning = true; this.starting = true; window.pcaGameRunning = true }
        this.gameOpen = true
        this.openTs = (detail && detail.openedAt) || Date.now()
        this.notifyState()
        clearInterval(this.beat)
        clearInterval(this.uptime)
        this.uptime = setInterval(() => { if (!this.hidden && this.gameOpen) this.showLoad() }, 30000)
        this.showLoad()
        if (!first) return
        // El anillo ya no hace falta: se vuelve a Inicio ("EN JUEGO"). Que queda a la vista (launcher, registros u ocultar todo)
        // lo aplica el proceso principal al abrirse el juego (windows/views.js).
        if (document.body.dataset.view === 'console') changePanel('home')
    }

    // Una vez el juego arranca, la barra sigue lo que escribe el propio juego.
    showLoad() {
        const p = gameLog.phase, s = gameLog.silentSeconds()
        if (this.gameOpen || p.window || p.done) {
            const min = Math.floor((Date.now() - (this.openTs || Date.now())) / 60000)
            const since = min < 1 ? 'hace menos de un minuto' : min < 60 ? `hace ${min} min` : `hace ${Math.floor(min / 60)} h ${min % 60} min`
            this.setBar({ state: 'ingame', title: 'Juego en marcha', sub: `Jugando desde ${since}` })
        } else {
            this.setBar({ state: 'busy', label: 'ABRIENDO', title: p.label, progress: p.pct ? p.pct / 100 : null, sub: s != null && s >= 15 ? `Sin mensajes hace ${s} s` : '' })
        }
    }

    failPrepare(message) {
        this.resetUi()
        const error = String(message || '').replace(/^No se pudo preparar el juego: /, '')   // ya lo dice el titulo
        showErrorDialog({
            message: error,
            onRetry: () => this.startGame(),
            onLog: () => this.createLog(error)
        })
    }

    onGameClosed({ abnormal, cancelled }) {
        if (cancelled) this.stopTcg()       // por si la cancelacion llego desde otra ventana (anillo de carga)
        // La libreria no da el codigo de salida: el registro deduce si el cierre fue anormal por lo que escribio el juego.
        this.crashed = !!abnormal
        this.resetUi()
        this.loadStats()
        changePanel('home')
        // Cierre inesperado: el proceso principal muestra solo los registros con el error; el launcher queda en Inicio con el aviso.
        if (!this.tcgRunning) currentLayout().then(layout => finalizeTcg({ layout, manifest: assetsManifest })).catch(e => console.warn('TCG:', e))
    }

    resetUi() {
        this.cancelReq = false
        this.cancelling = false
        this.starting = false
        this.gameRunning = false
        this.gameOpen = false
        window.pcaGameRunning = false
        window.dispatchEvent(new Event('game-closed'))
        clearInterval(this.uptime)
        clearInterval(this.beat)
        this.checkPlayState()
        this.notifyState()
    }
}
export default Home;