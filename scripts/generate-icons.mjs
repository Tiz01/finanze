// Genera le icone dell'app in public/, senza dipendenze. Il simbolo è descritto come
// distanza con segno dal suo contorno, così i bordi restano nitidi a ogni dimensione.
import { mkdirSync, writeFileSync } from 'node:fs';
import { crc32, deflateSync } from 'node:zlib';

const OUTPUT_DIR = new URL('../public/', import.meta.url);

const GRADIENT_TOP = [0x14, 0x8f, 0x84];
const GRADIENT_BOTTOM = [0x0b, 0x5f, 0x58];
const CORNER_RADIUS = 0.22;

// Geometria del simbolo €, in frazioni del lato dell'icona.
const ARC = { x: 0.54, y: 0.5, radius: 0.215, stroke: 0.072, openingAngle: 0.84 };
const BARS = { fromX: 0.205, toX: 0.56, y: [0.452, 0.548], stroke: 0.05 };

const capX = ARC.x + ARC.radius * Math.cos(ARC.openingAngle);
const capY = ARC.radius * Math.sin(ARC.openingAngle);

function arcDistance(x, y) {
  const dx = x - ARC.x;
  const dy = y - ARC.y;
  if (Math.abs(Math.atan2(dy, dx)) < ARC.openingAngle) {
    return Math.hypot(x - capX, Math.abs(dy) - capY) - ARC.stroke / 2;
  }
  return Math.abs(Math.hypot(dx, dy) - ARC.radius) - ARC.stroke / 2;
}

function barDistance(x, y, barY) {
  const nearestX = Math.min(Math.max(x, BARS.fromX), BARS.toX);
  return Math.hypot(x - nearestX, y - barY) - BARS.stroke / 2;
}

function symbolDistance(x, y) {
  return Math.min(arcDistance(x, y), ...BARS.y.map((barY) => barDistance(x, y, barY)));
}

function roundedSquareDistance(x, y) {
  const qx = Math.abs(x - 0.5) - (0.5 - CORNER_RADIUS);
  const qy = Math.abs(y - 0.5) - (0.5 - CORNER_RADIUS);
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - CORNER_RADIUS;
}

const coverage = (distance, size) => Math.min(Math.max(0.5 - distance * size, 0), 1);

function renderPixels(size, { rounded }) {
  const pixels = Buffer.alloc(size * size * 4);
  for (let row = 0; row < size; row++) {
    for (let column = 0; column < size; column++) {
      const x = (column + 0.5) / size;
      const y = (row + 0.5) / size;
      const symbol = coverage(symbolDistance(x, y), size);
      const offset = (row * size + column) * 4;
      for (let channel = 0; channel < 3; channel++) {
        const background = GRADIENT_TOP[channel] + (GRADIENT_BOTTOM[channel] - GRADIENT_TOP[channel]) * y;
        pixels[offset + channel] = Math.round(background + (255 - background) * symbol);
      }
      pixels[offset + 3] = rounded ? Math.round(255 * coverage(roundedSquareDistance(x, y), size)) : 255;
    }
  }
  return pixels;
}

function pngChunk(type, data) {
  const typed = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(typed));
  return Buffer.concat([length, typed, checksum]);
}

function encodePng(size, rgba, { opaque }) {
  const channels = opaque ? 3 : 4;
  const scanlines = Buffer.alloc(size * (size * channels + 1));
  for (let row = 0; row < size; row++) {
    const start = row * (size * channels + 1);
    for (let column = 0; column < size; column++) {
      for (let channel = 0; channel < channels; channel++) {
        scanlines[start + 1 + column * channels + channel] = rgba[(row * size + column) * 4 + channel];
      }
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8;
  header[9] = opaque ? 2 : 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', header),
    pngChunk('IDAT', deflateSync(scanlines, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

function writePng(name, size, { rounded }) {
  const png = encodePng(size, renderPixels(size, { rounded }), { opaque: !rounded });
  writeFileSync(new URL(name, OUTPUT_DIR), png);
}

function faviconSvg() {
  const scale = (value) => +(value * 100).toFixed(2);
  const startY = ARC.y - capY;
  const endY = ARC.y + capY;
  const bars = BARS.y.map((y) => `M${scale(BARS.fromX)} ${scale(y)}H${scale(BARS.toX)}`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#148f84"/>
      <stop offset="1" stop-color="#0b5f58"/>
    </linearGradient>
  </defs>
  <rect width="100" height="100" rx="${scale(CORNER_RADIUS)}" fill="url(#g)"/>
  <g fill="none" stroke="#fff" stroke-linecap="round">
    <path d="M${scale(capX)} ${scale(startY)}A${scale(ARC.radius)} ${scale(ARC.radius)} 0 1 0 ${scale(capX)} ${scale(endY)}" stroke-width="${scale(ARC.stroke)}"/>
    <path d="${bars}" stroke-width="${scale(BARS.stroke)}"/>
  </g>
</svg>
`;
}

mkdirSync(OUTPUT_DIR, { recursive: true });
// iOS riempie di nero le zone trasparenti: l'apple-touch-icon deve essere opaca e a pieno quadrato.
writePng('apple-touch-icon.png', 180, { rounded: false });
writePng('maskable-512x512.png', 512, { rounded: false });
writePng('pwa-192x192.png', 192, { rounded: true });
writePng('pwa-512x512.png', 512, { rounded: true });
writeFileSync(new URL('favicon.svg', OUTPUT_DIR), faviconSvg());
