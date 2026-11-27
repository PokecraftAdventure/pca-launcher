const Store = require('electron-store');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const { ipcRenderer } = require('electron');

let dev = process.env.NODE_ENV === 'dev';

class database {
    constructor() {
        this.store = null;
        this.initialized = false;
    }

    async initStore() {
        if (!this.initialized) {
            const userDataPath = await ipcRenderer.invoke('path-user-data');
            this.store = new Store({
                name: 'launcher-data',
                cwd: userDataPath,
                encryptionKey: dev ? undefined : (await this.getKey(32, userDataPath)),
            });
            this.initialized = true;
        }
        return this.store;
    }

    async createData(tableName, data) {
        await this.initStore();
        let tableData = this.store.get(tableName, []);

        data.ID = Math.max(0, ...tableData.map(item => item.ID || 0)) + 1;
        tableData.push(data);
        this.store.set(tableName, tableData);

        return data;
    }

    async readData(tableName, key = 1) {
        await this.initStore();
        let tableData = this.store.get(tableName, []);
        return tableData.find(item => item.ID === key);
    }

    async readAllData(tableName) {
        await this.initStore();
        return this.store.get(tableName, []);
    }

    async updateData(tableName, data, key = 1) {
        await this.initStore();
        let tableData = this.store.get(tableName, []);
        const index = tableData.findIndex(item => item.ID === key);

        data.ID = key;
        if (index !== -1) tableData[index] = data;
        else tableData.push(data);
        this.store.set(tableName, tableData);
    }

    /** Lee la configuracion del launcher, aplica `change(config)` y la guarda. @returns {Promise<object>} la guardada */
    async editConfig(change) {
        const config = await this.readData('configClient');
        change(config);
        await this.updateData('configClient', config);
        return config;
    }

    async deleteData(tableName, key = 1) {
        await this.initStore();
        let tableData = this.store.get(tableName, []);
        tableData = tableData.filter(item => item.ID !== key);
        this.store.set(tableName, tableData);
    }

    async getKey(length, userDataPath) {
        const keyPath = path.join(userDataPath, 'key.txt');

        if (fs.existsSync(keyPath)) {
            return fs.readFileSync(keyPath, 'utf-8');
        } else {
            const key = crypto.randomBytes(length).toString('hex');
            fs.writeFileSync(keyPath, key);
            return key;
        }
    }
}

export default database;