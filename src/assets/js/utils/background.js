/**
 * Pokecraft Adventure Launcher
 * Fondo: escena nocturna en sombras (cerezo, pagoda, torii, volcan) dibujada por codigo, mas una capa
 * de petalos y luciernagas que se pausa sola. Espacio de diseno 1920x1080, ajustado a "cubrir" y anclado abajo.
 * Las capas estan DETRAS de toda la interfaz (z-index 0, sin eventos).
 */
import { isHidden, onHiddenChange } from './windowstate.js';

function mulberry32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const TAU = Math.PI * 2;

// ---------- ruido 1D suave ----------
function makeNoise(seed) {
  const r = mulberry32(seed), L = new Float32Array(1024); for (let i = 0; i < 1024; i++) L[i] = r();
  return x => { const i = Math.floor(x), f = x - i, a = L[((i % 1024) + 1024) % 1024], b = L[(((i + 1) % 1024) + 1024) % 1024], t = (1 - Math.cos(f * Math.PI)) / 2; return a + (b - a) * t; };
}
const N1 = makeNoise(11), N2 = makeNoise(23), N3 = makeNoise(5);
const fbm = (n, x) => (.5 * n(x) + .25 * n(x * 2.1 + 7) + .125 * n(x * 4.3 + 3) + .0625 * n(x * 8.7 + 1)) / .9375;
const ridged = (n, x) => 1 - Math.abs(2 * n(x) - 1);

const ridgeFar = x => 690 - 95 * Math.pow(ridged(N1, x * .0021), 1.4) - 34 * ridged(N1, x * .0063 + 5) + 18 * fbm(N2, x * .004);
const ridgeMid = x => 800 - 60 * Math.pow(ridged(N2, x * .003 + 2), 1.3) - 16 * ridged(N3, x * .011) + 10 * fbm(N1, x * .01);
const hillMidRaw = x => 890 - 170 * Math.exp(-Math.pow((x - 1500) / 440, 2)) + 34 * (fbm(N3, x * .004) - .5) + 6 * (fbm(N2, x * .02) - .5);
const T0 = hillMidRaw(1500);
const hillMid = x => { const d = Math.abs(x - 1500); if (d < 178) return T0; if (d < 300) { const t = (d - 178) / 122, k = t * t * (3 - 2 * t); return T0 + (hillMidRaw(x) - T0) * k; } return hillMidRaw(x); };
const hillFront = x => 1020 - 210 * Math.exp(-Math.pow((x - 400) / 560, 2)) + 22 * (fbm(N3, x * .006 + 9) - .5) + 5 * (fbm(N1, x * .03) - .5);
// volcan (perfil concavo, cima truncada)
const FUJI = { c: 1010, peak: 395, base: 800, w: 780 };
const fuji = x => { const d = Math.abs(x - FUJI.c); if (d < 38) return FUJI.peak + (d / 38) * 7 - 0; const t = Math.min((d - 38) / (FUJI.w - 38), 1); return FUJI.peak + 7 + (FUJI.base - FUJI.peak - 7) * Math.pow(t, .6) + 3 * (fbm(N1, x * .03) - .5); };

function ground(ctx, fn, color, x0, x1, step = 6) {
  ctx.fillStyle = color; ctx.beginPath(); ctx.moveTo(x0, 1300);
  for (let x = x0; x <= x1; x += step) ctx.lineTo(x, fn(x));
  ctx.lineTo(x1, fn(x1)); ctx.lineTo(x1, 1300); ctx.closePath(); ctx.fill();
}
function mist(ctx, y, h, a, color) {
  const g = ctx.createLinearGradient(0, y - h, 0, y + h * .4);
  g.addColorStop(0, `rgba(${color},0)`); g.addColorStop(.65, `rgba(${color},${a})`); g.addColorStop(1, `rgba(${color},0)`);
  ctx.fillStyle = g; ctx.fillRect(-300, y - h, 2520, h * 1.4);
}
function grass(ctx, fn, color, x0, x1, R, density, hMin, hMax) {
  ctx.fillStyle = color;
  for (let x = x0; x < x1; x += density * (.5 + R())) {
    const y = fn(x) + 2, h = hMin + R() * (hMax - hMin), lean = (R() - .5) * 6, w = 1 + R() * 1.6;
    ctx.beginPath(); ctx.moveTo(x - w, y); ctx.quadraticCurveTo(x + lean * .3, y - h * .6, x + lean, y - h); ctx.quadraticCurveTo(x + w * .2, y - h * .5, x + w, y); ctx.fill();
  }
}

// ---------- cedros/pinos pequenos en las crestas ----------
function conifer(ctx, x, y, h, color) {
  ctx.fillStyle = color; const w = h * .34;
  for (let i = 0; i < 4; i++) {
    const ty = y - h * (.22 + i * .2), tw = w * (1 - i * .2);
    ctx.beginPath(); ctx.moveTo(x - tw, ty + h * .2); ctx.lineTo(x, ty - h * .12); ctx.lineTo(x + tw, ty + h * .2); ctx.closePath(); ctx.fill();
  }
  ctx.fillRect(x - 1.2, y - h * .2, 2.4, h * .2);
}
function pine(ctx, x, y, s, color, R) {                 // pino japones con bandejas horizontales
  ctx.save(); ctx.translate(x, y); ctx.scale(s, s); ctx.fillStyle = color; ctx.strokeStyle = color; ctx.lineCap = 'round';
  ctx.lineWidth = 7; ctx.beginPath(); ctx.moveTo(0, 0); ctx.quadraticCurveTo(-10, -50, 6, -100); ctx.stroke();
  [[-6, -70, 46, 11], [14, -92, 38, 9], [-14, -108, 30, 8]].forEach(([px, py, hw, hh]) => {
    for (let i = 0; i < 9; i++) { const a = i / 8 * Math.PI - Math.PI; ctx.beginPath(); ctx.ellipse(px + Math.cos(a) * hw * .75, py + Math.sin(a) * hh * .5, hh * (.7 + R() * .3), hh * .6, 0, 0, TAU); ctx.fill(); }
    ctx.beginPath(); ctx.ellipse(px, py, hw * .85, hh * .65, 0, 0, TAU); ctx.fill();
  });
  ctx.restore();
}

// ---------- pagoda de 3 pisos con aleros curvos y base de piedra ----------
function roof(ctx, R, rt, h) {                          // alero: puntas hacia arriba, borde inferior concavo
  ctx.beginPath();
  ctx.moveTo(-R, -8);
  ctx.quadraticCurveTo(-R * .62, 8, -R * .5, 10); ctx.lineTo(R * .5, 10); ctx.quadraticCurveTo(R * .62, 8, R, -8);
  ctx.quadraticCurveTo(R * .62, -h * .45, rt, -h); ctx.lineTo(-rt, -h); ctx.quadraticCurveTo(-R * .62, -h * .45, -R, -8);
  ctx.closePath(); ctx.fill();
}
function pagoda(ctx, x, y, s, color, glow) {
  ctx.save(); ctx.translate(x, y); ctx.scale(s, s); ctx.fillStyle = color;
  // muro de contencion de la terraza y base de piedra escalonada
  ctx.beginPath(); ctx.moveTo(-150, 0); ctx.lineTo(-128, -40); ctx.lineTo(128, -40); ctx.lineTo(150, 0); ctx.closePath(); ctx.fill();
  ctx.fillRect(-120, -48, 240, 10);
  let cy = -48;
  const tiers = [[104, 62, 50], [82, 50, 46], [60, 38, 42]];
  tiers.forEach(([R, rt, bh], i) => {
    const bw = rt * .86;
    ctx.fillRect(-bw, cy - bh, bw * 2, bh);              // cuerpo del piso
    ctx.fillRect(-bw - 5, cy - bh - 2, bw * 2 + 10, 6);  // viga
    cy -= bh;
    ctx.save(); ctx.translate(0, cy); roof(ctx, R, rt * .52, 26); ctx.restore();
    cy -= 24;
    // ventanas encendidas
    if (glow) { ctx.fillStyle = glow; const n = i === 0 ? 3 : 2; for (let k = 0; k < n; k++) { const wx = (k - (n - 1) / 2) * 26; ctx.fillRect(wx - 5, cy + 24 + 8, 10, 17); } ctx.fillStyle = color; }
  });
  // remate (sorin)
  ctx.fillRect(-4, cy - 10, 8, 14);
  ctx.fillRect(-2, cy - 74, 4, 66);
  for (let i = 0; i < 6; i++) { ctx.beginPath(); ctx.ellipse(0, cy - 20 - i * 9, 9 - i * .9, 2.6, 0, 0, TAU); ctx.fill(); }
  ctx.restore();
}

// ---------- torii apoyado en la ladera ----------
function torii(ctx, x, fn, s, color) {
  const half = 62 * s, bx0 = x - half, bx1 = x + half;
  ctx.fillStyle = color;
  const top = fn(x) - 150 * s;
  const pillar = (px, dir) => { const gy = fn(px) + 12; ctx.beginPath(); ctx.moveTo(px - 9 * s, gy); ctx.lineTo(px - 7 * s + dir * 2 * s, top); ctx.lineTo(px + 7 * s + dir * 2 * s, top); ctx.lineTo(px + 9 * s, gy); ctx.closePath(); ctx.fill(); };
  pillar(bx0, 1); pillar(bx1, -1);
  // bases de piedra
  [bx0, bx1].forEach(px => { const gy = fn(px); ctx.beginPath(); ctx.moveTo(px - 15 * s, gy + 8); ctx.lineTo(px - 11 * s, gy - 12 * s); ctx.lineTo(px + 11 * s, gy - 12 * s); ctx.lineTo(px + 15 * s, gy + 8); ctx.closePath(); ctx.fill(); });
  ctx.fillRect(x - 78 * s, top + 38 * s, 156 * s, 9 * s);                          // nuki
  ctx.fillRect(x - 6 * s, top + 8 * s, 12 * s, 32 * s);                            // gaku
  ctx.fillRect(x - 92 * s, top - 2 * s, 184 * s, 9 * s);                           // shimaki
  ctx.beginPath(); ctx.moveTo(x - 120 * s, top - 22 * s);                           // kasagi
  ctx.quadraticCurveTo(x, top - 3 * s, x + 120 * s, top - 22 * s); ctx.lineTo(x + 112 * s, top - 8 * s);
  ctx.quadraticCurveTo(x, top + 8 * s, x - 112 * s, top - 8 * s); ctx.closePath(); ctx.fill();
}

function lantern(ctx, x, y, s, color) {
  ctx.save(); ctx.translate(x, y); ctx.scale(s, s); ctx.fillStyle = color;
  ctx.beginPath(); ctx.moveTo(-30, 4); ctx.lineTo(-22, -10); ctx.lineTo(22, -10); ctx.lineTo(30, 4); ctx.closePath(); ctx.fill();
  ctx.beginPath(); ctx.moveTo(-9, -10); ctx.lineTo(-7, -62); ctx.lineTo(7, -62); ctx.lineTo(9, -10); ctx.closePath(); ctx.fill();
  ctx.beginPath(); ctx.ellipse(0, -36, 14, 7, 0, 0, TAU); ctx.fill();
  ctx.beginPath(); ctx.moveTo(-28, -62); ctx.quadraticCurveTo(0, -70, 28, -62); ctx.lineTo(24, -72); ctx.lineTo(-24, -72); ctx.closePath(); ctx.fill();
  ctx.fillRect(-17, -104, 34, 32);
  ctx.beginPath(); ctx.moveTo(-42, -104); ctx.quadraticCurveTo(-18, -110, 0, -130); ctx.quadraticCurveTo(18, -110, 42, -104); ctx.quadraticCurveTo(0, -96, -42, -104); ctx.fill();
  ctx.beginPath(); ctx.arc(0, -137, 6, 0, TAU); ctx.fill();
  ctx.restore();
}

// ---------- cerezo ----------
function bez(p0, p1, p2, p3, n) {
  const pts = []; for (let i = 0; i <= n; i++) { const t = i / n, u = 1 - t; pts.push([u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0], u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1]]); } return pts;
}
function ribbon(ctx, pts, w0, w1) {                    // polilinea con ancho variable -> poligono relleno
  const L = [], Rr = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
    let dx = b[0] - a[0], dy = b[1] - a[1]; const m = Math.hypot(dx, dy) || 1; dx /= m; dy /= m;
    const w = (w0 + (w1 - w0) * (i / (pts.length - 1))) / 2;
    L.push([pts[i][0] - dy * w, pts[i][1] + dx * w]); Rr.push([pts[i][0] + dy * w, pts[i][1] - dx * w]);
  }
  ctx.beginPath(); ctx.moveTo(L[0][0], L[0][1]); for (let i = 1; i < L.length; i++) ctx.lineTo(L[i][0], L[i][1]);
  for (let i = Rr.length - 1; i >= 0; i--) ctx.lineTo(Rr[i][0], Rr[i][1]); ctx.closePath(); ctx.fill();
}
function twig(ctx, R, x, y, dir, len, w, depth) {
  const dx = Math.cos(dir), dy = Math.sin(dir), droop = len * (.1 + R() * .14);
  const p = bez([x, y], [x + dx * len * .35, y + dy * len * .35], [x + dx * len * .7, y + dy * len * .6 + droop * .5], [x + dx * len, y + dy * len + droop], 12);
  ribbon(ctx, p, w, Math.max(.9, w * .28));
  if (depth < 3 && len > 30) {
    const n = 2 + (R() < .4 ? 1 : 0);
    for (let k = 0; k < n; k++) {
      const t = .35 + R() * .6, q = p[Math.round(t * (p.length - 1))], side = k % 2 ? 1 : -1;
      twig(ctx, R, q[0], q[1], dir + side * (.5 + R() * .6), len * (.4 + R() * .25), w * .5, depth + 1);
    }
  }
}
function scallopCloud(ctx, R, cx, cy, hw, hh, base, rim) {
  const n = Math.round(TAU * (hw + hh) / 2 / 15), pts = [];
  for (let i = 0; i < n; i++) {
    const a = i / n * TAU, sy = Math.sin(a) > 0 ? .62 : 1;
    pts.push([cx + Math.cos(a) * hw * (.88 + R() * .1), cy + Math.sin(a) * hh * (.88 + R() * .1) * sy, hh * (.26 + R() * .34)]);
  }
  ctx.fillStyle = rim; pts.forEach(([x, y, r]) => { if (y < cy) { ctx.beginPath(); ctx.arc(x, y - 3.5, r, 0, TAU); ctx.fill(); } });
  ctx.fillStyle = base;
  pts.forEach(([x, y, r]) => { ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill(); });
  ctx.beginPath(); ctx.ellipse(cx, cy, hw * .9, hh * .74, 0, 0, TAU); ctx.fill();
  // bolsas interiores de luz sutil (da volumen en bandas)
  ctx.fillStyle = 'rgba(70,45,120,.22)';
  for (let i = 0; i < hw / 22; i++) { const x = cx + (R() - .5) * hw * 1.5, y = cy - hh * .25 + (R() - .5) * hh * .4; ctx.beginPath(); ctx.ellipse(x, y, 14 + R() * 18, 6 + R() * 6, 0, 0, TAU); ctx.fill(); }
  // flores sueltas
  ctx.fillStyle = 'rgba(200,150,235,.42)';
  for (let i = 0; i < hw / 10; i++) { const a = R() * TAU, d = Math.sqrt(R()); ctx.beginPath(); ctx.arc(cx + Math.cos(a) * hw * d, cy + Math.sin(a) * hh * d * .9, 1.6 + R() * 2, 0, TAU); ctx.fill(); }
}
function cherry(ctx, R, bx, by, s) {
  const WOOD = '#07040f', CAN = '#1a1040', RIM = '#33205f';
  ctx.save(); ctx.translate(bx, by); ctx.scale(s, s); ctx.fillStyle = WOOD; ctx.strokeStyle = WOOD;
  // masas traseras de copa
  scallopCloud(ctx, R, 10, -465, 210, 72, CAN, RIM);
  scallopCloud(ctx, R, -300, -300, 175, 56, CAN, RIM);
  scallopCloud(ctx, R, 330, -318, 195, 60, CAN, RIM);
  // raices ensanchadas y tronco torcido
  ctx.fillStyle = WOOD;
  ctx.beginPath(); ctx.moveTo(-78, 12); ctx.quadraticCurveTo(-34, -6, -34, -50); ctx.lineTo(34, -50); ctx.quadraticCurveTo(40, -4, 92, 12); ctx.lineTo(70, 16); ctx.quadraticCurveTo(10, 6, -60, 16); ctx.closePath(); ctx.fill();
  ribbon(ctx, bez([0, -40], [46, -100], [-60, -150], [-18, -215], 20), 78, 52);
  // ramas madre
  const left = bez([-22, -190], [-90, -215], [-210, -215], [-360, -262], 24);
  const right = bez([-12, -195], [90, -265], [270, -230], [430, -282], 24);
  const up = bez([-18, -205], [-70, -290], [10, -340], [50, -440], 20);
  ctx.fillStyle = WOOD;
  ribbon(ctx, left, 50, 11); ribbon(ctx, right, 48, 11); ribbon(ctx, up, 38, 9);
  [[left, -1], [right, 1], [up, 0]].forEach(([limb, side]) => {
    for (let k = 0; k < 4; k++) {
      const t = .25 + k * .2 + R() * .08, q = limb[Math.round(t * (limb.length - 1))];
      const dir = side === 0 ? -Math.PI / 2 + (k % 2 ? .75 : -.75) : (side < 0 ? Math.PI : 0) + (k % 2 ? -.6 : .55) * (side < 0 ? -1 : 1);
      twig(ctx, R, q[0], q[1], dir, 95 + R() * 70, 11 - k * 1.5, 0);
    }
  });
  // masas delanteras (cubren las puntas de las ramas)
  scallopCloud(ctx, R, -190, -200, 120, 40, CAN, RIM);
  scallopCloud(ctx, R, 210, -205, 130, 42, CAN, RIM);
  scallopCloud(ctx, R, -430, -250, 72, 30, CAN, RIM);
  scallopCloud(ctx, R, 500, -258, 82, 32, CAN, RIM);
  scallopCloud(ctx, R, 70, -352, 95, 34, CAN, RIM);
  scallopCloud(ctx, R, -150, -395, 62, 24, CAN, RIM);
  scallopCloud(ctx, R, 250, -412, 70, 26, CAN, RIM);
  scallopCloud(ctx, R, -330, -372, 56, 22, CAN, RIM);
  scallopCloud(ctx, R, 410, -178, 52, 21, CAN, RIM);
  scallopCloud(ctx, R, -80, -112, 46, 18, CAN, RIM);
  ctx.restore();
}

function drawScene(canvas, opts = {}) {
  const ctx = canvas.getContext('2d'), W = canvas.width, H = canvas.height;
  const R = mulberry32(7);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  const sky = ctx.createLinearGradient(0, 0, 0, H);
  sky.addColorStop(0, '#080620'); sky.addColorStop(.35, '#140d38'); sky.addColorStop(.6, '#2a1c60'); sky.addColorStop(.78, '#46307f'); sky.addColorStop(1, '#2a1c58');
  ctx.fillStyle = sky; ctx.fillRect(0, 0, W, H);
  const s = Math.max(W / 1920, H / 1080), oy = H - 1080 * s;
  // focusX: punto del diseno que queda en el centro de la ventana (por defecto el centro de la escena)
  const ox = Math.min(0, Math.max(W - 1920 * s, W / 2 - (opts.focusX || 960) * s));
  ctx.setTransform(s, 0, 0, s, ox, oy);
  let g = ctx.createRadialGradient(1050, 700, 0, 1050, 700, 900); g.addColorStop(0, 'rgba(217,70,239,.20)'); g.addColorStop(1, 'rgba(217,70,239,0)');
  ctx.fillStyle = g; ctx.fillRect(-300, -300, 2520, 1700);
  // estrellas
  for (let i = 0; i < 150; i++) { const x = -200 + R() * 2320, y = -300 + R() * 880, a = .12 + R() * .5, r = .5 + R() * 1.2; ctx.fillStyle = `rgba(214,200,255,${a})`; ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill(); }
  // luna suave
  const mx = 1600, my = 230;
  g = ctx.createRadialGradient(mx, my, 0, mx, my, 240); g.addColorStop(0, 'rgba(200,175,255,.13)'); g.addColorStop(.4, 'rgba(160,120,255,.05)'); g.addColorStop(1, 'rgba(160,120,255,0)');
  ctx.fillStyle = g; ctx.fillRect(mx - 260, my - 260, 520, 520);
  ctx.fillStyle = 'rgba(190,176,232,.34)'; ctx.beginPath(); ctx.arc(mx, my, 50, 0, TAU); ctx.fill();
  // nubes alargadas iluminadas por la luna
  [[1440, 300, 260, 12, .10], [1700, 340, 200, 9, .08], [900, 250, 300, 10, .07], [300, 190, 240, 9, .06]].forEach(([x, y, w, h, a]) => {
    ctx.fillStyle = `rgba(170,140,235,${a})`; ctx.beginPath(); ctx.ellipse(x, y, w, h, -.03, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.ellipse(x + w * .3, y - h * .8, w * .5, h * .7, 0, 0, TAU); ctx.fill();
  });
  // pajaros
  ctx.strokeStyle = 'rgba(9,6,22,.55)'; ctx.lineWidth = 2.2; ctx.lineCap = 'round';
  [[1240, 330, 1], [1300, 360, .8], [1195, 372, .7], [1360, 318, .6]].forEach(([x, y, k]) => { ctx.beginPath(); ctx.moveTo(x - 16 * k, y - 5 * k); ctx.quadraticCurveTo(x - 6 * k, y - 11 * k, x, y); ctx.quadraticCurveTo(x + 6 * k, y - 11 * k, x + 16 * k, y - 5 * k); ctx.stroke(); });

  // volcan lejano con casquete tenue
  ground(ctx, fuji, '#1f1650', FUJI.c - FUJI.w - 20, FUJI.c + FUJI.w + 20, 5);
  ctx.save(); ctx.beginPath(); ctx.rect(FUJI.c - 200, FUJI.peak - 10, 400, 80); ctx.clip();
  ground(ctx, fuji, 'rgba(165,145,235,.20)', FUJI.c - 200, FUJI.c + 200, 4); ctx.restore();
  mist(ctx, 760, 130, .2, '150,115,255');
  // cresta lejana y cresta media, con cedros diminutos
  ground(ctx, ridgeFar, '#1b1348', -300, 2220);
  mist(ctx, 760, 120, .16, '135,100,245');
  ground(ctx, ridgeMid, '#150e3b', -300, 2220);
  for (let x = -250; x < 2200; x += 14 + R() * 18) conifer(ctx, x, ridgeMid(x) + 4, 16 + R() * 20, '#120c33');
  mist(ctx, 830, 120, .17, '120,85,230');
  // colina derecha con pagoda, cedros y torii
  pagoda(ctx, 1500, hillMid(1500) + 6, 1.05, '#0a0620', 'rgba(150,115,255,.24)');
  pine(ctx, 1690, hillMid(1690) + 10, 1.15, '#0a0620', R); pine(ctx, 1290, hillMid(1290) + 10, .9, '#0a0620', R);
  ground(ctx, hillMid, '#0f0a29', -300, 2220);
  for (let x = 1020; x < 1960; x += 22 + R() * 30) { if (Math.abs(x - 1500) < 190) continue; conifer(ctx, x, hillMid(x) + 4, 34 + R() * 40, '#0b0720'); }
  torii(ctx, 1150, hillMid, .62, '#0a0620');
  grass(ctx, hillMid, '#0b0720', 1000, 1900, R, 7, 5, 15);
  mist(ctx, 905, 130, .16, '115,80,225');
  // colina frontal con cerezo y farol
  ground(ctx, hillFront, '#07040f', -300, 2220);
  grass(ctx, hillFront, '#07040f', -300, 2220, R, 5, 7, 26);
  lantern(ctx, 905, hillFront(905) + 6, 1.3, '#07040f');
  cherry(ctx, R, 400, hillFront(400) + 8, .86);
  grass(ctx, x => 1110, '#05030b', 1280, 2220, R, 9, 20, 70);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  g = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * .35, W / 2, H / 2, Math.max(W, H) * .75); g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,.5)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
}

// ---------- capa de movimiento: petalos y luciernagas ----------
const COL = ['216,170,240', '235,150,205', '190,140,250', '245,190,225'];

function createMotion(canvas) {
  const ctx = canvas.getContext('2d');
  let W = 0, H = 0, running = false, last = 0, acc = 0, raf = 0;
  const leaves = [], flies = [];
  const glow = document.createElement('canvas'); glow.width = glow.height = 48;
  { const g = glow.getContext('2d'), gr = g.createRadialGradient(24, 24, 0, 24, 24, 24); gr.addColorStop(0, 'rgba(210,190,255,1)'); gr.addColorStop(1, 'rgba(210,190,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, 48, 48); }
  const side = x => { const d = Math.min(Math.abs(x / W - .5) / .5, 1); return .1 + .9 * Math.pow(d, 1.6); };
  const mkLeaf = init => ({ x: (.05 + Math.random() * .34) * W, y: init ? Math.random() * H : (.3 + Math.random() * .2) * H, s: (3.5 + Math.random() * 4.5) * (H / 720), vy: (14 + Math.random() * 20) * (H / 720), vx: (12 + Math.random() * 18) * (H / 720), ph: Math.random() * TAU, sw: .7 + Math.random() * 1.1, amp: 12 + Math.random() * 22, rot: Math.random() * TAU, rs: (Math.random() - .5) * 1.8, flip: Math.random() * TAU, fs: 1 + Math.random() * 2.2, c: COL[(Math.random() * 4) | 0], a: .5 + Math.random() * .4 });
  const mkFly = () => ({ x: Math.random() * W, y: H * (.55 + Math.random() * .35), ph: Math.random() * TAU, sp: .15 + Math.random() * .3, r: (1.2 + Math.random() * 1.6) * (H / 720) });
  const petal = s => { ctx.beginPath(); ctx.moveTo(0, -s); ctx.bezierCurveTo(s * .95, -s * .7, s * .85, s * .55, 0, s); ctx.bezierCurveTo(-s * .85, s * .55, -s * .95, -s * .7, 0, -s); ctx.fill(); };

  function resize() {                                   // canvas.width/height ya fijados por el llamador
    W = canvas.width; H = canvas.height; leaves.length = 0; flies.length = 0;
    if (!W || !H) return;
    for (let i = 0; i < 20; i++) leaves.push(mkLeaf(true));
    for (let i = 0; i < 12; i++) flies.push(mkFly());
    draw(0);
  }
  function draw(t) {
    ctx.clearRect(0, 0, W, H);
    for (const f of flies) {
      const x = f.x + Math.sin(t * f.sp + f.ph) * 30, y = f.y + Math.cos(t * f.sp * 1.3 + f.ph) * 16;
      ctx.globalAlpha = (.35 + .65 * Math.max(0, Math.sin(t * .9 + f.ph * 3))) * side(x) * .9;
      const r = f.r * 6; ctx.drawImage(glow, x - r, y - r, r * 2, r * 2);
    }
    for (const l of leaves) {
      const x = l.x + Math.sin(t * l.sw + l.ph) * l.amp, e = Math.max(0, Math.min(1, l.y / (H * .1), (H - l.y) / (H * .15)));
      const a = l.a * side(x) * e; if (a < .01) continue;
      ctx.globalAlpha = a; ctx.fillStyle = `rgb(${l.c})`;
      ctx.save(); ctx.translate(x, l.y); ctx.rotate(l.rot + Math.sin(t * l.sw * 1.3 + l.ph) * .7); ctx.scale(1, Math.max(.18, Math.abs(Math.cos(l.flip + t * l.fs)))); petal(l.s); ctx.restore();
    }
    ctx.globalAlpha = 1;
  }
  function frame(ts) {
    if (!running) return;
    raf = requestAnimationFrame(frame);
    if (!last) last = ts; acc += (ts - last) / 1000; last = ts; if (acc < 1 / 30) return;
    const d = Math.min(acc, .1); acc = 0;
    for (const l of leaves) { l.y += l.vy * d; l.x += l.vx * d; l.rot += l.rs * d; if (l.y > H + 10 || l.x > W + 20) Object.assign(l, mkLeaf(false)); }
    draw(ts / 1000);
  }
  return {
    resize,
    start() { if (running) return; running = true; last = 0; acc = 0; raf = requestAnimationFrame(frame); },
    stop() { running = false; cancelAnimationFrame(raf); },
    clear() { ctx.clearRect(0, 0, canvas.width, canvas.height); }
  };
}

/**
 * Monta el fondo dentro de `host` (el contenedor de la interfaz): escena estatica (se dibuja una vez y al
 * cambiar de tamano), movimiento opcional y un velo que oscurece segun la pantalla (ver CSS).
 * opts: { motion: bool, focusX: numero, still: bool }  (still = sin capa de movimiento, para la ventana de arranque)
 */
export function initBackground(host, opts = {}) {
  const wrap = document.createElement('div');
  wrap.className = 'scene-bg';
  wrap.setAttribute('aria-hidden', 'true');
  wrap.innerHTML = '<canvas class="scene-static"></canvas>' + (opts.still ? '' : '<canvas class="scene-motion"></canvas>') + '<div class="scene-veil"></div>';
  host.prepend(wrap);
  const stat = wrap.querySelector('.scene-static'), mc = wrap.querySelector('.scene-motion');
  const motion = mc ? createMotion(mc) : null;
  let enabled = opts.motion !== false, visible = !isHidden(), reduced = false, timer = 0, lite = false, cap = 1920;
  try { const mq = matchMedia('(prefers-reduced-motion: reduce)'); reduced = mq.matches; if (mq.addEventListener) mq.addEventListener('change', e => { reduced = e.matches; apply(); }); } catch (e) { /* sin matchMedia */ }

  // Se dibuja a tamano reducido en pantallas grandes: la escena es suave y asi pesa menos en memoria.
  const fit = canvas => { const cw = canvas.clientWidth || window.innerWidth, ch = canvas.clientHeight || window.innerHeight, k = Math.min(1, cap / cw); canvas.width = Math.max(1, Math.round(cw * k)); canvas.height = Math.max(1, Math.round(ch * k)); };
  // Sin movimiento (ajuste, modo ligero o "reducir movimiento"): se detiene y el lienzo se reduce a 1 px para liberar memoria.
  const still = () => !enabled || lite || reduced;
  function apply() {
    if (!motion) return;
    if (!still() && visible) motion.start(); else motion.stop();
    if (still()) { motion.clear(); mc.width = 1; mc.height = 1; }
  }
  function paint() { fit(stat); drawScene(stat, { focusX: opts.focusX }); if (motion && !still()) { fit(mc); motion.resize(); } apply(); }
  window.addEventListener('resize', () => { clearTimeout(timer); timer = setTimeout(paint, 150); });
  // Visible / oculta la da el proceso principal (utils/windowstate.js); document.hidden no es fiable tras ocultar y mostrar.
  onHiddenChange(h => { visible = !h; apply(); });
  paint();
  return {
    setMotion(on) { enabled = !!on; paint(); },
    // Modo ligero: sin movimiento y con la escena dibujada a menor tamano (1280 px de ancho como maximo)
    setLite(on) { lite = !!on; cap = lite ? 1280 : 1920; paint(); },
    repaint: paint
  };
}
