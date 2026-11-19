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

function atlasScript(scale) {
  const adv = {};
  for (const ch of CHARS) adv[ch] = advanceOf(ch);
  return `(() => {
    const ADV = ${JSON.stringify(adv)};
    const s = ${scale}, H = ${HEIGHT_PT} * s;
    const c = document.createElement('canvas');
    const ctx = c.getContext('2d');
    const font = (${FONT_PT} * s) + 'px -apple-system, "SF Pro Text", "PingFang SC", sans-serif';
    ctx.font = font;
    const m = ctx.measureText('0月');
    const asc = m.fontBoundingBoxAscent, desc = m.fontBoundingBoxDescent;
    const base = Math.round((H - (asc + desc)) / 2 + asc);
    const out = {};
    for (const ch of ${JSON.stringify(CHARS)}) {
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
    return { 1: a1, 2: a2 };
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

module.exports = { buildAtlas, composeBitmap, createClockImageMaker, CHARS, advanceOf };
