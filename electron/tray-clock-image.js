'use strict';

// v0.1.38: draw the menu bar clock as a template image instead of an
// NSStatusItem title. A text title gets ~2pt extra padding on each side from
// AppKit; an image item only has the system's 8pt. Glyphs are rasterised once
// (1x and 2x) in a hidden window, then each second's image is composed in JS
// from those alpha masks, so the per-second cost is a small buffer copy.

const CHARS = '0123456789: 月日';
const DIGITS = '0123456789';
const FONT_PT = 13;
const HEIGHT_PT = 22;
// Advances of NSFont.monospacedDigitSystemFont(13) measured on macOS (what the
// old text title used), so the image is exactly as wide as the title text.
const ADVANCE_PT = { digit: 8.1123046875, ':': 3.783203125, ' ': 3.580078125, cjk: 12.898832684824903 };
function advanceOf(ch) {
  if (DIGITS.includes(ch)) return ADVANCE_PT.digit;
  if (ch === '月' || ch === '日') return ADVANCE_PT.cjk;
  return ADVANCE_PT[ch];
}

function atlasScript(scale, chars = CHARS, fontPt = FONT_PT, heightPt = HEIGHT_PT, weight = 400) {
  const adv = {};
  for (const ch of chars) adv[ch] = (advanceOf(ch) ?? ADVANCE_PT.cjk) * fontPt / FONT_PT;
  return `(() => {
    const ADV = ${JSON.stringify(adv)};
    const s = ${scale}, H = ${heightPt} * s;
    const c = document.createElement('canvas');
    const ctx = c.getContext('2d');
    const font = '${weight} ' + (${fontPt} * s) + 'px -apple-system, "SF Pro Text", "PingFang SC", sans-serif';
    ctx.font = font;
    const m = ctx.measureText('0月');
    const asc = m.fontBoundingBoxAscent, desc = m.fontBoundingBoxDescent;
    const base = Math.round((H - (asc + desc)) / 2 + asc);
    const out = {};
    for (const ch of ${JSON.stringify(chars)}) {
      const adv = ADV[ch] * s;
      const w = Math.max(1, Math.ceil(adv) + 1);
      c.width = w; c.height = H;
      ctx.font = font; ctx.fillStyle = '#000'; ctx.textBaseline = 'alphabetic';
      const gw = ctx.measureText(ch).width;
      ctx.clearRect(0, 0, w, H);
      ctx.fillText(ch, (adv - gw) / 2, base);
      const data = ctx.getImageData(0, 0, w, H).data;
      const a = new Array(w * H);
      for (let i = 0; i < w * H; i++) a[i] = data[i * 4 + 3];
      out[ch] = { w, a, adv: ADV[ch] };
    }
    return { H, out };
  })()`;
}

async function buildAtlas(BrowserWindow) {
  const win = new BrowserWindow({
    show: false, width: 64, height: 64, skipTaskbar: true,
    webPreferences: { offscreen: true, sandbox: true, contextIsolation: true }
  });
  try {
    await win.loadURL('data:text/html;charset=utf-8,<html><body></body></html>');
    const a1 = await win.webContents.executeJavaScript(atlasScript(1));
    const a2 = await win.webContents.executeJavaScript(atlasScript(2));
    const compact = {};
    const seconds = {};
    for (const scale of [1,2]) {
      compact[scale] = await win.webContents.executeJavaScript(atlasScript(scale, '0123456789周日一二三四五六', 8, 10, 600));
      seconds[scale] = await win.webContents.executeJavaScript(atlasScript(scale, DIGITS, 9, 12, 650));
    }
    return { 1: a1, 2: a2, compact, seconds };
  } finally {
    if (!win.isDestroyed()) win.destroy();
  }
}

function composeBitmap(atlas, text, scale) {
  const glyphs = [];
  let total = 0;
  for (const ch of text) {
    const g = atlas.out[ch];
    if (!g) return null;
    glyphs.push({ g, x: Math.round(total * scale) });
    total += g.adv;
  }
  const H = atlas.H;
  const W = Math.max(1, Math.ceil(total * scale));
  const buf = Buffer.alloc(W * H * 4); // BGRA, black ink, alpha from mask
  for (const { g, x: x0 } of glyphs) {
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < g.w && x0 + x < W; x++) {
        const al = g.a[y * g.w + x];
        const i = ((y * W) + x0 + x) * 4 + 3;
        if (al > buf[i]) buf[i] = al;
      }
    }
  }
  return { buf, W, H };
}

function createClockImageMaker(nativeImage, atlas) {
  return function make(text) {
    const b2 = composeBitmap(atlas[2], text, 2);
    const b1 = composeBitmap(atlas[1], text, 1);
    if (!b2 || !b1) return null;
    const img = nativeImage.createFromBitmap(b1.buf, { width: b1.W, height: b1.H, scaleFactor: 1 });
    const hi = nativeImage.createFromBitmap(b2.buf, { width: b2.W, height: b2.H, scaleFactor: 2 });
    img.addRepresentation({ scaleFactor: 2, buffer: hi.toPNG() });
    img.setTemplateImage(true);
    return img;
  };
}

const COMPACT_WIDTH = 82;
function composeCompactBitmap(atlas, face, scale, dark) {
  const H = HEIGHT_PT * scale, W = COMPACT_WIDTH * scale;
  const buf = Buffer.alloc(W * H * 4);
  const ink = dark ? 244 : 28;
  const cyanGreen = dark ? [61, 208, 127] : [16, 151, 79];
  function pixel(x,y,r,g,b,a) {
    if (x < 0 || y < 0 || x >= W || y >= H) return;
    const i = (y * W + x) * 4;
    if (a > buf[i+3]) { buf[i]=b; buf[i+1]=g; buf[i+2]=r; buf[i+3]=a; }
  }
  function glyphs(mask, text, center, top) {
    const layer = composeBitmap(mask, text, scale);
    if (!layer) return;
    const left = Math.round(center * scale - layer.W / 2), y0 = Math.round(top * scale);
    for (let y=0;y<layer.H;y++) for (let x=0;x<layer.W;x++) {
      const a = layer.buf[(y * layer.W + x) * 4 + 3];
      if (a) pixel(left+x,y0+y,ink,ink,ink,a);
    }
  }
  const tau = Math.PI * 2, progress = Number(face.seconds) / 60;
  const radius = 9.25, halfStroke = 0.85;
  for (let y=0;y<H;y++) for (let x=0;x<22*scale;x++) {
    const dx=(x+0.5)/scale-11,dy=(y+0.5)/scale-11;
    const coverage = Math.min(1, Math.max(0, (halfStroke - Math.abs(Math.hypot(dx,dy)-radius)) * scale + 0.5));
    if (!coverage) continue;
    const angle = (Math.atan2(dx,-dy)+tau)%tau;
    if (angle < tau*progress) pixel(x,y,...cyanGreen,Math.round(255*coverage));
    else pixel(x,y,ink,ink,ink,Math.round(60*coverage));
  }
  glyphs(atlas.seconds[scale],face.seconds,11,5);
  glyphs(atlas.compact[scale],face.day+'日',33,1);
  glyphs(atlas.compact[scale],face.weekday,33,11);
  glyphs(atlas[scale],face.time,63,0);
  return {buf,W,H};
}

function createCompactClockImageMaker(nativeImage, atlas) {
  return (face, dark) => {
    const at = (s) => {
      const b = composeCompactBitmap(atlas, face, s, dark);
      return nativeImage.createFromBitmap(b.buf,{width:b.W,height:b.H,scaleFactor:s});
    };
    const img=at(1);
    img.addRepresentation({scaleFactor:2,buffer:at(2).toPNG()});
    img.setTemplateImage(false);
    return img;
  };
}

module.exports = { buildAtlas, composeBitmap, createClockImageMaker, composeCompactBitmap, createCompactClockImageMaker, CHARS, advanceOf };
