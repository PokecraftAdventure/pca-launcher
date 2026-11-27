/**
 * Pokecraft Adventure Launcher
 *
 * Ajustes: memoria, instalacion, mantenimiento, soporte, calidad, resolucion y
 * "Al iniciar el juego". La gestion de cuentas vive en Perfil ("Mis cuentas").
 */

import { database, toast } from '../utils.js'
import { currentLayout } from '../utils/installlayout.js'
import { createLogFile } from '../utils/logfile.js'
import { setupInstance } from '../utils/instancesetup.js'
import { openTickets } from '../utils/discord.js'
import { setPerformance, recommendedMode, savedMode } from '../utils/performance.js'
import { lock, unlock } from '../utils/lock.js';
const { ipcRenderer } = require('electron');
const os = require('os');
const fs = require('fs');
const corePaths = require('./assets/js/core/paths.js');
const qualityCore = require('./assets/js/core/quality.js');
const { setQuality } = require('./assets/js/core/instance.js');
const { moveInstall } = require('./assets/js/core/move.js');
const { repair } = require('./assets/js/core/repair.js');
const { openFolder } = require('./assets/js/utils/openfolder.js');
const manifest = require('./assets-manifest.json');
const pcaPkg = require('../package.json');

class Settings {
    static id = "settings";
    async init() {
        this.db = new database();
        this.ui = {};   // actualizadores de cada control (los usa "Restablecer")
        // Aviso flotante global (utils/toast.js, capa por encima de barras y paneles). Solo errores, resultados finales y razones de un
        // boton inactivo: el avance de una tarea lo muestra la barra de abajo y no se repite aqui.
        this.say = (text, kind = 'ok', sticky = false) => toast(text, kind, sticky);
        document.querySelector('.launcher-version').textContent = pcaPkg.version;
        this.ram()
        this.resolution()
        this.startOptions()
        this.pcaSettings()
        document.querySelector('.open-registro').addEventListener('click', () => ipcRenderer.send('view:go', 'logs'))
        // Canal de tickets: abre la app de Discord si esta instalada; si no, el navegador.
        document.querySelector('.open-tickets').addEventListener('click', () => openTickets())
        // Los avisos de una visita anterior no deben quedarse al volver a Ajustes.
        // El aviso es global: al cambiar de pantalla (entrar o salir de Ajustes) se quita.
        window.addEventListener('panel-change', () => this.say(''));
    }

    // Memoria: una barra con topes en los valores permitidos (minimo = maximo). Las opciones dependen de la RAM del equipo;
    // la recomendada se marca bajo la barra. Se maneja con el raton y con el teclado (flechas, Inicio y Fin).
    async ram() {
        const totalGb = os.totalmem() / 1073741824;
        const rec = qualityCore.defaultMemoryGb(os.totalmem()).max;
        const limit = Math.max(2, Math.floor(totalGb * 0.8));
        const opts = [...new Set([2, 3, 4, 6, 8, 10, 12, 16].filter(n => n <= limit).concat(rec))].sort((a, b) => a - b);
        const range = document.querySelector('.ram-range');
        const ticks = document.querySelector('.ram-ticks');
        const last = Math.max(1, opts.length - 1);
        range.min = '0'; range.max = String(last); range.step = '1';
        ticks.textContent = '';
        opts.forEach((n, i) => {
            const t = document.createElement('button');
            t.type = 'button'; t.tabIndex = -1; t.className = 'tick' + (n === rec ? ' rec' : '');
            t.style.setProperty('--f', String(i / last));
            t.dataset.gb = String(n); t.textContent = String(n);
            if (n === rec) t.title = 'Recomendado para tu PC';
            t.addEventListener('click', () => { range.value = String(i); show(n); save(n); });
            ticks.appendChild(t);
        });
        document.querySelector('.ram-info').textContent =
            `Recomendado para tu PC: ${rec} GB · Tu PC tiene ${Math.trunc(totalGb * 10) / 10} GB`;

        const pick = v => opts.reduce((best, n) => (n <= v && n >= best ? n : best), opts[0]);   // la mayor opcion que no pase de v
        const show = v => {
            const i = Math.max(0, opts.indexOf(v));
            document.querySelector('.ram-value').textContent = `${v} GB`;
            range.value = String(i);
            range.style.setProperty('--f', String(i / last));
            range.setAttribute('aria-valuetext', `${v} GB`);
            ticks.querySelectorAll('.tick').forEach(t => t.classList.toggle('on', Number(t.dataset.gb) === v));
        };
        const save = v => this.db.editConfig(c => { c.java_config.java_memory = { min: v, max: v }; });
        const cc = await this.db.readData('configClient');
        const stored = Number(cc?.java_config?.java_memory?.max) || rec;
        const cur = pick(stored);
        show(cur);
        if (cur !== stored || cc?.java_config?.java_memory?.min !== cur) save(cur);   // una configuracion nueva trae un rango: queda fijo
        range.addEventListener('input', () => show(opts[Number(range.value)]));       // mientras se arrastra: solo muestra
        range.addEventListener('change', () => save(opts[Number(range.value)]));      // al soltar: guarda
        this.ui.ram = () => { show(rec); return save(rec); };
    }

    async resolution() {
        let configClient = await this.db.readData('configClient')
        let resolution = configClient?.game_config?.screen_size || { width: 1280, height: 720 };

        let width = document.querySelector(".width-size");
        let height = document.querySelector(".height-size");
        width.value = resolution.width;
        height.value = resolution.height;
        this.ui.resolution = () => { width.value = 854; height.value = 480; return this.db.editConfig(c => { c.game_config.screen_size = { width: 854, height: 480 }; }); };

        for (const [input, key] of [[width, 'width'], [height, 'height']]) {
            input.addEventListener('change', () => this.db.editConfig(c => { c.game_config.screen_size[key] = input.value; }));
        }
    }

    // "Durante el juego": launcher | log | background (ocultar todo). La pantalla de carga ya no se elige: siempre es el anillo.
    async startOptions() {
        const cc = await this.db.readData('configClient');
        const lc = cc.launcher_config;
        const bind = (sel, key, fallback, after, initial) => {
            const box = document.querySelector(sel);
            const mark = v => box.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.value === v));
            const choose = async v => {
                mark(v);
                await this.db.editConfig(c => { c.launcher_config[key] = v; });
                if (after) after(v);
            };
            mark(initial || lc[key] || fallback);
            box.addEventListener('click', e => { const b = e.target.closest('button'); if (b) choose(b.dataset.value); });
            this.ui[key] = () => choose(fallback);
        };
        // Al cargar siempre se ve el anillo; esto es lo que queda a la vista cuando el juego ya abrio: launcher | log | background (ocultar todo)
        bind('.seg-during', 'duringGame', 'background');
        // Rendimiento del launcher: completo | ligero. Se aplica al instante; "Restablecer" lo deja en el recomendado para el equipo.
        const recMode = recommendedMode(os.totalmem());
        const perfSub = async v => {
            const el = document.querySelector('.perf-sub');
            // Texto fijo y breve: el cliente solo necesita saber para quien es cada modo.
            const base = recMode === 'light' ? 'Ligero es lo ideal para tu PC.' : 'Elige Ligero si tu PC es modesta o notas lentitud.';
            let needs = false;
            try { needs = await ipcRenderer.invoke('perf-needs-restart', v); } catch (e) { /* sin aviso de reinicio */ }
            if (!needs) { el.textContent = base; return; }
            // El modo Ligero apaga la GPU al arrancar: se aplica al reiniciar el launcher (con el juego cerrado).
            el.textContent = 'Se aplica al reiniciar. ';
            if (window.pcaGameRunning) { el.textContent = 'Se aplica al reiniciar el launcher, cuando cierres el juego.'; return; }
            const b = document.createElement('button');
            b.type = 'button'; b.className = 'perf-relaunch'; b.textContent = 'Reiniciar ahora';
            b.addEventListener('click', () => { if (!window.pcaGameRunning) ipcRenderer.send('app-relaunch'); });
            el.appendChild(b);
        };
        const mode0 = savedMode(lc);
        perfSub(mode0);
        bind('.seg-perf', 'perfMode', recMode, v => {
            setPerformance(v); perfSub(v);   // el cambio se ve en el texto de la propia tarjeta: no hace falta aviso flotante
        }, mode0);
    }

    // ---- Pokecraft Adventure: calidad grafica, carpeta de instalacion y registro ----
    async pcaSettings() {
        let configClient = await this.db.readData('configClient');

        // Calidad
        let selected = configClient.launcher_config.quality || qualityCore.DEFAULT_QUALITY;
        const buttons = [...document.querySelectorAll('.quality-btn')];
        const mark = () => buttons.forEach(b => b.classList.toggle('on', b.dataset.quality === selected));
        mark();
        let suggested = qualityCore.DEFAULT_QUALITY;

        try {
            const gpus = await ipcRenderer.invoke('gpu-info');
            const s = qualityCore.suggest({ totalMemBytes: os.totalmem(), gpus });
            document.querySelector('.quality-suggestion').textContent =
                `Sugerencia: ${qualityCore.PRESETS[s.quality].label} · se aplica al abrir el juego`;
            suggested = s.quality;
        } catch (e) { /* sin sugerencia */ }

        const storeQuality = () => this.db.editConfig(c => { c.launcher_config.quality = selected; });
        this.ui.quality = () => { selected = suggested; mark(); return storeQuality(); };
        // Se guarda al instante al elegir (sin boton "Aplicar")
        const saveQuality = async () => {
            await storeQuality();
            if (window.pcaGameRunning) { this.say('Se aplicará la próxima vez que abras el juego.'); return; }
            try {
                setQuality(await currentLayout(), selected);
            } catch (e) { this.say('No se pudo aplicar: ' + (e.message || e), 'error'); }
        };
        buttons.forEach(b => b.addEventListener('click', () => {
            if (b.dataset.quality === selected) return;
            selected = b.dataset.quality; mark(); this.say('');
            saveQuality();
        }));

        // Carpeta de instalacion
        const dirText = document.querySelector('.install-dir-text');
        const showDir = dir => { dirText.textContent = dir; dirText.title = dir; };
        showDir((await currentLayout()).installDir);
        // En la primera ejecucion este panel nace antes de elegir la carpeta: se actualiza al confirmarla.
        window.addEventListener('install-done', e => showDir(e.detail));
        // Cambiar carpeta: la elegida recibe siempre la subcarpeta propia; se validan las reglas del nucleo y, si la
        // carpeta actual es compartida (tiene archivos que no son del launcher), se pide confirmar en el mismo boton.
        const changeBtn = document.querySelector('.install-dir-change');
        let pending = null, pendingTimer = null;
        const resetBtn = () => { clearTimeout(pendingTimer); pending = null; changeBtn.textContent = 'Cambiar'; changeBtn.classList.remove('danger'); };
        const doMove = async (from, target, opts) => {
            // La tarea de la barra de abajo (JUGAR = MOVIENDO... y el porcentaje) empieza con el primer aviso de progreso, una vez
            // pasadas las comprobaciones (carpeta vacia, espacio, confirmacion): si algo se rechaza, la barra no llega a cambiar.
            let task = null;
            const onProgress = p => {
                if (!task) task = window.pcaHome && window.pcaHome.beginTask({ label: 'MOVIENDO', title: 'Moviendo archivos' });
                if (task) task.update(p.fraction, p.text);
            };
            try {
                const r = await moveInstall(from, target, { ...opts, onProgress });
                // La copia ya esta verificada: desde este momento la instalacion buena es la NUEVA, aunque algo de la antigua no se pueda borrar.
                await this.db.editConfig(c => { c.launcher_config.install_dir = target; });
                setupInstance();
                showDir(target);
                if (r.leftovers && r.leftovers.length) {
                    this.say(`Carpeta cambiada. En la carpeta anterior quedaron ${r.leftovers.length} archivos que están en uso (¿un juego sin cerrar?). Ciérralo y borra «${from}» a mano.`, 'error');
                } else this.say('Carpeta cambiada.');
            } catch (e) {
                if (e && e.code === 'NEEDS_CONFIRM') {
                    pending = { from, target };
                    changeBtn.textContent = 'Mover todo'; changeBtn.classList.add('danger');
                    pendingTimer = setTimeout(() => { resetBtn(); this.say(''); }, 8000);
                    this.say(`${e.message} Pulsa «Mover todo» para continuar.`, 'error', true);
                } else this.say('No se pudo mover: ' + (e.message || e), 'error');
            } finally {
                if (task) task.end();
            }
        };
        changeBtn.addEventListener('click', async () => {
            if (window.pcaGameRunning) { this.say('Cierra el juego para cambiar la carpeta.', 'error'); return; }
            if (window.pcaTask) { this.say('Espera a que termine la tarea en curso.', 'error'); return; }
            if (pending) { const p0 = pending; resetBtn(); return doMove(p0.from, p0.target, { confirmShared: true }); }
            const chosen = await ipcRenderer.invoke('select-folder');
            if (!chosen) return;
            const target = corePaths.withSubfolder(chosen);
            const check = corePaths.checkFolder(target);
            if (!check.ok) { this.say(check.errors[0], 'error'); return; }
            const from = (await currentLayout()).installDir;
            if (check.warnings.length) this.say(check.warnings[0], 'ok');
            await doMove(from, target, {});
        });
        window.addEventListener('panel-change', () => resetBtn());
        // Mientras mueve o repara (aunque se vea desde otra pantalla), no se puede empezar otra tarea ni cambiar la carpeta.
        // Con los archivos a medio mover o reparar no hay carpeta ni registros fiables, ni se puede tocar la instalacion.
        const NEEDS_FILES = '.install-dir-change, .act-repair, .act-reset, .act-open, .send-log, .open-registro, .perf-relaunch, .pf-add, .pf-grid .sk-card, .pf-grid .sk-del';
        const lockTasks = () => {
            if (window.pcaTask) lock(NEEDS_FILES, 'Disponible cuando termine de moverse o repararse la instalación.');
            else unlock(NEEDS_FILES);
        };
        window.addEventListener('task-change', lockTasks);

        // Mantenimiento
        document.querySelector('.act-open').addEventListener('click', async () => {
            try {
                const l = await currentLayout();
                const target = fs.existsSync(l.instanceDir) ? l.instanceDir : (fs.existsSync(l.installDir) ? l.installDir : '');
                if (!target) return this.say('Todavía no hay nada instalado. La carpeta aparece después de jugar por primera vez.', 'error');
                const err = await openFolder(target);
                if (err) this.say('No se pudo abrir la carpeta: ' + err, 'error');
            } catch (e) { this.say('No se pudo abrir la carpeta: ' + (e.message || e), 'error'); }
        });

        document.querySelector('.act-repair').addEventListener('click', async () => {
            if (window.pcaGameRunning) return this.say('Cierra el juego para reparar los archivos.', 'error');
            if (window.pcaTask) return this.say('Espera a que termine la tarea en curso.', 'error');
            // La tarea de la barra de abajo: JUGAR = REPARANDO... con el porcentaje avanzado, hasta el 100 %.
            const task = window.pcaHome && window.pcaHome.beginTask({ label: 'REPARANDO', title: 'Reparando archivos' });
            if (!task) return this.say('No se puede reparar ahora mismo.', 'error');
            let startCards = null;      // si faltan cartas, se descargan en segundo plano DESPUES de terminar la tarea (JUGAR ya libre)
            try {
                const l = await currentLayout();
                const r = await repair({
                    layout: l, manifest,
                    onProgress: p => { if (typeof p.overall === 'number') task.update(p.overall, p.text); }
                });
                task.update(1);
                const nErr = r.errors.length;
                const fixed = r.fixed;
                // Mensajes cortos (se leen en pocos segundos): primero el resultado de Reparar y, si faltan cartas, que se bajan aparte.
                // `nErr` cuenta pasos que fallaron, no archivos: por eso el aviso de error no habla de "archivos que no se pudieron reparar".
                if (nErr) this.say(`Reparación incompleta${fixed ? ` (${fixed} ${fixed === 1 ? 'archivo reparado' : 'archivos reparados'})` : ''}. Revisa tu conexión y vuelve a intentarlo.`, 'error');
                else {
                    const cards = r.tcg.missing > 0;
                    if (cards) startCards = l;
                    const head = fixed ? (cards ? 'Archivos reparados.' : `Se ${fixed === 1 ? 'reparó 1 archivo' : `repararon ${fixed} archivos`}.`) : (cards ? 'Todo en orden.' : 'Todo en orden: no hizo falta reparar nada.');
                    this.say(cards ? `${head} Las cartas se descargan en segundo plano.` : head);
                }
            } catch (err) { this.say('No se pudo reparar: ' + (err.message || err), 'error'); }
            finally {
                task.end();
                if (startCards && window.pcaHome) { try { window.pcaHome.startTcgBackground(startCards); } catch (e) { console.warn('Cartas:', e); } }
            }
        });

        // Restablecer: pide confirmar en el mismo boton (sin ventana nueva); si no se confirma en 4 s, vuelve a su texto.
        const rst = document.querySelector('.act-reset');
        let rstTimer = null;
        const rstBack = () => { clearTimeout(rstTimer); rst.textContent = 'Restablecer'; rst.classList.remove('danger'); };
        rst.addEventListener('click', async () => {
            if (!rst.classList.contains('danger')) {
                rst.textContent = '¿Seguro?'; rst.classList.add('danger');
                rstTimer = setTimeout(rstBack, 4000);
                return;
            }
            rstBack();
            try {
                for (const k of ['ram', 'quality', 'resolution', 'duringGame', 'perfMode']) await this.ui[k]?.();
            } catch (err) { this.say('No se pudo restablecer: ' + (err.message || err), 'error'); }
        });
        window.addEventListener('panel-change', () => rstBack());

        // Registro para soporte (ZIP local; nada se envia solo)
        document.querySelector('.send-log').addEventListener('click', async () => {
            const btn = document.querySelector('.send-log');
            if (btn.disabled) return;
            btn.disabled = true;   // el resultado final es el unico aviso; mientras tanto el boton no admite otro clic
            try { this.say(await createLogFile()); }
            catch (e) { this.say(e.message || String(e), 'error'); }
            finally { btn.disabled = false; }
        });
    }
}
export default Settings;
