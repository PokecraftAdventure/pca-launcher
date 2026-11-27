/**
 * Fondo por imagenes (una por momento del camino del jugador).
 *
 * Interruptor: FONDO_IMAGENES. En false el launcher vuelve al fondo dibujado por codigo (utils/background.js);
 * no hay que tocar nada mas.
 *
 * Cada imagen lleva un velo del color de fondo (--pa-bg) para que TODAS tengan la misma luz (~11 % de
 * luminancia media del fondo solo). El velo se calculo por imagen: L = L0 - v * (L0 - 4,3).
 * Mismo velo en las cuatro pestañas de Inicio (Noticias, Perfil, Ajustes tambien).
 */
export const FONDO_IMAGENES = true;

const DIR = 'assets/images/fondos/';
const FONDOS = {
  puerta:     { src: DIR + 'puerta.webp',     veil: 0.55 }, // ventana de arranque (400 x 500)
  campo:      { src: DIR + 'campo.webp',      veil: 0.50 }, // instalacion
  cruce:      { src: DIR + 'cruce.webp',      veil: 0.43 }, // inicio de sesion
  campamento: { src: DIR + 'campamento.webp', veil: 0.73 }, // Inicio, Noticias, Perfil y Ajustes
  umbral:     { src: DIR + 'umbral.webp',     veil: 0.44 }  // pantalla de carga (anillo) mientras abre el juego
};

// Vista (document.body.dataset.view) -> imagen. 'console' es la pantalla de carga.
const FONDO_POR_VISTA = {
  install: 'campo',
  login: 'cruce',
  home: 'campamento',
  news: 'campamento',
  profile: 'campamento',
  settings: 'campamento',
  console: 'umbral'
};

/**
 * Monta el fondo en `host`. opts.fixed = clave de FONDOS para una ventana con una sola imagen (arranque);
 * sin ella sigue a document.body.dataset.view. Devuelve la misma interfaz que initBackground para que
 * performance.js y launcher.js no cambien.
 */
export function initImageBackground(host, opts = {}) {
  const wrap = document.createElement('div');
  wrap.className = 'scene-bg scene-img';
  wrap.setAttribute('aria-hidden', 'true');
  const layers = {};
  const keys = opts.fixed ? [opts.fixed] : Object.keys(FONDOS);
  for (const k of keys) {
    const l = document.createElement('div');
    l.className = 'scene-layer';
    wrap.appendChild(l);
    layers[k] = l;
  }
  const veil = document.createElement('div');
  veil.className = 'scene-veil';
  wrap.appendChild(veil);
  host.prepend(wrap);

  // La imagen se pide y se decodifica antes de mostrarla: asi aparece con el fundido y sin parpadeo
  const ready = {};
  function ensure(key) {
    if (ready[key]) return ready[key];
    const l = layers[key], im = new Image();
    im.src = FONDOS[key].src;
    if (l) l.style.backgroundImage = `url("${FONDOS[key].src}")`;
    return (ready[key] = (im.decode ? im.decode() : Promise.resolve()).catch(() => { /* se muestra igual */ }));
  }

  let current = null;
  function show(key) {
    if (!FONDOS[key] || key === current) return;
    current = key;
    ensure(key).then(() => { if (current === key) for (const k in layers) layers[k].classList.toggle('on', k === key); });
    // Inline: gana a las reglas de velo por vista de launcher.css (opacidades y halos de la escena dibujada)
    veil.style.background = 'var(--pa-bg)';
    veil.style.opacity = String(FONDOS[key].veil);
  }

  if (opts.fixed) show(opts.fixed);
  else {
    const sync = () => show(FONDO_POR_VISTA[document.body.dataset.view] || 'campamento');
    new MutationObserver(sync).observe(document.body, { attributes: true, attributeFilter: ['data-view'] });
    sync();
  }
  return { setMotion() {}, setLite() {}, repaint() {} };
}
