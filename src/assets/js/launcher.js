// import panel
import Login from './panels/login.js';
import Home from './panels/home.js';
import Settings from './panels/settings.js';
import Console from './panels/console.js';
import News from './panels/news.js';
import Profile from './panels/profile.js';
import Install from './panels/install.js';
import { initBackground } from './utils/background.js';
import { FONDO_IMAGENES, initImageBackground } from './utils/backdrop.js';
import { setPerformance, savedMode } from './utils/performance.js';
import prefixConsole from './utils/logger.js';
import { openPopup, closePopup } from './utils/popup.js';

// import modules
import { config, changePanel, database, accountSelect, addAccount, setStatus, toast } from './utils.js';
const { Microsoft, Mojang } = require('minecraft-java-core');

// libs
const { ipcRenderer } = require('electron');
const fs = require('fs');
const os = require('os');
const { defaultMemoryGb } = require('./assets/js/core/quality.js');
const { resolveClientId } = require('./assets/js/core/remote.js');
const { renewAccount, selectedAccount } = require('./assets/js/core/accounts.js');
const pkg = require('../package.json');

class Launcher {
    async init() {
        this.initLog();
        console.log('Initializing Launcher...');
        this.shortcut()
        try { window.pcaBackground = (FONDO_IMAGENES ? initImageBackground : initBackground)(document.querySelector('.app')); } catch (e) { console.warn('fondo', e); }
        this.initFrame();
        this.db = new database();
        await this.initConfigClient();
        await this.migrateLauncherConfig();
        // Rendimiento del launcher (completo | ligero). Antes de crear los paneles: los visores 3D lo leen al nacer.
        try { const c0 = await this.db.readData('configClient'); setPerformance(savedMode(c0?.launcher_config)); } catch (e) { console.warn('Rendimiento:', e); }
        this.createPanels(Login, Home, Settings, Console, News, Profile, Install);
        this.initTabs();
        setStatus(config.server);
        // Primera ejecucion (configuracion recien creada): primero se elige donde instalar; despues, login o inicio.
        const first = await this.db.readData('configClient');
        if (first?.launcher_config?.installConfirmed === false) {
            changePanel('install');
            window.addEventListener('install-done', () => this.startLauncher(), { once: true });
        } else this.startLauncher();
    }

    initLog() {
        // Herramientas de desarrollo (F12 o Ctrl+Mayus+I): solo al desarrollar (NODE_ENV=dev), nunca en el launcher final.
        if (process.env.NODE_ENV === 'dev') {
            document.addEventListener('keydown', e => {
                if (e.ctrlKey && e.shiftKey && e.keyCode == 73 || e.keyCode == 123) {
                    ipcRenderer.send('main-window-dev-tools-close');
                    ipcRenderer.send('main-window-dev-tools');
                }
            })
        }
        prefixConsole(pkg.name, '#7289da')
    }

    shortcut() {
        document.addEventListener('keydown', e => {
            if (e.ctrlKey && e.keyCode == 87) {
                ipcRenderer.send('main-window-close');
            }
        })
    }


    initFrame() {
        console.log('Initializing Frame...')
        const frame = document.querySelector('.other .frame');
        frame.classList.toggle('hide')

        frame.querySelector('#minimize').addEventListener('click', () => {
            ipcRenderer.send('main-window-minimize');
        });

        const maximize = frame.querySelector('#maximize');
        maximize.addEventListener('click', () => {
            ipcRenderer.send('main-window-maximize');
            maximize.classList.toggle('icon-maximize')
            maximize.classList.toggle('icon-restore-down')
        });

        frame.querySelector('#close').addEventListener('click', () => {
            ipcRenderer.send('main-window-close');
        })
    }

    async initConfigClient() {
        console.log('Initializing Config Client...')
        let configClient = await this.db.readData('configClient')

        if (!configClient) {
            await this.db.createData('configClient', {
                account_selected: null,
                java_config: {
                    java_path: null,
                    java_memory: defaultMemoryGb(os.totalmem())
                },
                game_config: {
                    screen_size: {
                        width: 854,
                        height: 480
                    }
                },
                launcher_config: {
                    download_multi: 5,
                    duringGame: 'background',   // 'launcher' | 'log' | 'background' (ocultar todo)
                    quality: null,
                    install_dir: null,
                    installConfirmed: false,   // false = primera ejecucion: se muestra la pantalla de ubicacion
                    intelEnabledMac: true
                }
            })
        }
    }

    // "Durante el juego" (cuando el juego ya abrio): 'launcher' | 'log' (registros) | 'background' (ocultar todo).
    async migrateLauncherConfig() {
        const cc = await this.db.readData('configClient');
        if (!cc?.launcher_config || ['launcher', 'log', 'background'].includes(cc.launcher_config.duringGame)) return;
        cc.launcher_config.duringGame = 'background';
        await this.db.updateData('configClient', cc);
    }

    initTabs() {
        document.querySelectorAll('.topbar .tab').forEach(tab => {
            tab.addEventListener('click', () => changePanel(tab.dataset.panel));
        });
    }

    createPanels(...panels) {
        let panelsElem = document.querySelector('.panels')
        for (let panel of panels) {
            console.log(`Initializing ${panel.name} Panel...`);
            let div = document.createElement('div');
            div.classList.add('panel', panel.id)
            div.innerHTML = fs.readFileSync(`${__dirname}/panels/${panel.id}.html`, 'utf8');
            panelsElem.appendChild(div);
            new panel().init();
        }
    }

    // Renueva las cuentas guardadas (core/accounts.js decide cuales se quedan) y entra a Inicio o al inicio de sesion.
    async startLauncher() {
        const renew = {
            microsoft: async account => new Microsoft(await resolveClientId(config.client_id)).refresh(account),
            offline: name => Mojang.login(name)
        };
        const accounts = [], notices = [];
        for (const saved of await this.db.readAllData('accounts')) {
            openPopup({ title: 'Iniciando sesión', content: `Actualizando la cuenta ${saved.name}...`, background: false });
            const { status, account } = await renewAccount(saved, renew);
            if (status !== 'ok') console.warn(`[Account] ${saved.name}: ${status}`);
            if (status === 'expired') notices.push(`La sesión de ${saved.name} caducó: vuelve a iniciar sesión.`);
            if (status === 'stale') notices.push(`No se pudo actualizar la cuenta ${saved.name}. Se usa la guardada; revisa tu conexión.`);
            if (!account) {
                await this.db.deleteData('accounts', saved.ID);
                continue;
            }
            if (status === 'ok') await this.db.updateData('accounts', account, account.ID);
            await addAccount(account);
            accounts.push(account);
        }

        const { account_selected } = await this.db.readData('configClient');
        const selected = selectedAccount(accounts, account_selected);
        await this.db.editConfig(c => { c.account_selected = selected ? selected.ID : null; });
        if (selected) accountSelect(selected);

        closePopup()
        changePanel(selected ? 'home' : 'login');
        // Despues de cambiar de pantalla: cambiar de pantalla quita el aviso flotante.
        if (notices.length) toast(notices.join(' '), 'error', true);
    }
}

new Launcher().init();
