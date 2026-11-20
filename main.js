import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const canvasEl = document.getElementById('scene');
const loadingEl = document.getElementById('loading');
const errorEl = document.getElementById('error-box');
const resetBtn = document.getElementById('reset-view');
const autoBtn = document.getElementById('toggle-auto');
const hintEl = document.getElementById('hint');

const BAG = { width: 1.5, height: 1.88, depth: 0.36, seal: 0.1 };
const CW = 1280;
const CH = 1600;
const SANS = 'Montserrat, Arial, sans-serif';
const SCRIPT = 'Lobster, "Brush Script MT", Georgia, serif';
const TAU = Math.PI * 2;

function clamp(v, a, b) { return Math.min(b, Math.max(a, v)); }
function smoothstep(a, b, x) {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
}
function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function makeCanvas(w, h) {
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  return { canvas, ctx };
}
function roundedRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}
function textureFromCanvas(canvas, renderer, srgb = true) {
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  tex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.needsUpdate = true;
  return tex;
}
function paintFoilBase(ctx, w, h, back = false) {
  const base = ctx.createLinearGradient(w * .08, 0, w * .72, h);
  base.addColorStop(0, back ? '#78a94d' : '#73a94c');
  base.addColorStop(.3, '#58943b');
  base.addColorStop(.62, '#42822f');
  base.addColorStop(.84, '#356f28');
  base.addColorStop(1, '#285d21');
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, w, h);

  ctx.save();
  ctx.globalCompositeOperation = 'screen';
  const glow = ctx.createRadialGradient(w * .5, h * .24, w * .03, w * .5, h * .37, w * .78);
  glow.addColorStop(0, 'rgba(202,230,133,.33)');
  glow.addColorStop(.45, 'rgba(146,190,91,.1)');
  glow.addColorStop(1, 'rgba(85,135,58,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, w, h);

  ctx.strokeStyle = 'rgba(203,232,133,.13)';
  ctx.lineWidth = w * .12;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(-w * .08, h * .05);
  ctx.bezierCurveTo(w * .33, h * .11, w * .69, h * .22, w * 1.04, h * .39);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(34,83,24,.13)';
  ctx.lineWidth = w * .17;
  ctx.beginPath();
  ctx.moveTo(-w * .04, h * .73);
  ctx.bezierCurveTo(w * .38, h * .6, w * .64, h * .62, w * 1.08, h * .49);
  ctx.stroke();
  ctx.restore();

  const shade = ctx.createRadialGradient(w * .48, h * .47, w * .12, w * .5, h * .5, w * .73);
  shade.addColorStop(0, 'rgba(255,255,255,0)');
  shade.addColorStop(.64, 'rgba(20,64,15,0.02)');
  shade.addColorStop(1, 'rgba(14,47,11,.22)');
  ctx.fillStyle = shade;
  ctx.fillRect(0, 0, w, h);

  const rnd = mulberry32(810);
  ctx.save();
  ctx.globalAlpha = .045;
  for (let i = 0; i < 4200; i++) {
    const s = .6 + rnd() * 2.2;
    ctx.fillStyle = rnd() > .5 ? '#f6ffd8' : '#133e12';
    ctx.fillRect(rnd() * w, rnd() * h, s, s * .55);
  }
  ctx.restore();

  if (!back) {
    ctx.save();
    ctx.globalAlpha = .09;
    ctx.fillStyle = '#e8f6bb';
    ctx.beginPath();
    ctx.ellipse(w * .16, h * .43, w * .34, h * .055, -.28, 0, TAU);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(w * .86, h * .57, w * .26, h * .05, .32, 0, TAU);
    ctx.fill();
    ctx.restore();
  }
}

function drawRibbon(ctx, w, h) {
  ctx.save();
  ctx.translate(w * .225, h * .145);
  ctx.rotate(-.955);
  const bw = w * .334;
  const bh = h * .086;
  ctx.shadowColor = 'rgba(25,47,17,.32)';
  ctx.shadowBlur = 18;
  ctx.shadowOffsetY = 7;
  const g = ctx.createLinearGradient(0, -bh / 2, 0, bh / 2);
  g.addColorStop(0, '#e33836');
  g.addColorStop(.45, '#cf2329');
  g.addColorStop(1, '#a9141e');
  ctx.fillStyle = g;
  roundedRect(ctx, -bw / 2, -bh / 2, bw, bh, 7);
  ctx.fill();
  ctx.shadowColor = 'transparent';
  ctx.fillStyle = 'rgba(255,255,255,.14)';
  roundedRect(ctx, -bw / 2 + 4, -bh / 2 + 4, bw - 8, 15, 6);
  ctx.fill();
  ctx.fillStyle = 'rgba(104,7,14,.18)';
  ctx.fillRect(-bw / 2 + 2, bh / 2 - 15, bw - 4, 13);
  ctx.fillStyle = '#fff8ed';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `700 ${Math.round(w * .0285)}px ${SANS}`;
  ctx.fillText('ТЕПЕРЬ В НОВОЙ', 0, -bh * .185);
  ctx.fillText('УПАКОВКЕ', 0, bh * .205);
  ctx.restore();
}

function drawLogo(ctx, cx, cy, R, quiet = false) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(1.07, .95);

  ctx.shadowColor = quiet ? 'rgba(20,47,13,.18)' : 'rgba(23,52,15,.35)';
  ctx.shadowBlur = R * .18;
  ctx.shadowOffsetY = R * .07;
  const yellow = ctx.createRadialGradient(-R * .27, -R * .35, R * .05, 0, 0, R);
  yellow.addColorStop(0, '#fff3a2');
  yellow.addColorStop(.45, '#ffdc3f');
  yellow.addColorStop(.82, '#f7c62c');
  yellow.addColorStop(1, '#e7a916');
  ctx.fillStyle = yellow;
  ctx.beginPath();
  ctx.arc(0, 0, R, 0, TAU);
  ctx.fill();
  ctx.shadowColor = 'transparent';

  ctx.lineWidth = R * .036;
  ctx.strokeStyle = '#bb1d23';
  ctx.beginPath();
  ctx.arc(0, 0, R * .925, 0, TAU);
  ctx.stroke();

  ctx.save();
  ctx.beginPath();
  ctx.arc(0, 0, R * .89, 0, TAU);
  ctx.clip();
  ctx.fillStyle = 'rgba(239,179,19,.55)';
  ctx.beginPath();
  ctx.ellipse(-R * .32, -R * .2, R * .83, R * .38, -.7, 0, TAU);
  ctx.fill();
  ctx.fillStyle = 'rgba(255,246,163,.38)';
  ctx.beginPath();
  ctx.ellipse(-R * .2, -R * .42, R * .63, R * .21, -.38, 0, TAU);
  ctx.fill();
  ctx.fillStyle = '#ca2226';
  ctx.beginPath();
  ctx.ellipse(0, R * .82, R * .78, R * .42, 0, 0, TAU);
  ctx.fill();
  ctx.restore();

  const text = 'Lay’s';
  const size = R * 1.05;
  ctx.font = `400 ${size}px ${SCRIPT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  let m = ctx.measureText(text).width;
  const sx = Math.min(1.19, (R * 1.92) / m);
  ctx.translate(0, R * .025);
  ctx.scale(sx, 1);
  ctx.lineJoin = 'round';
  ctx.strokeStyle = '#9d111a';
  ctx.lineWidth = R * .075;
  ctx.strokeText(text, R * .03, R * .04);
  ctx.strokeStyle = '#d3242c';
  ctx.lineWidth = R * .036;
  ctx.strokeText(text, R * .03, R * .04);
  const white = ctx.createLinearGradient(0, -size * .45, 0, size * .42);
  white.addColorStop(0, '#fffef5');
  white.addColorStop(.7, '#fffdf0');
  white.addColorStop(1, '#f5e8d2');
  ctx.fillStyle = white;
  ctx.shadowColor = 'rgba(110,15,18,.32)';
  ctx.shadowBlur = R * .035;
  ctx.shadowOffsetY = R * .03;
  ctx.fillText(text, R * .03, R * .04);
  ctx.shadowColor = 'transparent';
  ctx.restore();

  ctx.save();
  ctx.translate(cx + R * 1.01, cy - R * .74);
  ctx.fillStyle = '#bd1f25';
  ctx.beginPath();
  ctx.arc(0, 0, R * .105, 0, TAU);
  ctx.fill();
  ctx.fillStyle = '#ffe775';
  ctx.font = `700 ${R * .125}px ${SANS}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('R', 0, R * .012);
  ctx.restore();
}

function drawMainTitle(ctx, w, h) {
  const text = 'Рифлёные';
  ctx.save();
  ctx.translate(w * .5, h * .416);
  ctx.font = `900 187px ${SANS}`;
  const measured = ctx.measureText(text).width;
  const sx = (w * .735) / measured;
  ctx.scale(sx, 1);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  ctx.shadowColor = 'rgba(24,58,16,.46)';
  ctx.shadowBlur = 15;
  ctx.shadowOffsetY = 8;
  ctx.fillStyle = 'rgba(30,68,20,.38)';
  ctx.fillText(text, 0, 5);
  ctx.shadowBlur = 3;
  ctx.shadowOffsetY = 2;
  ctx.strokeStyle = 'rgba(37,81,25,.34)';
  ctx.lineWidth = 5;
  ctx.strokeText(text, 0, 0);
  const fill = ctx.createLinearGradient(0, -115, 0, 115);
  fill.addColorStop(0, '#fffef8');
  fill.addColorStop(.65, '#faf6e6');
  fill.addColorStop(1, '#e9e1c8');
  ctx.fillStyle = fill;
  ctx.shadowColor = 'transparent';
  ctx.fillText(text, 0, 0);
  ctx.restore();

  ctx.save();
  ctx.translate(w * .5, h * .497);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `600 59px ${SANS}`;
  ctx.shadowColor = 'rgba(26,63,17,.5)';
  ctx.shadowBlur = 9;
  ctx.shadowOffsetY = 3;
  ctx.fillStyle = '#f8f4dc';
  ctx.fillText('«ЧИЛИ И ЛАЙМ»', 0, 0);
  ctx.restore();
}

function drawBadge(ctx, x, y, R) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(-.1);
  ctx.shadowColor = 'rgba(22,55,15,.28)';
  ctx.shadowBlur = 18;
  ctx.shadowOffsetY = 6;
  const fill = ctx.createRadialGradient(-R * .25, -R * .3, 1, 0, 0, R);
  fill.addColorStop(0, '#f7fae2');
  fill.addColorStop(.72, '#e5edc1');
  fill.addColorStop(1, '#ccd99c');
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.arc(0, 0, R, 0, TAU);
  ctx.fill();
  ctx.shadowColor = 'transparent';
  ctx.strokeStyle = 'rgba(255,255,255,.9)';
  ctx.lineWidth = R * .065;
  ctx.beginPath();
  ctx.arc(0, 0, R * .91, 0, TAU);
  ctx.stroke();
  ctx.strokeStyle = '#406c2f';
  ctx.lineWidth = R * .028;
  ctx.beginPath();
  ctx.arc(0, 0, R * .82, 0, TAU);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(64,108,47,.58)';
  ctx.lineWidth = R * .02;
  ctx.setLineDash([R * .055, R * .045]);
  ctx.beginPath();
  ctx.arc(0, 0, R * .74, 0, TAU);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = '#335f26';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `700 ${R * .145}px ${SANS}`;
  ctx.fillText('НАТУРАЛЬНЫЙ', 0, -R * .55);
  ctx.fillStyle = '#2f641f';
  ctx.font = `400 ${R * .36}px ${SCRIPT}`;
  ctx.save();
  ctx.rotate(-.06);
  ctx.fillText('Отборный', 0, -R * .065);
  ctx.restore();
  ctx.fillStyle = '#406c2f';
  ctx.font = `700 ${R * .137}px ${SANS}`;
  ctx.fillText('КАРТОФЕЛЬ', 0, R * .41);
  ctx.fillStyle = '#527b38';
  ctx.beginPath();
  ctx.ellipse(0, R * .68, R * .22, R * .035, 0, 0, TAU);
  ctx.fill();
  ctx.restore();
}

function drawLime(ctx, x, y, r, rot = 0) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot);
  ctx.shadowColor = 'rgba(17,47,12,.35)';
  ctx.shadowBlur = 22;
  ctx.shadowOffsetX = 8;
  ctx.shadowOffsetY = 14;
  ctx.fillStyle = '#255c1d';
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, TAU);
  ctx.fill();
  ctx.shadowColor = 'transparent';

  const rind = ctx.createRadialGradient(-r * .3, -r * .35, r * .2, 0, 0, r);
  rind.addColorStop(0, '#88b53d');
  rind.addColorStop(.66, '#528c27');
  rind.addColorStop(1, '#255719');
  ctx.fillStyle = rind;
  ctx.beginPath();
  ctx.arc(0, 0, r * .94, 0, TAU);
  ctx.fill();

  ctx.fillStyle = '#eff3cf';
  ctx.beginPath();
  ctx.arc(0, 0, r * .87, 0, TAU);
  ctx.fill();

  const flesh = ctx.createRadialGradient(-r * .2, -r * .28, r * .08, 0, 0, r * .84);
  flesh.addColorStop(0, '#e6f19b');
  flesh.addColorStop(.48, '#c8de68');
  flesh.addColorStop(.82, '#a5c34b');
  flesh.addColorStop(1, '#86a636');
  ctx.fillStyle = flesh;
  ctx.beginPath();
  ctx.arc(0, 0, r * .815, 0, TAU);
  ctx.fill();

  ctx.strokeStyle = 'rgba(254,255,230,.95)';
  ctx.lineWidth = Math.max(2, r * .022);
  const segments = 11;
  for (let i = 0; i < segments; i++) {
    const a = i / segments * TAU + .14;
    const inner = r * .07;
    ctx.beginPath();
    ctx.moveTo(Math.cos(a) * inner, Math.sin(a) * inner);
    ctx.lineTo(Math.cos(a) * r * .79, Math.sin(a) * r * .79);
    ctx.stroke();
  }
  for (let i = 0; i < segments; i++) {
    const a0 = i / segments * TAU + .14;
    const a1 = (i + 1) / segments * TAU + .14;
    ctx.fillStyle = i % 2 ? 'rgba(242,250,169,.12)' : 'rgba(124,158,40,.1)';
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, r * .79, a0, a1);
    ctx.closePath();
    ctx.fill();
  }

  const rnd = mulberry32(77);
  ctx.strokeStyle = 'rgba(255,255,215,.34)';
  ctx.lineWidth = 1.4;
  for (let i = 0; i < 120; i++) {
    const a = rnd() * TAU;
    const rr = r * (.14 + rnd() * .61);
    ctx.beginPath();
    ctx.moveTo(Math.cos(a) * rr, Math.sin(a) * rr);
    ctx.lineTo(Math.cos(a + .09) * (rr + r * .055), Math.sin(a + .09) * (rr + r * .055));
    ctx.stroke();
  }
  ctx.save();
  ctx.globalCompositeOperation = 'screen';
  const sheen = ctx.createLinearGradient(-r, -r, r * .45, r * .8);
  sheen.addColorStop(0, 'rgba(255,255,226,.22)');
  sheen.addColorStop(.42, 'rgba(255,255,255,.02)');
  sheen.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = sheen;
  ctx.beginPath();
  ctx.arc(0, 0, r * .81, 0, TAU);
  ctx.fill();
  ctx.restore();

  ctx.fillStyle = 'rgba(247,252,211,.9)';
  ctx.beginPath();
  ctx.arc(0, 0, r * .08, 0, TAU);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,223,.35)';
  ctx.lineWidth = r * .025;
  ctx.beginPath();
  ctx.arc(0, 0, r * .9, Math.PI * 1.03, Math.PI * 1.47);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(53,97,25,.4)';
  ctx.lineWidth = r * .016;
  ctx.beginPath();
  ctx.arc(0, 0, r * .96, 0, TAU);
  ctx.stroke();
  ctx.restore();
}

function chipOutline(ctx, rx, ry) {
  const n = 28;
  ctx.beginPath();
  for (let i = 0; i <= n; i++) {
    const a = i / n * TAU;
    const wobble = 1 + .075 * Math.sin(3 * a + .9) + .034 * Math.sin(7 * a - .4) + .014 * Math.sin(11 * a + 1.7);
    const px = Math.cos(a) * rx * wobble;
    const py = Math.sin(a) * ry * wobble;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
}

function drawChip(ctx, x, y, rx, ry, rot) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot);
  ctx.shadowColor = 'rgba(31,53,13,.34)';
  ctx.shadowBlur = 16;
  ctx.shadowOffsetY = 11;
  chipOutline(ctx, rx, ry);
  ctx.fillStyle = '#a96f20';
  ctx.fill();
  ctx.shadowColor = 'transparent';

  chipOutline(ctx, rx, ry);
  ctx.clip();
  const g = ctx.createLinearGradient(-rx, -ry, rx * .6, ry);
  g.addColorStop(0, '#ffd773');
  g.addColorStop(.34, '#f6bb4c');
  g.addColorStop(.72, '#dc932e');
  g.addColorStop(1, '#b7661c');
  ctx.fillStyle = g;
  ctx.fillRect(-rx * 1.2, -ry * 1.2, rx * 2.4, ry * 2.4);

  const innerShade = ctx.createRadialGradient(-rx * .25, -ry * .35, 4, 0, 0, rx * 1.1);
  innerShade.addColorStop(0, 'rgba(255,245,183,.32)');
  innerShade.addColorStop(.52, 'rgba(255,255,255,0)');
  innerShade.addColorStop(1, 'rgba(103,52,7,.32)');
  ctx.fillStyle = innerShade;
  ctx.fillRect(-rx * 1.2, -ry * 1.2, rx * 2.4, ry * 2.4);

  for (let i = -9; i <= 9; i++) {
    const yy = i / 9.2 * ry + Math.sin(i * 1.7) * ry * .012;
    ctx.strokeStyle = 'rgba(106,53,7,.38)';
    ctx.lineWidth = 4.2;
    ctx.beginPath();
    ctx.moveTo(-rx * 1.1, yy + Math.sin(i) * 8);
    ctx.bezierCurveTo(-rx * .46, yy - 16, rx * .35, yy + 21, rx * 1.1, yy - 8);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,233,142,.62)';
    ctx.lineWidth = 1.9;
    ctx.beginPath();
    ctx.moveTo(-rx * 1.1, yy - 4 + Math.sin(i) * 8);
    ctx.bezierCurveTo(-rx * .46, yy - 20, rx * .35, yy + 17, rx * 1.1, yy - 12);
    ctx.stroke();
  }
  ctx.strokeStyle = 'rgba(255,246,196,.24)';
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.moveTo(-rx * .8, ry * .35);
  ctx.quadraticCurveTo(-rx * .1, -ry * .08, rx * .72, -ry * .45);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(106,53,7,.14)';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(-rx * .82, ry * .5);
  ctx.quadraticCurveTo(-rx * .08, ry * .05, rx * .73, -ry * .31);
  ctx.stroke();
  const rnd = mulberry32(315);
  for (let i = 0; i < 34; i++) {
    const px = (rnd() * 2 - 1) * rx * .84;
    const py = (rnd() * 2 - 1) * ry * .72;
    ctx.fillStyle = i % 4 ? 'rgba(255,246,187,.78)' : 'rgba(86,51,9,.55)';
    ctx.beginPath();
    ctx.arc(px, py, .9 + rnd() * 2.1, 0, TAU);
    ctx.fill();
  }
  for (let i = 0; i < 5; i++) {
    ctx.fillStyle = 'rgba(142,43,19,.5)';
    ctx.beginPath();
    ctx.ellipse((rnd() * 2 - 1) * rx * .7, (rnd() * 2 - 1) * ry * .6, 3 + rnd() * 4, 1 + rnd() * 2, rnd() * TAU, 0, TAU);
    ctx.fill();
  }
  ctx.restore();

  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot);
  chipOutline(ctx, rx, ry);
  ctx.strokeStyle = 'rgba(255,226,135,.38)';
  ctx.lineWidth = 5;
  ctx.stroke();
  ctx.restore();
}

function drawChili(ctx, x, y, s, rot = 0) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  ctx.strokeStyle = 'rgba(30,48,12,.32)';
  ctx.lineWidth = s * .27;
  ctx.beginPath();
  ctx.moveTo(-s * .93, s * .17);
  ctx.bezierCurveTo(-s * .48, s * .35, s * .38, s * .17, s * .98, -s * .17);
  ctx.stroke();

  const body = ctx.createLinearGradient(-s, s * .2, s, -s * .3);
  body.addColorStop(0, '#7f090b');
  body.addColorStop(.26, '#bd1617');
  body.addColorStop(.58, '#e23320');
  body.addColorStop(.82, '#c31818');
  body.addColorStop(1, '#8b070b');
  ctx.strokeStyle = body;
  ctx.lineWidth = s * .235;
  ctx.beginPath();
  ctx.moveTo(-s * .93, s * .1);
  ctx.bezierCurveTo(-s * .48, s * .28, s * .38, s * .1, s * .98, -s * .24);
  ctx.stroke();

  ctx.strokeStyle = 'rgba(255,148,110,.48)';
  ctx.lineWidth = s * .055;
  ctx.beginPath();
  ctx.moveTo(-s * .72, -s * .005);
  ctx.bezierCurveTo(-s * .35, s * .13, s * .3, s * .02, s * .8, -s * .22);
  ctx.stroke();

  ctx.strokeStyle = 'rgba(81,3,7,.48)';
  ctx.lineWidth = s * .06;
  ctx.beginPath();
  ctx.moveTo(-s * .64, s * .22);
  ctx.bezierCurveTo(-s * .26, s * .36, s * .34, s * .19, s * .82, -s * .055);
  ctx.stroke();

  ctx.fillStyle = '#c7271b';
  ctx.beginPath();
  ctx.moveTo(s * .9, -s * .22);
  ctx.quadraticCurveTo(s * 1.13, -s * .3, s * 1.2, -s * .43);
  ctx.quadraticCurveTo(s * 1.02, -s * .32, s * .9, -s * .22);
  ctx.fill();

  ctx.strokeStyle = '#3c6e27';
  ctx.lineWidth = s * .1;
  ctx.beginPath();
  ctx.moveTo(-s * .91, s * .11);
  ctx.quadraticCurveTo(-s * 1.16, s * .1, -s * 1.28, -s * .09);
  ctx.stroke();

  ctx.fillStyle = '#527e2d';
  for (let i = 0; i < 3; i++) {
    ctx.save();
    ctx.translate(-s * .92, s * .1);
    ctx.rotate(-.5 + i * .48);
    ctx.beginPath();
    ctx.ellipse(s * .13, 0, s * .15, s * .04, 0, 0, TAU);
    ctx.fill();
    ctx.restore();
  }
  ctx.restore();
}

function scatterSeasoning(ctx, w, h) {
  const rnd = mulberry32(20261);
  for (let i = 0; i < 110; i++) {
    const x = w * (.2 + rnd() * .62);
    const y = h * (.62 + rnd() * .25);
    if (x < w * .46 && y > h * .86) continue;
    const s = 2 + rnd() * 7;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rnd() * TAU);
    ctx.fillStyle = i % 8 === 0 ? 'rgba(147,49,27,.74)' : 'rgba(255,252,232,.82)';
    ctx.shadowColor = 'rgba(25,55,14,.18)';
    ctx.shadowBlur = 2;
    ctx.beginPath();
    if (i % 3 === 0) {
      ctx.moveTo(-s, -s * .35);
      ctx.lineTo(0, -s * .7);
      ctx.lineTo(s, s * .1);
      ctx.lineTo(-s * .15, s * .65);
    } else {
      ctx.moveTo(-s * .7, -s * .4);
      ctx.lineTo(s * .7, -s * .6);
      ctx.lineTo(s * .5, s * .6);
      ctx.lineTo(-s * .6, s * .4);
    }
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
}

function drawMass(ctx, w, h) {
  ctx.save();
  ctx.translate(w * .087, h * .91);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.font = `700 202px ${SANS}`;
  const fill = ctx.createLinearGradient(0, -100, 0, 100);
  fill.addColorStop(0, 'rgba(255,255,247,.94)');
  fill.addColorStop(.55, 'rgba(232,236,220,.88)');
  fill.addColorStop(1, 'rgba(184,196,173,.82)');
  ctx.shadowColor = 'rgba(22,54,14,.46)';
  ctx.shadowBlur = 16;
  ctx.shadowOffsetY = 7;
  ctx.fillStyle = fill;
  ctx.fillText('105', 0, 0);
  const m = ctx.measureText('105').width;
  ctx.font = `600 98px ${SANS}`;
  ctx.fillText('г', m + 21, 32);
  ctx.restore();

  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `500 13px ${SANS}`;
  ctx.fillStyle = 'rgba(247,250,233,.5)';
  ctx.fillText('ООО «ФРИТО ЛЕЙ МАНУФАКТУРИНГ» · СДЕЛАНО В РОССИИ', w * .5, h * .978);
  ctx.restore();
}

function createFrontCanvas() {
  const { canvas, ctx } = makeCanvas(CW, CH);
  paintFoilBase(ctx, CW, CH);
  drawRibbon(ctx, CW, CH);
  drawLogo(ctx, CW * .5, CH * .185, CW * .183);
  drawMainTitle(ctx, CW, CH);
  drawBadge(ctx, CW * .762, CH * .575, CW * .085);
  drawLime(ctx, CW * .405, CH * .695, CW * .147, -.23);
  drawChili(ctx, CW * .44, CH * .764, CW * .175, -.13);
  drawChip(ctx, CW * .72, CH * .735, CW * .116, CH * .071, .34);
  drawChip(ctx, CW * .565, CH * .815, CW * .122, CH * .074, -.44);
  scatterSeasoning(ctx, CW, CH);
  drawMass(ctx, CW, CH);
  return canvas;
}

function drawRecycle(ctx, x, y, r) {
  ctx.save();
  ctx.translate(x, y);
  ctx.strokeStyle = '#38672d';
  ctx.fillStyle = '#38672d';
  ctx.lineWidth = r * .13;
  for (let i = 0; i < 3; i++) {
    ctx.save();
    ctx.rotate(i * TAU / 3 - Math.PI / 2);
    ctx.beginPath();
    ctx.arc(0, 0, r * .62, .25, 1.82);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(r * .7, -r * .53);
    ctx.lineTo(r * .88, -r * .22);
    ctx.lineTo(r * .53, -r * .2);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
  ctx.restore();
}

function drawBarcode(ctx, x, y, w, h) {
  ctx.save();
  ctx.fillStyle = '#f7f5e9';
  ctx.fillRect(x, y, w, h);
  const rnd = mulberry32(1907);
  let px = x + w * .05;
  while (px < x + w * .95) {
    const bar = 2 + Math.floor(rnd() * 7);
    if (rnd() > .36) {
      ctx.fillStyle = '#243026';
      ctx.fillRect(px, y + h * .09, bar, h * .68);
    }
    px += bar + 2 + Math.floor(rnd() * 4);
  }
  ctx.fillStyle = '#33392e';
  ctx.font = `600 ${Math.max(8, h * .12)}px ${SANS}`;
  ctx.textAlign = 'center';
  ctx.fillText('4 608123 456789', x + w / 2, y + h * .92);
  ctx.restore();
}

function createBackCanvas() {
  const { canvas, ctx } = makeCanvas(CW, CH);
  paintFoilBase(ctx, CW, CH, true);

  ctx.save();
  ctx.strokeStyle = 'rgba(203,230,135,.14)';
  ctx.lineWidth = CW * .12;
  ctx.beginPath();
  ctx.moveTo(CW * .05, CH * .88);
  ctx.bezierCurveTo(CW * .3, CH * .72, CW * .72, CH * .83, CW * .98, CH * .64);
  ctx.stroke();
  ctx.restore();

  drawLogo(ctx, CW * .5, CH * .1, CW * .098, true);
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#fbf8e9';
  ctx.shadowColor = 'rgba(25,57,16,.35)';
  ctx.shadowBlur = 8;
  ctx.font = `900 105px ${SANS}`;
  ctx.fillText('Рифлёные', CW * .5, CH * .235);
  ctx.font = `600 39px ${SANS}`;
  ctx.fillStyle = '#f1edcf';
  ctx.fillText('ЧИЛИ И ЛАЙМ', CW * .5, CH * .283);
  ctx.restore();

  ctx.save();
  ctx.shadowColor = 'rgba(20,54,14,.22)';
  ctx.shadowBlur = 28;
  ctx.shadowOffsetY = 12;
  ctx.fillStyle = 'rgba(249,247,237,.94)';
  roundedRect(ctx, CW * .095, CH * .337, CW * .81, CH * .49, 22);
  ctx.fill();
  ctx.shadowColor = 'transparent';
  ctx.fillStyle = '#315a27';
  roundedRect(ctx, CW * .095, CH * .337, CW * .81, CH * .062, 22);
  ctx.fill();
  ctx.fillRect(CW * .095, CH * .368, CW * .81, CH * .031);
  ctx.fillStyle = '#f8f6e8';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `700 29px ${SANS}`;
  ctx.fillText('ПИЩЕВАЯ ЦЕННОСТЬ И ИНФОРМАЦИЯ', CW * .5, CH * .369);

  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillStyle = '#2f362a';
  ctx.font = `600 27px ${SANS}`;
  ctx.fillText('СОСТАВ', CW * .13, CH * .426);
  ctx.font = `400 22px ${SANS}`;
  ctx.fillStyle = '#4c5147';
  const ingredients = [
    'Картофель, растительное масло, смесь вкусоароматическая',
    '«Чили и лайм» (соль, сахар, специи, экстракты чили и лайма),',
    'натуральные ароматизаторы. Может содержать следы молока.'
  ];
  ingredients.forEach((line, i) => ctx.fillText(line, CW * .13, CH * .462 + i * 33));

  ctx.fillStyle = '#2f362a';
  ctx.font = `600 27px ${SANS}`;
  ctx.fillText('НА 100 г', CW * .13, CH * .555);
  const cols = [
    ['Белки', '6,8 г'], ['Жиры', '31 г'], ['Углеводы', '52 г'], ['Соль', '1,4 г']
  ];
  cols.forEach((c, i) => {
    const y = CH * .594 + i * 39;
    ctx.font = `500 23px ${SANS}`;
    ctx.fillStyle = '#64695c';
    ctx.fillText(c[0], CW * .13, y);
    ctx.font = `700 23px ${SANS}`;
    ctx.fillStyle = '#2f4129';
    ctx.textAlign = 'right';
    ctx.fillText(c[1], CW * .67, y);
    ctx.textAlign = 'left';
    ctx.strokeStyle = 'rgba(44,67,36,.13)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(CW * .13, y + 28);
    ctx.lineTo(CW * .67, y + 28);
    ctx.stroke();
  });
  ctx.fillStyle = '#315a27';
  ctx.font = `600 25px ${SANS}`;
  ctx.fillText('ЭНЕРГЕТИЧЕСКАЯ ЦЕННОСТЬ', CW * .13, CH * .765);
  ctx.font = `700 30px ${SANS}`;
  ctx.fillText('520 ккал / 2175 кДж', CW * .13, CH * .795);

  drawBarcode(ctx, CW * .69, CH * .48, CW * .18, CH * .13);
  ctx.save();
  ctx.fillStyle = '#243026';
  const qx = CW * .718, qy = CH * .635, qs = CW * .125;
  const qr = mulberry32(413);
  for (let yy = 0; yy < 17; yy++) {
    for (let xx = 0; xx < 17; xx++) {
      if (qr() > .55 || (xx < 5 && yy < 5) || (xx > 11 && yy < 4) || (xx < 4 && yy > 12)) {
        ctx.fillRect(qx + xx * qs / 17, qy + yy * qs / 17, qs / 17 * .9, qs / 17 * .9);
      }
    }
  }
  ctx.fillStyle = '#f5f2e7';
  [[1,1],[13,1],[1,13]].forEach(([a,b]) => {
    ctx.fillRect(qx + a * qs / 17, qy + b * qs / 17, qs * 3 / 17, qs * 3 / 17);
  });
  ctx.restore();

  drawRecycle(ctx, CW * .79, CH * .785, CW * .029);
  ctx.fillStyle = '#4b5641';
  ctx.textAlign = 'center';
  ctx.font = `500 15px ${SANS}`;
  ctx.fillText('УПАКОВКА ПОДЛЕЖИТ ПЕРЕРАБОТКЕ', CW * .79, CH * .81);

  ctx.fillStyle = '#f8f5e5';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  ctx.font = `700 150px ${SANS}`;
  ctx.shadowColor = 'rgba(21,52,14,.38)';
  ctx.shadowBlur = 12;
  ctx.fillText('105 г', CW * .88, CH * .92);
  ctx.shadowColor = 'transparent';
  ctx.textAlign = 'center';
  ctx.font = `500 19px ${SANS}`;
  ctx.fillStyle = 'rgba(247,249,234,.66)';
  ctx.fillText('СДЕЛАЙ ПЕРЕРЫВ. ОТКРОЙ ПАЧКУ.', CW * .5, CH * .955);
  ctx.font = `400 13px ${SANS}`;
  ctx.fillStyle = 'rgba(239,244,224,.42)';
  ctx.fillText("ООО «Фрито Лей Мануфактуринг» · 115280, Москва · lay's.ru", CW * .5, CH * .977);
  return canvas;
}

function bagHalfWidth(v) {
  return BAG.width * .5 * (.989 + .011 * Math.sin(Math.PI * v));
}

function createBagPanelGeometry(sign, cols = 100, rows = 132) {
  const positions = [];
  const uvs = [];
  const indices = [];
  const h = BAG.height;
  for (let j = 0; j <= rows; j++) {
    const v = j / rows;
    const y = (v - .5) * h;
    const hw = bagHalfWidth(v);
    for (let i = 0; i <= cols; i++) {
      const u = i / cols;
      const su = (u - .5) * 2;
      const sv = (v - .5) * 2;
      const edgeFade = Math.pow(Math.sin(Math.PI * u), .12) * Math.pow(Math.sin(Math.PI * v), .12);
      const balloon = Math.pow(Math.sin(Math.PI * u), .72) * Math.pow(Math.sin(Math.PI * v), .36);
      let z = BAG.depth * .5 * balloon;
      z += BAG.depth * .07 * Math.sin(Math.PI * u * 1.2 + .2) * Math.pow(Math.sin(Math.PI * v), .7);
      z -= BAG.depth * .035 * Math.pow(Math.abs(su), 2.1) * Math.sin(Math.PI * v);
      const edgeBand = Math.pow(Math.abs(su), 5) + Math.pow(Math.abs(sv), 7) * .8;
      const crinkle =
        .017 * Math.sin(8.6 * Math.PI * v + 3.4 * u + .6) +
        .0085 * Math.sin(13.5 * Math.PI * u - 5.1 * v + 1.7) +
        .0045 * Math.sin(26 * Math.PI * v + 4.8 * u);
      z += crinkle * edgeFade * (.24 + 1.7 * Math.min(1, edgeBand)) * (.7 + .3 * balloon);
      positions.push(su * hw, y, sign * z);
      uvs.push(sign > 0 ? u : 1 - u, v);
    }
  }
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const a = j * (cols + 1) + i;
      const b = a + 1;
      const d = a + cols + 1;
      const c = d + 1;
      if (sign > 0) indices.push(a, b, d, b, c, d);
      else indices.push(a, d, b, b, d, c);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  geo.computeBoundingBox();
  return geo;
}

function createRimGeometry(side, rows = 132, across = 6) {
  const positions = [];
  const uvs = [];
  const indices = [];
  for (let j = 0; j <= rows; j++) {
    const v = j / rows;
    const y = (v - .5) * BAG.height;
    const hw = bagHalfWidth(v);
    for (let i = 0; i <= across; i++) {
      const s = i / across;
      const z = (s - .5) * .058;
      const x = side * (hw + .008 * Math.sin(Math.PI * s));
      positions.push(x, y, z);
      uvs.push(v, s);
    }
  }
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < across; i++) {
      const a = j * (across + 1) + i;
      const b = a + 1;
      const d = a + across + 1;
      const c = d + 1;
      indices.push(a, b, d, b, c, d);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

function createSealGeometry() {
  const w = BAG.width * 1.004;
  const shape = new THREE.Shape();
  shape.moveTo(-w / 2, -.026);
  shape.lineTo(w / 2, -.026);
  const n = 112;
  for (let i = n; i >= 0; i--) {
    const t = i / n;
    const x = -w / 2 + t * w;
    const wave = .009 * Math.sin(t * 113 + .7) + .0045 * Math.sin(t * 47 + 2.2);
    const y = BAG.seal + wave - .01 * Math.pow(Math.abs(t - .5) * 2, 5);
    shape.lineTo(x, y);
  }
  shape.closePath();
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: .057,
    bevelEnabled: true,
    bevelSegments: 2,
    steps: 1,
    bevelSize: .006,
    bevelThickness: .006
  });
  geo.translate(0, 0, -.0285);
  geo.computeVertexNormals();
  return geo;
}

function createFoilBumpTexture(renderer) {
  const { canvas, ctx } = makeCanvas(512, 512);
  ctx.fillStyle = '#7c7c7c';
  ctx.fillRect(0, 0, 512, 512);
  const rnd = mulberry32(2468);
  ctx.lineCap = 'round';
  for (let i = 0; i < 780; i++) {
    const x = rnd() * 512;
    const y = rnd() * 512;
    const len = 5 + rnd() * 70;
    ctx.strokeStyle = rnd() > .5 ? `rgba(255,255,255,${.03 + rnd() * .13})` : `rgba(0,0,0,${.03 + rnd() * .09})`;
    ctx.lineWidth = .5 + rnd() * 2.2;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.quadraticCurveTo(x + len * .35, y + (rnd() - .5) * 17, x + len, y + (rnd() - .5) * 9);
    ctx.stroke();
  }
  const tex = textureFromCanvas(canvas, renderer, false);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(2.7, 3.4);
  return tex;
}

function createCrimpTexture(renderer) {
  const { canvas, ctx } = makeCanvas(128, 64);
  const g = ctx.createLinearGradient(0, 0, 0, 64);
  g.addColorStop(0, '#c3cda2');
  g.addColorStop(.23, '#93a76e');
  g.addColorStop(.6, '#6f8e4b');
  g.addColorStop(1, '#4d702f');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 64);
  const rnd = mulberry32(616);
  for (let x = 0; x < 128; x += 2) {
    const a = .06 + rnd() * .21;
    ctx.fillStyle = x % 4 ? `rgba(235,246,205,${a})` : `rgba(25,53,15,${a + .06})`;
    ctx.fillRect(x, 0, x % 6 ? 1 : 2, 64);
  }
  for (let i = 0; i < 16; i++) {
    ctx.strokeStyle = `rgba(236,244,204,${.03 + rnd() * .1})`;
    ctx.lineWidth = .5 + rnd() * 1.2;
    const y = rnd() * 64;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(128, y + (rnd() - .5) * 3);
    ctx.stroke();
  }
  const tex = textureFromCanvas(canvas, renderer);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(18, 3);
  return tex;
}

function createBag(renderer) {
  const group = new THREE.Group();
  group.name = 'Lays_Green_Pack';

  const frontMap = textureFromCanvas(createFrontCanvas(), renderer);
  const backMap = textureFromCanvas(createBackCanvas(), renderer);
  const bump = createFoilBumpTexture(renderer);

  const common = {
    roughness: .28,
    metalness: .12,
    clearcoat: .64,
    clearcoatRoughness: .21,
    envMapIntensity: 1.18,
    bumpMap: bump,
    bumpScale: .0055
  };
  const frontMat = new THREE.MeshPhysicalMaterial({ ...common, map: frontMap, color: 0xffffff });
  const backMat = new THREE.MeshPhysicalMaterial({ ...common, map: backMap, color: 0xffffff });
  const rimMat = new THREE.MeshPhysicalMaterial({
    color: 0x477d34, roughness: .31, metalness: .15,
    clearcoat: .65, clearcoatRoughness: .25, envMapIntensity: 1.05,
    side: THREE.DoubleSide, bumpMap: bump, bumpScale: .0065
  });
  const crimpMap = createCrimpTexture(renderer);
  const sealFaceMat = new THREE.MeshPhysicalMaterial({
    map: crimpMap, color: 0xffffff, roughness: .3, metalness: .42,
    clearcoat: .6, clearcoatRoughness: .18, envMapIntensity: 1.3,
    bumpMap: bump, bumpScale: .012
  });
  const sealEdgeMat = new THREE.MeshPhysicalMaterial({
    color: 0xa2aa82, roughness: .26, metalness: .7, envMapIntensity: 1.5
  });

  const front = new THREE.Mesh(createBagPanelGeometry(1), frontMat);
  const back = new THREE.Mesh(createBagPanelGeometry(-1), backMat);
  const rimL = new THREE.Mesh(createRimGeometry(-1), rimMat);
  const rimR = new THREE.Mesh(createRimGeometry(1), rimMat);
  [front, back, rimL, rimR].forEach(m => {
    m.castShadow = true;
    m.receiveShadow = true;
    group.add(m);
  });

  const sealGeo = createSealGeometry();
  const topSeal = new THREE.Mesh(sealGeo, [sealFaceMat, sealEdgeMat]);
  topSeal.position.y = BAG.height / 2;
  const bottomSeal = new THREE.Mesh(sealGeo, [sealFaceMat, sealEdgeMat]);
  bottomSeal.position.y = -BAG.height / 2;
  bottomSeal.rotation.z = Math.PI;
  [topSeal, bottomSeal].forEach(m => {
    m.castShadow = true;
    m.receiveShadow = true;
    group.add(m);
  });

  group.position.y = BAG.height / 2 + BAG.seal;
  return group;
}

function createChipGeometry() {
  const segments = 96;
  const rings = 26;
  const thickness = .035;
  const verts = [{ x: 0, y: 0, z: .045, u: .5, v: .5 }];
  const ringStart = [];
  for (let j = 1; j <= rings; j++) {
    const t = j / rings;
    ringStart[j] = verts.length;
    for (let i = 0; i < segments; i++) {
      const a = i / segments * TAU;
      const rim = 1 + .085 * Math.sin(3 * a + .8) + .033 * Math.sin(7 * a - .3) + .012 * Math.sin(11 * a + 2);
      const r = t * rim;
      const x = Math.cos(a) * r;
      const y = Math.sin(a) * r;
      const radial = Math.pow(t, 2.2);
      const z =
        .021 * Math.sin(x * 22 + y * 6.2 + .4 * Math.sin(y * 4.2)) +
        .019 * Math.sin(x * 9.5 - y * 11.5) +
        .025 * radial +
        .017 * Math.sin(6 * a + 1.3) * Math.pow(t, 4) +
        .005 * Math.sin(7 * a + x * 3);
      verts.push({ x, y, z, u: .5 + x * .4, v: .5 + y * .4 });
    }
  }

  const indices = [];
  for (let i = 0; i < segments; i++) {
    indices.push(0, ringStart[1] + i, ringStart[1] + (i + 1) % segments);
  }
  for (let j = 1; j < rings; j++) {
    for (let i = 0; i < segments; i++) {
      const ni = (i + 1) % segments;
      const a = ringStart[j] + i;
      const b = ringStart[j] + ni;
      const c = ringStart[j + 1] + i;
      const d = ringStart[j + 1] + ni;
      indices.push(a, c, b, b, c, d);
    }
  }

  const positions = [];
  const uvs = [];
  verts.forEach(v => {
    positions.push(v.x, v.y, v.z);
    uvs.push(v.u, v.v);
  });
  const topCount = verts.length;
  verts.forEach(v => {
    positions.push(v.x, v.y, v.z - thickness);
    uvs.push(v.u, v.v);
  });
  const surfaceIndexCount = indices.length;
  for (let i = 0; i < surfaceIndexCount; i += 3) {
    indices.push(topCount + indices[i], topCount + indices[i + 2], topCount + indices[i + 1]);
  }
  const outer = ringStart[rings];
  for (let i = 0; i < segments; i++) {
    const ni = (i + 1) % segments;
    const a = outer + i;
    const b = outer + ni;
    const c = topCount + outer + i;
    const d = topCount + outer + ni;
    indices.push(a, b, c, b, d, c);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  geo.computeBoundingBox();
  return geo;
}

function createChipTexture(renderer) {
  const { canvas, ctx } = makeCanvas(512, 512);
  const g = ctx.createRadialGradient(190, 160, 20, 256, 256, 350);
  g.addColorStop(0, '#f2c46b');
  g.addColorStop(.45, '#e3a646');
  g.addColorStop(.8, '#c98632');
  g.addColorStop(1, '#a45f20');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 512, 512);
  const rnd = mulberry32(551);
  for (let i = 0; i < 170; i++) {
    const x = rnd() * 512;
    const y = rnd() * 512;
    const rr = 1.5 + rnd() * 13;
    const oil = ctx.createRadialGradient(x, y, 0, x, y, rr);
    const warm = i % 4 === 0;
    oil.addColorStop(0, warm ? 'rgba(118,64,16,.22)' : 'rgba(255,231,164,.24)');
    oil.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = oil;
    ctx.beginPath();
    ctx.arc(x, y, rr, 0, TAU);
    ctx.fill();
  }
  for (let i = 0; i < 130; i++) {
    ctx.fillStyle = i % 6 ? 'rgba(255,235,168,.5)' : 'rgba(94,49,8,.34)';
    ctx.beginPath();
    ctx.arc(rnd() * 512, rnd() * 512, .5 + rnd() * 1.8, 0, TAU);
    ctx.fill();
  }
  return textureFromCanvas(canvas, renderer);
}

function createLimePropTexture(renderer) {
  const { canvas, ctx } = makeCanvas(512, 512);
  drawLime(ctx, 256, 256, 248, .12);
  return textureFromCanvas(canvas, renderer);
}

function createStudioEnvironment(renderer) {
  const { canvas, ctx } = makeCanvas(1024, 512);
  const sky = ctx.createLinearGradient(0, 0, 0, 512);
  sky.addColorStop(0, '#878882');
  sky.addColorStop(.36, '#c7c2b8');
  sky.addColorStop(.5, '#f1ece1');
  sky.addColorStop(.66, '#a49c90');
  sky.addColorStop(1, '#4c4841');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, 1024, 512);

  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  function softbox(x, y, rx, ry, color = '255,250,238', strength = .95) {
    const g = ctx.createRadialGradient(x, y, 1, x, y, Math.max(rx, ry));
    g.addColorStop(0, `rgba(${color},${strength})`);
    g.addColorStop(.4, `rgba(${color},${strength * .68})`);
    g.addColorStop(.76, `rgba(${color},${strength * .16})`);
    g.addColorStop(1, `rgba(${color},0)`);
    ctx.fillStyle = g;
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(rx / Math.max(rx, ry), ry / Math.max(rx, ry));
    ctx.beginPath();
    ctx.arc(0, 0, Math.max(rx, ry), 0, TAU);
    ctx.fill();
    ctx.restore();
  }
  softbox(225, 132, 155, 130, '255,248,232', 1);
  softbox(752, 185, 130, 155, '214,230,255', .82);
  softbox(535, 53, 340, 40, '255,245,219', 1);
  softbox(125, 305, 96, 76, '255,235,207', .42);
  softbox(930, 360, 95, 95, '249,244,230', .3);
  ctx.restore();

  const tex = new THREE.CanvasTexture(canvas);
  tex.mapping = THREE.EquirectangularReflectionMapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  const pmrem = new THREE.PMREMGenerator(renderer);
  pmrem.compileEquirectangularShader();
  const env = pmrem.fromEquirectangular(tex).texture;
  tex.dispose();
  pmrem.dispose();
  return env;
}

function createStoneTexture(renderer, floor = false) {
  const size = 1024;
  const { canvas, ctx } = makeCanvas(size, size);
  const g = ctx.createRadialGradient(size * .44, size * .4, 10, size * .5, size * .5, size * .64);
  g.addColorStop(0, floor ? '#ded8cd' : '#e3dcd0');
  g.addColorStop(.55, floor ? '#d2cbbf' : '#d8d0c3');
  g.addColorStop(1, floor ? '#beb6a9' : '#c8bdae');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const rnd = mulberry32(floor ? 512 : 772);
  for (let i = 0; i < 4800; i++) {
    const a = .012 + rnd() * .04;
    ctx.fillStyle = rnd() > .56 ? `rgba(98,91,76,${a})` : `rgba(255,255,249,${a * 1.3})`;
    const s = .5 + rnd() * 2.6;
    ctx.fillRect(rnd() * size, rnd() * size, s, s);
  }
  ctx.strokeStyle = 'rgba(114,103,84,.055)';
  for (let i = 0; i < 14; i++) {
    ctx.lineWidth = .5 + rnd() * 1.5;
    ctx.beginPath();
    let x = rnd() * size;
    let y = rnd() * size;
    ctx.moveTo(x, y);
    for (let k = 0; k < 5; k++) {
      x += (rnd() - .5) * 140;
      y += 30 + rnd() * 90;
      ctx.quadraticCurveTo(x + (rnd() - .5) * 60, y - 30, x, y);
    }
    ctx.stroke();
  }
  if (!floor) {
    ctx.strokeStyle = 'rgba(255,255,255,.19)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, size * .479, 0, TAU);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(87,77,62,.09)';
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, size * .47, 0, TAU);
    ctx.stroke();
  }
  const tex = textureFromCanvas(canvas, renderer);
  return tex;
}

function createStage(renderer) {
  const group = new THREE.Group();
  group.name = 'Studio_Podium';

  const topPodium = createStoneTexture(renderer, false);
  const topMat = new THREE.MeshPhysicalMaterial({
    map: topPodium, color: 0xffffff, roughness: .53, metalness: .03,
    clearcoat: .22, clearcoatRoughness: .5, envMapIntensity: .62
  });
  const sideMat = new THREE.MeshPhysicalMaterial({
    color: 0xc6bcac, roughness: .66, metalness: .02, envMapIntensity: .5
  });
  const podium = new THREE.Mesh(new THREE.CylinderGeometry(2.36, 2.46, .22, 128, 1, false), [sideMat, topMat, sideMat]);
  podium.position.y = -.11;
  podium.castShadow = true;
  podium.receiveShadow = true;
  group.add(podium);

  const lip = new THREE.Mesh(
    new THREE.TorusGeometry(2.354, .011, 10, 128),
    new THREE.MeshStandardMaterial({ color: 0xf1ece2, roughness: .42, metalness: .08 })
  );
  lip.rotation.x = Math.PI / 2;
  lip.position.y = -.002;
  group.add(lip);

  const floorTex = createStoneTexture(renderer, true);
  const floorMat = new THREE.MeshStandardMaterial({
    map: floorTex, color: 0xf0ece4, roughness: .93, metalness: 0,
    envMapIntensity: .28
  });
  const floor = new THREE.Mesh(new THREE.CircleGeometry(36, 128), floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -.222;
  floor.receiveShadow = true;
  group.add(floor);

  const baseShadow = new THREE.Mesh(
    new THREE.CircleGeometry(2.7, 96),
    new THREE.MeshBasicMaterial({ color: 0x37352b, transparent: true, opacity: .065, depthWrite: false })
  );
  baseShadow.rotation.x = -Math.PI / 2;
  baseShadow.position.y = -.216;
  group.add(baseShadow);
  return group;
}

function createLights(scene) {
  const key = new THREE.DirectionalLight(0xfff3df, 2.65);
  key.position.set(-4.6, 6.8, 5.2);
  key.target.position.set(0, 1.02, 0);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.left = -4.2;
  key.shadow.camera.right = 4.2;
  key.shadow.camera.top = 5.2;
  key.shadow.camera.bottom = -1.4;
  key.shadow.camera.near = .5;
  key.shadow.camera.far = 22;
  key.shadow.bias = -.0002;
  key.shadow.normalBias = .022;
  key.shadow.radius = 5.5;
  key.shadow.blurSamples = 12;
  scene.add(key, key.target);

  const fill = new THREE.DirectionalLight(0xdae7ff, .82);
  fill.position.set(4.8, 3.1, 4.3);
  fill.target.position.set(0, 1.1, 0);
  scene.add(fill, fill.target);

  const rim = new THREE.DirectionalLight(0xffefd0, 1.9);
  rim.position.set(1.4, 4.9, -5.5);
  rim.target.position.set(0, 1.15, 0);
  scene.add(rim, rim.target);

  const hemi = new THREE.HemisphereLight(0xfff9ee, 0x746f5f, .17);
  scene.add(hemi);
  return { key, fill, rim };
}

function makeContactShadow(renderer) {
  const { canvas, ctx } = makeCanvas(256, 256);
  const g = ctx.createRadialGradient(128, 128, 2, 128, 128, 124);
  g.addColorStop(0, 'rgba(25,28,18,.9)');
  g.addColorStop(.42, 'rgba(25,28,18,.58)');
  g.addColorStop(1, 'rgba(25,28,18,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 256, 256);
  return textureFromCanvas(canvas, renderer);
}

function addBlobShadow(scene, tex, x, z, sx, sz, y, opacity = .44) {
  const mat = new THREE.MeshBasicMaterial({
    map: tex, transparent: true, opacity, depthWrite: false,
    color: 0x343427, toneMapped: false
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(sx, sz), mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.set(x, y, z);
  mesh.renderOrder = 2;
  scene.add(mesh);
  return mesh;
}

function settleOnStage(object, y = .004) {
  object.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(object);
  object.position.y += y - box.min.y;
}

function createProps(renderer, scene, contactTex) {
  const props = new THREE.Group();
  props.name = 'Garnish';

  const chipGeo = createChipGeometry();
  const chipTex = createChipTexture(renderer);
  const chipMat = new THREE.MeshPhysicalMaterial({
    map: chipTex, color: 0xf2d4a4, roughness: .6, metalness: .01,
    clearcoat: .26, clearcoatRoughness: .46, side: THREE.DoubleSide,
    envMapIntensity: .4
  });

  function chip(scale, x, z, yaw, tilt, roll) {
    const holder = new THREE.Group();
    holder.position.set(x, 0, z);
    holder.rotation.y = yaw;
    const mesh = new THREE.Mesh(chipGeo, chipMat);
    mesh.scale.setScalar(scale);
    mesh.rotation.x = -Math.PI / 2 + tilt;
    mesh.rotation.z = roll;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    holder.add(mesh);
    scene.add(holder);
    settleOnStage(holder, .004);
    holder.updateMatrixWorld(true);
    const center = new THREE.Box3().setFromObject(holder).getCenter(new THREE.Vector3());
    props.add(holder);
    addBlobShadow(props, contactTex, center.x, center.z, scale * .9, scale * .62, .0045, .33);
    return holder;
  }

  chip(.3, 1.08, .42, .35, .07, .08);
  chip(.235, 1.3, -.15, 1.32, .1, -.1);

  const limeTopTex = createLimePropTexture(renderer);
  const limeTopMat = new THREE.MeshPhysicalMaterial({
    map: limeTopTex, color: 0xcbd6b3, roughness: .42, metalness: .01,
    clearcoat: .42, clearcoatRoughness: .3, envMapIntensity: .52
  });
  const limeSideMat = new THREE.MeshPhysicalMaterial({
    color: 0x58852d, roughness: .55, metalness: 0, clearcoat: .28, clearcoatRoughness: .4
  });
  const limeGeo = new THREE.CylinderGeometry(.335, .34, .052, 80, 1, false);
  const limeMesh = new THREE.Mesh(limeGeo, [limeSideMat, limeTopMat, limeTopMat]);
  limeMesh.castShadow = true;
  limeMesh.receiveShadow = true;
  const limeHolder = new THREE.Group();
  limeHolder.add(limeMesh);
  limeHolder.position.set(-1.26, 0, .42);
  limeHolder.rotation.y = .44;
  limeHolder.rotation.z = -.055;
  limeHolder.rotation.x = .07;
  scene.add(limeHolder);
  settleOnStage(limeHolder, .004);
  limeHolder.updateMatrixWorld(true);
  const limeCenter = new THREE.Box3().setFromObject(limeHolder).getCenter(new THREE.Vector3());
  addBlobShadow(props, contactTex, limeCenter.x, limeCenter.z, .82, .74, .0045, .34);
  props.add(limeHolder);

  const saltGeo = new THREE.IcosahedronGeometry(.012, 0);
  const saltMat = new THREE.MeshStandardMaterial({ color: 0xfff9e7, roughness: .45, metalness: 0 });
  const salt = new THREE.InstancedMesh(saltGeo, saltMat, 54);
  const rnd = mulberry32(9901);
  const dummy = new THREE.Object3D();
  for (let i = 0; i < 54; i++) {
    const a = rnd() * TAU;
    const radius = 1.05 + rnd() * 1.12;
    dummy.position.set(Math.cos(a) * radius, .006 + rnd() * .008, Math.sin(a) * radius);
    dummy.scale.set(.55 + rnd() * .9, .4 + rnd() * .65, .55 + rnd() * .8);
    dummy.rotation.set(rnd() * TAU, rnd() * TAU, rnd() * TAU);
    dummy.updateMatrix();
    salt.setMatrixAt(i, dummy.matrix);
  }
  salt.castShadow = false;
  salt.receiveShadow = true;
  scene.add(salt);
  props.add(salt);

  const flakeGeo = new THREE.TetrahedronGeometry(.022, 0);
  const flakeMat = new THREE.MeshStandardMaterial({ color: 0x9c2718, roughness: .58, metalness: .01 });
  const flakes = new THREE.InstancedMesh(flakeGeo, flakeMat, 20);
  for (let i = 0; i < 20; i++) {
    const a = rnd() * TAU;
    const radius = .95 + rnd() * 1.15;
    dummy.position.set(Math.cos(a) * radius, .007, Math.sin(a) * radius);
    dummy.scale.set(.6 + rnd(), .18 + rnd() * .18, .5 + rnd() * .8);
    dummy.rotation.set(rnd() * TAU, rnd() * TAU, rnd() * TAU);
    dummy.updateMatrix();
    flakes.setMatrixAt(i, dummy.matrix);
  }
  flakes.castShadow = false;
  scene.add(flakes);
  props.add(flakes);
  return props;
}

async function waitForFonts() {
  if (!document.fonts) return;
  const faces = [
    `400 50px Lobster`, `700 50px Montserrat`, `500 50px Montserrat`,
    `600 50px Montserrat`, `800 50px Montserrat`, `900 50px Montserrat`
  ];
  try {
    await Promise.race([
      Promise.allSettled(faces.map(face => document.fonts.load(face))),
      new Promise(resolve => setTimeout(resolve, 1100))
    ]);
    await Promise.race([
      document.fonts.ready,
      new Promise(resolve => setTimeout(resolve, 550))
    ]);
  } catch (e) { /* system fallbacks are intentional */ }
}

async function init() {
  try {
    await waitForFonts();

    const renderer = new THREE.WebGLRenderer({
      canvas: canvasEl,
      antialias: true,
      alpha: false,
      powerPreference: 'high-performance'
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setClearColor(0xe7e3d9, 1);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = .95;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xe7e3d9);
    scene.fog = new THREE.Fog(0xe7e3d9, 8.5, 23);

    const camera = new THREE.PerspectiveCamera(32, window.innerWidth / window.innerHeight, .1, 70);
    const heroCenter = new THREE.Vector3(0, BAG.height / 2 + BAG.seal, 0);
    const defaultDirection = new THREE.Vector3(.235, .12, 1).normalize();

    const env = createStudioEnvironment(renderer);
    scene.environment = env;
    scene.environmentIntensity = .58;
    createLights(scene);

    const stage = createStage(renderer);
    scene.add(stage);

    const bag = createBag(renderer);
    scene.add(bag);

    const contactTex = makeContactShadow(renderer);
    addBlobShadow(scene, contactTex, 0, .04, 1.48, .64, .004, .46);
    const props = createProps(renderer, scene, contactTex);
    scene.add(props);
    function syncGarnishVisibility() {
      props.visible = window.innerWidth / window.innerHeight >= .8;
    }
    syncGarnishVisibility();

    const controls = new OrbitControls(camera, canvasEl);
    controls.target.copy(heroCenter);
    controls.enableDamping = true;
    controls.dampingFactor = .055;
    controls.enablePan = false;
    controls.rotateSpeed = .68;
    controls.zoomSpeed = .75;
    controls.autoRotateSpeed = .72;
    controls.minPolarAngle = .62;
    controls.maxPolarAngle = 1.52;
    controls.minDistance = 3.4;
    controls.maxDistance = 12.5;
    controls.touches.ONE = THREE.TOUCH.ROTATE;
    controls.touches.TWO = THREE.TOUCH.DOLLY_ROTATE;

    function fitDistance() {
      const vFov = THREE.MathUtils.degToRad(camera.fov);
      const hFov = 2 * Math.atan(Math.tan(vFov / 2) * camera.aspect);
      const dV = (BAG.height / 2 + BAG.seal + .16) / Math.tan(vFov / 2);
      const dH = (BAG.width / 2 + .13) / Math.tan(hFov / 2);
      return Math.max(dV * 1.11, dH * 1.01) + .32;
    }
    function defaultPosition() {
      return heroCenter.clone().addScaledVector(defaultDirection, fitDistance());
    }

    camera.position.copy(defaultPosition());
    camera.lookAt(heroCenter);
    controls.update();

    let autoWasOn = false;
    let cameraTween = null;
    let hasAdjusted = false;

    function hideHint() {
      hintEl.classList.add('is-hidden');
    }
    setTimeout(hideHint, 9000);

    let lastInteraction = 0;
    controls.addEventListener('start', () => {
      hasAdjusted = true;
      lastInteraction = performance.now();
      if (!cameraTween) hideHint();
      if (cameraTween) finishTween();
    });
    controls.addEventListener('end', () => {
      lastInteraction = performance.now();
    });

    function finishTween() {
      if (!cameraTween) return;
      const restoreAuto = cameraTween.auto;
      cameraTween = null;
      controls.enabled = true;
      controls.autoRotate = restoreAuto;
      controls.update(0);
    }

    function startTween(toPos, toTarget, duration = 720) {
      if (cameraTween) finishTween();
      cameraTween = {
        fromPos: camera.position.clone(),
        toPos: toPos.clone(),
        fromTarget: controls.target.clone(),
        toTarget: toTarget.clone(),
        started: performance.now(),
        duration,
        auto: controls.autoRotate
      };
      autoWasOn = controls.autoRotate;
      controls.enabled = false;
      controls.autoRotate = false;
      hideHint();
    }

    resetBtn.addEventListener('click', () => {
      startTween(defaultPosition(), heroCenter, 760);
    });

    autoBtn.addEventListener('click', () => {
      controls.autoRotate = !controls.autoRotate;
      autoBtn.setAttribute('aria-pressed', String(controls.autoRotate));
      autoBtn.setAttribute('aria-label', controls.autoRotate ? 'Выключить автоматическое вращение' : 'Включить автоматическое вращение');
      if (controls.autoRotate) hideHint();
      hasAdjusted = true;
    });

    function onResize() {
      const w = window.innerWidth;
      const h = window.innerHeight;
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      syncGarnishVisibility();
      if (!hasAdjusted && !cameraTween) {
        camera.position.copy(defaultPosition());
        camera.lookAt(heroCenter);
        controls.target.copy(heroCenter);
        controls.update();
      }
    }
    window.addEventListener('resize', onResize, { passive: true });
    window.addEventListener('orientationchange', () => setTimeout(onResize, 150), { passive: true });

    const clock = new THREE.Clock();

    function render(nowMs) {
      const delta = Math.min(clock.getDelta(), .05);
      if (cameraTween) {
        const raw = clamp((nowMs - cameraTween.started) / cameraTween.duration, 0, 1);
        const eased = raw < .5 ? 4 * raw * raw * raw : 1 - Math.pow(-2 * raw + 2, 3) / 2;
        camera.position.lerpVectors(cameraTween.fromPos, cameraTween.toPos, eased);
        controls.target.lerpVectors(cameraTween.fromTarget, cameraTween.toTarget, eased);
        camera.lookAt(controls.target);
        if (raw >= 1) finishTween();
      } else {
        controls.update(delta);
      }
      renderer.render(scene, camera);
    }

    renderer.setAnimationLoop(render);
    renderer.render(scene, camera);

    requestAnimationFrame(() => {
      loadingEl.classList.add('is-done');
      setTimeout(() => loadingEl.remove(), 800);
    });

    window.addEventListener('webglcontextlost', event => {
      event.preventDefault();
      errorEl.classList.add('is-visible');
    }, false);
  } catch (err) {
    console.error(err);
    errorEl.classList.add('is-visible');
    loadingEl.classList.add('is-done');
  }
}

init();




