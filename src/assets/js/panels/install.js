/**
 * Pokecraft Adventure Launcher
 *
 * Primera ejecucion: eleccion de la carpeta de instalacion. Siempre se instala dentro de una subcarpeta propia
 * ("Pokecraft Adventure"). Solo se muestra si launcher_config.installConfirmed === false (la crea initConfigClient
 * en una configuracion nueva); las instalaciones existentes no la ven.
 */
const { ipcRenderer } = require('electron');
const fs = require('fs');
const path = require('path');
const corePaths = require('./assets/js/core/paths.js');

import { database, appdata } from '../utils.js';
import { setupInstance } from '../utils/instancesetup.js';

const GB = 1073741824;

const fmt = bytes => {
    const g = bytes / GB;
    return `${g >= 10 ? Math.round(g) : Math.round(g * 10) / 10}`.replace('.', ',');
};

class Install {
    static id = 'install';

    async init() {
        this.db = new database();
        const q = s => document.querySelector(`.panel.install ${s}`);
        this.el = { path: q('.inst-path'), drive: q('.inst-drive'), free: q('.inst-free'), disk: q('.inst-disk'), used: q('.inst-bar .used'), need: q('.inst-bar .need'), warn: q('.inst-warn'), go: q('.inst-go'), pick: q('.inst-pick'), size: q('.inst-size') };
        // Tamano estimado y ubicacion recomendada salen del nucleo: base de Minecraft/Java/mods + lo que declara el manifiesto.
        this.need = corePaths.estimateInstallBytes(require('./assets-manifest.json'));
        this.el.size.textContent = fmt(this.need);

        this.target = corePaths.recommendedInstallDir(await appdata());

        this.el.pick.addEventListener('click', () => this.choose());
        this.el.go.addEventListener('click', () => this.confirm());
        window.addEventListener('panel-change', e => { if (e.detail === 'install') { this.render(); this.el.go.focus(); } });
        window.pcaInstall = this;   // utilidad de depuracion y de capturas
        this.render();
    }

    // Espacio libre y total de la unidad (bytes), o null si no se puede saber.
    space(p) {
        if (this.demoSpace) return this.demoSpace;
        try {
            let probe = path.resolve(p);
            while (!fs.existsSync(probe)) {
                const up = path.dirname(probe);
                if (up === probe) break;
                probe = up;
            }
            const st = fs.statfsSync(probe);
            return { free: Number(st.bavail) * Number(st.bsize), total: Number(st.blocks) * Number(st.bsize) };
        } catch (e) { return null; }
    }

    render() {
        const dir = path.dirname(this.target), last = path.basename(this.target);
        this.el.path.textContent = '';
        this.el.path.append(document.createTextNode(dir.endsWith(path.sep) ? dir : dir + path.sep));
        const b = document.createElement('b'); b.textContent = last; this.el.path.append(b);
        this.el.path.title = this.target;

        const sp = this.space(this.target);
        this.el.disk.hidden = !sp;
        let enough = true, msg = '', soft = false;
        // Reglas de carpeta del nucleo: los errores bloquean, los avisos solo informan.
        const check = corePaths.checkFolder(this.target);
        if (sp) {
            const root = path.parse(path.resolve(this.target)).root.replace(/[\\/]+$/, '');
            this.el.drive.textContent = root ? `Unidad ${root}` : 'Unidad';
            this.el.free.textContent = '';
            const bf = document.createElement('b'); bf.textContent = `${fmt(sp.free)} GB`;
            this.el.free.append(bf, document.createTextNode(` libres de ${fmt(sp.total)} GB`));
            const usedPct = Math.max(0, Math.min(100, ((sp.total - sp.free) / sp.total) * 100));
            const needPct = Math.max(1.5, Math.min(100 - usedPct, (this.need / sp.total) * 100));
            this.el.used.style.width = `${usedPct}%`;
            this.el.need.style.width = `${needPct}%`;
        }
        if (!check.ok) { enough = false; msg = check.errors[0]; }
        else if (sp && sp.free < this.need * 1.25) { enough = false; msg = 'No hay espacio suficiente en esta unidad. Elige otra carpeta.'; }
        else if (check.warnings.length) { msg = check.warnings[0]; soft = true; }
        this.el.warn.textContent = msg;
        this.el.warn.hidden = !msg;
        this.el.warn.classList.toggle('soft', soft);
        this.el.go.disabled = !enough;
    }

    async choose() {
        const dir = await ipcRenderer.invoke('select-folder');
        if (!dir) return;
        this.target = corePaths.withSubfolder(dir);      // si ya termina en la subcarpeta propia, se respeta
        this.render();
    }

    async confirm() {
        if (this.el.go.disabled) return;
        this.el.go.disabled = true;
        try {
            fs.mkdirSync(this.target, { recursive: true });
            await this.db.editConfig(c => { c.launcher_config.install_dir = this.target; c.launcher_config.installConfirmed = true; });
            setupInstance();
            window.dispatchEvent(new CustomEvent('install-done', { detail: this.target }));
        } catch (e) {
            this.el.warn.textContent = `No se pudo crear la carpeta: ${e.message || e}`;
            this.el.warn.hidden = false;
            this.el.go.disabled = false;
        }
    }
}

export default Install;
