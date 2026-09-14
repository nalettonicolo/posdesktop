// Genera un'icona .ico placeholder per l'app desktop (badge blu con segno di spunta,
// stile "documento verificato" coerente con la schermata di lock). Nessuna dipendenza
// esterna: incapsula un piccolo encoder PNG (via zlib, gia' incluso in Node) e un
// contenitore ICO "PNG-compressed" (supportato da Windows Vista in poi, incluso l'uso
// come icona di finestra/taskbar e come icona dell'installer NSIS).
//
// Sostituibile in qualsiasi momento: basta rimpiazzare desktop/build/icon.ico con un
// logo reale — nessun altro file dipende da come e' stato generato questo placeholder.
const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");

const BG = [37, 99, 235]; // #2563eb — stesso blu del badge nella lock screen
const FG = [255, 255, 255];

function distToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  let t = lenSq === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const cx = ax + t * dx;
  const cy = ay + t * dy;
  return Math.hypot(px - cx, py - cy);
}

// Tutte le coordinate in spazio normalizzato [0,1] x [0,1].
function shapeColor(nx, ny) {
  // Sfondo: quadrato con angoli arrotondati.
  const r = 0.22;
  const inLeft = nx < r;
  const inRight = nx > 1 - r;
  const inTop = ny < r;
  const inBottom = ny > 1 - r;
  let insideBg = true;
  if (inLeft && inTop) insideBg = Math.hypot(nx - r, ny - r) <= r;
  else if (inRight && inTop) insideBg = Math.hypot(nx - (1 - r), ny - r) <= r;
  else if (inLeft && inBottom) insideBg = Math.hypot(nx - r, ny - (1 - r)) <= r;
  else if (inRight && inBottom) insideBg = Math.hypot(nx - (1 - r), ny - (1 - r)) <= r;
  if (!insideBg) return null;

  // Segno di spunta bianco al centro.
  const strokeW = 0.09;
  const d1 = distToSegment(nx, ny, 0.28, 0.53, 0.44, 0.7);
  const d2 = distToSegment(nx, ny, 0.44, 0.7, 0.74, 0.32);
  if (d1 < strokeW / 2 || d2 < strokeW / 2) return FG;
  return BG;
}

function renderRGBA(size, supersample = 4) {
  const buf = Buffer.alloc(size * size * 4);
  const s = supersample;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let sy = 0; sy < s; sy++) {
        for (let sx = 0; sx < s; sx++) {
          const nx = (x + (sx + 0.5) / s) / size;
          const ny = (y + (sy + 0.5) / s) / size;
          const c = shapeColor(nx, ny);
          if (c) {
            r += c[0];
            g += c[1];
            b += c[2];
            a += 255;
          }
        }
      }
      const n = s * s;
      const i = (y * size + x) * 4;
      buf[i] = Math.round(r / n);
      buf[i + 1] = Math.round(g / n);
      buf[i + 2] = Math.round(b / n);
      buf[i + 3] = Math.round(a / n);
    }
  }
  return buf;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBuf = Buffer.from(type, "ascii");
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(data.length, 0);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
}

function encodePNG(size) {
  const rgba = renderRGBA(size);
  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (stride + 1)] = 0; // filtro "None" per riga
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colore RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  const idat = zlib.deflateSync(raw);
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return Buffer.concat([signature, chunk("IHDR", ihdr), chunk("IDAT", idat), chunk("IEND", Buffer.alloc(0))]);
}

function buildIco(sizes) {
  const images = sizes.map((size) => ({ size, png: encodePNG(size) }));
  const headerSize = 6 + images.length * 16;
  let offset = headerSize;
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2); // tipo: icona
  header.writeUInt16LE(images.length, 4);

  const entries = [];
  const datas = [];
  for (const { size, png } of images) {
    const entry = Buffer.alloc(16);
    entry[0] = size >= 256 ? 0 : size; // 0 = 256px
    entry[1] = size >= 256 ? 0 : size;
    entry[2] = 0;
    entry[3] = 0;
    entry.writeUInt16LE(1, 4); // color planes
    entry.writeUInt16LE(32, 6); // bit depth
    entry.writeUInt32LE(png.length, 8);
    entry.writeUInt32LE(offset, 12);
    offset += png.length;
    entries.push(entry);
    datas.push(png);
  }
  return Buffer.concat([header, ...entries, ...datas]);
}

const outDir = __dirname;
fs.writeFileSync(path.join(outDir, "icon.ico"), buildIco([16, 32, 48, 64, 128, 256]));
fs.writeFileSync(path.join(outDir, "icon.png"), encodePNG(256));
console.log("Scritti:", path.join(outDir, "icon.ico"), "e icon.png");
