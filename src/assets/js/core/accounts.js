/**
 * Pokecraft Adventure Launcher
 *
 * Cuentas guardadas al abrir el launcher. Una cuenta solo se quita si ya no sirve: Microsoft rechaza la sesion
 * guardada, o el registro esta roto. Sin internet o ante cualquier otro fallo se conserva y se reintenta la proxima vez.
 */

// Respuesta de Microsoft cuando la sesion guardada caduco o se revoco: hay que volver a iniciar sesion.
const rejected = r => !!r && r.errorType === 'oauth2' && r.error === 'invalid_grant';

/**
 * @param {object} account cuenta guardada
 * @param {{microsoft:(account:object)=>Promise<object>, offline:(name:string)=>Promise<object>}} renew
 * @returns {Promise<{status:'ok'|'stale'|'expired'|'invalid', account:object|null}>}
 *   ok: al dia; stale: no se pudo renovar, sigue la guardada; expired / invalid: hay que quitarla (account null)
 */
async function renewAccount(account, { microsoft, offline }) {
    const premium = account.meta?.type === 'Xbox';
    const local = account.meta?.type === 'Mojang' && account.meta.online === false;
    if (account.error || (!premium && !local)) return { status: 'invalid', account: null };
    let fresh;
    try { fresh = premium ? await microsoft(account) : await offline(account.name); }
    catch (e) { fresh = { error: e.message || String(e) }; }
    if (rejected(fresh)) return { status: 'expired', account: null };
    if (!fresh || fresh.error) return { status: 'stale', account };
    return { status: 'ok', account: Object.assign(fresh, { ID: account.ID }) };
}

/** La cuenta elegida; si ya no esta (o no habia), la primera; null sin cuentas. */
const selectedAccount = (accounts, id) => accounts.find(a => a.ID === id) || accounts[0] || null;

module.exports = { renewAccount, selectedAccount };
