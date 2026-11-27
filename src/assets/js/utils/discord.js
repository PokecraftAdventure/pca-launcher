/**
 * Pokecraft Adventure Launcher
 * Abrir Discord: primero la APP de Discord (si esta instalada) y, si no, el navegador. Lo usan todos los botones de Discord y el canal de tickets.
 * `discord://` es el protocolo de la app; si no hay nadie registrado para el, `shell.openExternal` falla y se abre la direccion web.
 */
const { shell } = require('electron');

const INVITE = 'INVITACION';
const TICKETS = '0/0';     // servidor/canal de tickets

async function openApp(appUrl, webUrl) {
    try { await shell.openExternal(appUrl); }
    catch (e) { await shell.openExternal(webUrl); }
}

/** Invitacion al servidor (si ya eres miembro, la app lo abre directamente). */
export function openDiscord() {
    return openApp(`discord://-/invite/${INVITE}`, `https://discord.gg/${INVITE}`);
}

/** Canal de tickets. */
export function openTickets() {
    return openApp(`discord://-/channels/${TICKETS}`, `https://discord.com/channels/${TICKETS}`);
}

/** true si la direccion es la invitacion de Discord del servidor (para botones que guardan la URL en `data-url`). */
export function isDiscordInvite(url) {
    try { const u = new URL(url); return u.protocol === 'https:' && u.hostname === 'discord.gg' && u.pathname === `/${INVITE}`; }
    catch (e) { return false; }
}
