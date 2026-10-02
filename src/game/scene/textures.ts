import * as THREE from 'three';
import { Rng } from '../../core/rng';

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')!];
}

/** Water-based turf: a deep blue with fine fibre noise and broad mowing stripes. */
export function turfColorTexture(base: string, stripe: string, stripes: number): THREE.CanvasTexture {
  const [c, g] = canvas(1024, 2048);
  g.fillStyle = base;
  g.fillRect(0, 0, c.width, c.height);
  for (let i = 0; i < stripes; i++) {
    if (i % 2) continue;
    g.fillStyle = stripe;
    g.fillRect(0, (i * c.height) / stripes, c.width, c.height / stripes);
  }
  const rng = new Rng(7);
  const img = g.getImageData(0, 0, c.width, c.height);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (rng.next() - 0.5) * 14;
    img.data[i] += n;
    img.data[i + 1] += n;
    img.data[i + 2] += n;
  }
  g.putImageData(img, 0, 0);
  // Worn patches on the penalty spot and the top of the D (texture v=0 is the goal line).
  const wear = (x: number, y: number, r: number, a: number) => {
    const grd = g.createRadialGradient(x, y, 0, x, y, r);
    grd.addColorStop(0, `rgba(160,190,230,${a})`);
    grd.addColorStop(1, 'rgba(160,190,230,0)');
    g.fillStyle = grd;
    g.fillRect(x - r, y - r, 2 * r, 2 * r);
  };
  const pxPerM = c.height / 91.4;
  wear(c.width / 2, 6.5 * pxPerM, 40, 0.18);
  wear(c.width / 2, 14.6 * pxPerM, 70, 0.08);
  wear(c.width / 2, 2 * pxPerM, 60, 0.12);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  t.flipY = false; // canvas top = goal line
  return t;
}

/** Tileable fibre normal map. */
export function turfNormalTexture(): THREE.CanvasTexture {
  const [c, g] = canvas(256, 256);
  const img = g.createImageData(256, 256);
  const rng = new Rng(3);
  const h = new Float32Array(256 * 256).map(() => rng.next());
  const at = (x: number, y: number) => h[((y + 256) % 256) * 256 + ((x + 256) % 256)];
  for (let y = 0; y < 256; y++) {
    for (let x = 0; x < 256; x++) {
      const dx = at(x + 1, y) - at(x - 1, y);
      const dy = at(x, y + 1) - at(x, y - 1);
      const i = (y * 256 + x) * 4;
      img.data[i] = 128 + dx * 60;
      img.data[i + 1] = 128 + dy * 60;
      img.data[i + 2] = 255;
      img.data[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

/** Goal net mesh texture (white cords on transparent). */
export function netTexture(): THREE.CanvasTexture {
  const [c, g] = canvas(128, 128);
  g.clearRect(0, 0, 128, 128);
  g.strokeStyle = 'rgba(255,255,255,0.95)';
  g.lineWidth = 5;
  g.beginPath();
  g.moveTo(0, 0);
  g.lineTo(128, 128);
  g.moveTo(128, 0);
  g.lineTo(0, 128);
  g.stroke();
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}

/** Pitch-side advertising board panel. */
export function boardTexture(text: string, bg: string, fg: string, sub?: string): THREE.CanvasTexture {
  const [c, g] = canvas(1024, 128);
  const grd = g.createLinearGradient(0, 0, 0, 128);
  grd.addColorStop(0, bg);
  grd.addColorStop(1, shade(bg, -30));
  g.fillStyle = grd;
  g.fillRect(0, 0, 1024, 128);
  g.fillStyle = fg;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = 'italic 900 78px "Barlow Condensed", "Arial Narrow", sans-serif';
  g.fillText(text, 512, sub ? 56 : 66);
  if (sub) {
    g.font = '700 26px "Barlow Condensed", "Arial Narrow", sans-serif';
    g.globalAlpha = 0.8;
    g.fillText(sub, 512, 104);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** Clubhouse windows: warm lit squares on a dark facade. */
export function windowsTexture(): THREE.CanvasTexture {
  const [c, g] = canvas(512, 128);
  g.fillStyle = '#000';
  g.fillRect(0, 0, 512, 128);
  const rng = new Rng(11);
  for (let x = 0; x < 16; x++) {
    for (let y = 0; y < 2; y++) {
      if (rng.chance(0.25)) continue;
      const a = rng.range(0.5, 1);
      g.fillStyle = `rgba(255,${190 + rng.int(0, 40)},${120 + rng.int(0, 50)},${a})`;
      g.fillRect(8 + x * 32, 18 + y * 56, 20, 34);
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function shade(hex: string, amt: number): string {
  const c = new THREE.Color(hex);
  c.offsetHSL(0, 0, amt / 255);
  return `#${c.getHexString()}`;
}
