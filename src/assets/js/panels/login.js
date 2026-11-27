/**
 * Pokecraft Adventure Launcher
 *
 * Login con dos metodos a la vez: Microsoft (premium) y nombre de usuario
 * (no premium). Cuales se ofrecen lo decide "login" en launcher.config.json.
 */
const { Mojang } = require('minecraft-java-core');
const { ipcRenderer } = require('electron');
const { resolveClientId } = require('./assets/js/core/remote.js');

import { config, toast, database, changePanel, accountSelect, addAccount } from '../utils.js';
import { openPopup, closePopup } from '../utils/popup.js';

const NAME_RE = /^[A-Za-z0-9_]{3,16}$/;

class Login {
    static id = "login";

    async init() {
        this.db = new database();

        const methods = config.login || { microsoft: true, offline: true };
        this.cards = {
            choose: document.querySelector('.login-choose'),
            offline: document.querySelector('.login-offline-form')
        };
        this.microsoftBtn = document.querySelector('.method-microsoft');
        this.offlineBtn = document.querySelector('.method-offline');

        this.microsoftBtn.style.display = methods.microsoft ? '' : 'none';
        this.offlineBtn.style.display = methods.offline ? '' : 'none';

        this.microsoftBtn.addEventListener('click', () => this.loginMicrosoft());
        this.offlineBtn.addEventListener('click', () => this.show('offline'));

        document.querySelector('.offline-back').addEventListener('click', () => this.show('choose'));
        document.querySelector('.offline-enter').addEventListener('click', () => this.loginOffline());
        document.querySelector('.offline-name').addEventListener('keydown', e => {
            if (e.key === 'Enter') this.loginOffline();
        });

        document.querySelector('.cancel-home').addEventListener('click', () => {
            document.querySelector('.cancel-home').style.display = 'none';
            changePanel('profile');
        });

        // Los ajustes piden volver a la pantalla de eleccion al anadir cuenta.
        document.addEventListener('login:reset', () => this.show('choose'));

        this.show('choose');
    }

    show(name) {
        for (const [key, card] of Object.entries(this.cards)) {
            card.classList.toggle('shown', key === name);
        }
        if (name === 'offline') {
            this.setError('');
            const input = document.querySelector('.offline-name');
            input.focus();
        }
    }

    setError(text) {
        document.querySelector('.login-error').textContent = text;
    }

    async loginMicrosoft() {
        openPopup({ title: 'Iniciando sesión', content: 'Se abrirá la ventana de Microsoft...' });

        try {
            const clientId = await resolveClientId(config.client_id);   // el de status.json si lo hay; si no, el local
            const account = await ipcRenderer.invoke('Microsoft-window', clientId);
            if (!account || account === 'cancel') return closePopup();
            if (account.error) throw new Error(account.errorMessage || account.message || 'No se pudo iniciar sesión');

            await this.saveData(account);
            closePopup();
        } catch (err) {
            closePopup();
            toast(String(err.message || err), 'error', true);   // permanente: se cierra al pulsarlo
        }
    }

    async loginOffline() {
        const button = document.querySelector('.offline-enter');
        const name = document.querySelector('.offline-name').value.trim();

        if (!NAME_RE.test(name)) {
            return this.setError('El nombre debe tener de 3 a 16 caracteres: letras, números o guion bajo.');
        }

        button.disabled = true;
        this.setError('');

        try {
            const account = await Mojang.login(name);
            if (account.error) throw new Error(account.message || 'No se pudo crear la cuenta');

            // Si ya existe una cuenta no premium con ese nombre, se reutiliza.
            const existing = (await this.db.readAllData('accounts'))
                .find(a => a.meta?.online === false && a.name === name);
            if (existing) await this.db.deleteData('accounts', existing.ID);

            await this.saveData(account);
        } catch (err) {
            this.setError(String(err.message || err));
        } finally {
            button.disabled = false;
        }
    }

    async saveData(connectionData) {
        const configClient = await this.db.readData('configClient');
        const account = await this.db.createData('accounts', connectionData);
        configClient.account_selected = account.ID;

        await this.db.updateData('configClient', configClient);
        await addAccount(account);
        accountSelect(account);
        document.querySelector('.offline-name').value = '';
        changePanel('home');
    }
}

export default Login;
