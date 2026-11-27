/**
 * Pokecraft Adventure Launcher
 *
 * Configs (rutas relativas a config/) que no salen tal cual de Cobbleverse.
 */

// Van dentro del launcher (src/assets/defaults/config) y se escriben solo si faltan; sustituyen a las de Cobbleverse.
const LOCAL_CONFIGS = [
    'camerapture.client.json',
    'cobblemon-battle-extras.json',
    'iammusicplayer.toml',
    'mega_showdown/config.json',
    'otyacraftenginerenewed/client.toml',
    'voicechat/voicechat-client.properties',
    'xaero/minimap/profiles/cobbleverse.cfg',
    'xaerohud.txt'
];

// Configs de Cobbleverse de mods que la instancia no tiene: no se entregan.
const DROPPED_CONFIGS = [
    'PastureLoot.json',
    'advancementdisable.toml',
    'biome_replacer.properties',
    'brb.toml',
    'global_packs.toml',
    'lenientdeath.json5',
    'mobsbegone-blacklist.json',
    'nethermap.toml',
    'packetfixer.properties',
    'particular-common.toml',
    'pingwheel.json',
    'safepastures/safepastures.json',
    'stackdeobf.json',
    'zfastnoise.mixin.properties'
];

/** true si esa config de Cobbleverse no se descarga (la pone el launcher o ya no se entrega). */
const isReplacedOrDropped = rel => LOCAL_CONFIGS.includes(rel) || DROPPED_CONFIGS.includes(rel);

module.exports = { LOCAL_CONFIGS, isReplacedOrDropped };
