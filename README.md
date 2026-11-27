# Pokecraft Adventure Launcher

Launcher de Minecraft para el servidor de Pokecraft Adventure (Minecraft 1.21.1, Fabric, Cobblemon).

Basado en [Selvania-Launcher](https://github.com/luuxis/Selvania-Launcher) de **Luuxis**, bajo la
Luuxis License v1.0 (ver `LICENSE.md`, sin modificar). Este código fuente se publica porque esa licencia lo exige
para cualquier versión distribuida.

> No está afiliado a Mojang, Microsoft ni a Cobbleverse. Minecraft es una marca de Mojang Studios.
> Los packs de recursos y shaders de Cobbleverse y de sus autores se descargan desde Modrinth, de donde
> los publican sus autores; este repositorio no los contiene.

## Sobre este repositorio

Contiene el código fuente del launcher. No incluye recursos (imágenes, fuentes, pantallas del juego ni
configuraciones) ni los datos del servidor: `src/launcher.config.json` trae valores de ejemplo.
Para compilar una versión propia hay que aportar esos archivos.

## Estructura

| Ruta | Contenido |
| --- | --- |
| `src/app.js` | Proceso principal |
| `src/assets/js/` | Núcleo, pantallas y ventanas |
| `src/assets/css/`, `src/panels/`, `src/*.html` | Interfaz |
| `src/launcher.config.json` | Configuración (valores de ejemplo) |
| `tools/build-assets-manifest.js` | Genera el manifiesto de archivos a descargar |
| `build.js` | Genera el instalador de Windows |
