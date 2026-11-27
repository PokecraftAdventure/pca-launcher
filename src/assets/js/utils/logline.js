/**
 * Dibuja una linea del registro del juego con sus partes coloreadas (hora, hilo/nivel, logger y mensaje).
 * Lo usan la ventana de registros (log.js) y la pantalla de carga (panels/console.js) para que se vean igual.
 * `e` es una entrada de core/gamelog.js: { level, text, time, thread, tag, logger, msg }.
 * Las lineas sin hora (trazas de errores, la lista de mods...) se muestran como texto plano con el color de su nivel.
 *
 * `{ columns: true }` (ventana de registros): hora | nivel | origen | mensaje en columnas fijas, con el mensaje en su propia
 * columna (lo que se parte en varias lineas queda alineado debajo del mensaje). El origen es el logger o, si no hay, el hilo; el
 * detalle completo va en el texto emergente. Sin esa opcion (pantalla de carga) la linea sigue en una sola fila: `[hora] [hilo/NIVEL] (logger) mensaje`.
 */
const ORIGIN_MAX = 22;      // caracteres de la columna de origen (css: .c-src)

/** Recorta por el MEDIO un origen largo: lo que distingue a un hilo suele estar al final (`ForkJoinPool-2-worker-5` -> `ForkJoinPool-…worker-5`). */
function shortOrigin(s, max = ORIGIN_MAX) {
  s = String(s || '');
  if (s.length <= max) return s;
  const tail = Math.floor((max - 1) * 0.42), head = max - 1 - tail;
  return s.slice(0, head) + '…' + s.slice(s.length - tail);
}

export function lineNode(e, { columns = false } = {}) {
  const div = document.createElement('div');
  div.className = 'console-line ' + e.level + (columns ? ' cols' : '');
  const part = (cls, text) => { const s = document.createElement('span'); s.className = cls; s.textContent = text; return s; };
  if (e.time) {
    if (columns) {
      const src = shortOrigin(e.logger || e.thread || '');
      const lvl = part('c-tag c-lvl lvl-' + e.tag, e.tag || '');
      const origin = part('c-logger c-src', src);
      div.title = `[${e.thread}/${e.tag}]${e.logger ? ` (${e.logger})` : ''}`;
      // Los espacios entre columnas se quedan como texto para que, al seleccionar y copiar, salga una linea normal.
      div.append(part('c-time', e.time), ' ', lvl, ' ', origin, ' ', part('c-msg', String(e.msg).replace(/\s+$/, '')));
    } else {
      const parts = [part('c-time', `[${e.time}]`), ' ', part('c-tag lvl-' + e.tag, `[${e.thread}/${e.tag}]${e.logger ? '' : ':'}`)];
      if (e.logger) parts.push(' ', part('c-logger', `(${e.logger})`));
      parts.push(' ', part('c-msg', String(e.msg).replace(/\s+$/, '')));
      div.append(...parts);
    }
  } else if (columns) {
    div.classList.add('cont');
    div.append(part('c-msg', String(e.text).replace(/\s+$/, '')));
  } else {
    div.textContent = String(e.text).replace(/\s+$/, '');
  }
  return div;
}
