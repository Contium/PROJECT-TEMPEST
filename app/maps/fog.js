// Fog of war for Cartographer charts (chart-model.js), drawn on a canvas.
//
// drawFog() paints the fog itself: opaque everywhere, lifted inside revealed
// regions (those set to lift it), then the GM's brush strokes in order (clear or
// cover, soft-edged). The GM window shows it over the map, see-through; the
// players' copy has it baked in (bakeChart), so players never get the map under it.

import { liftedRegions } from './chart-model.js';

const FOG = '#0b0d12';
const HATCH = '#151923';
export const BAKE_EDGE = 2400; // the players' copy's longer side, at most

/** Paint the fog of `chart` into a w × h context. */
export function drawFog(ctx, w, h, chart, regions) {
  ctx.save();
  ctx.clearRect(0, 0, w, h);
  ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = FOG;
  ctx.fillRect(0, 0, w, h);
  // A faint hatching, so the fog reads as "unknown" rather than as a black picture.
  ctx.strokeStyle = HATCH;
  ctx.lineWidth = Math.max(1, Math.max(w, h) / 500);
  const step = Math.max(w, h) / 60;
  ctx.beginPath();
  for (let i = -h; i < w; i += step) {
    ctx.moveTo(i, 0);
    ctx.lineTo(i + h, h);
  }
  ctx.stroke();

  ctx.globalCompositeOperation = 'destination-out';
  ctx.fillStyle = '#000';
  for (const r of liftedRegions(chart, regions)) {
    ctx.beginPath();
    r.points.forEach(([x, y], i) => (i ? ctx.lineTo(x * w, y * h) : ctx.moveTo(x * w, y * h)));
    ctx.closePath();
    ctx.fill();
  }
  const side = Math.max(w, h);
  for (const [clear, x, y, r] of chart.ops ?? []) {
    const cx = x * w;
    const cy = y * h;
    const R = r * side;
    const g = ctx.createRadialGradient(cx, cy, R * 0.55, cx, cy, R);
    if (clear) {
      ctx.globalCompositeOperation = 'destination-out';
      g.addColorStop(0, 'rgba(0,0,0,1)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
    } else {
      ctx.globalCompositeOperation = 'source-over';
      g.addColorStop(0, FOG);
      g.addColorStop(1, 'rgba(11,13,18,0)');
    }
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

/** The players' copy of a chart under fog: its map with the fog painted over, as a WebP (or PNG) Blob. */
export async function bakeChart(chart, regions, image) {
  const scale = Math.min(1, BAKE_EDGE / Math.max(chart.width, chart.height));
  const w = Math.max(1, Math.round(chart.width * scale));
  const h = Math.max(1, Math.round(chart.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(image, 0, 0, w, h);
  const fog = document.createElement('canvas');
  fog.width = w;
  fog.height = h;
  drawFog(fog.getContext('2d'), w, h, chart, regions);
  ctx.drawImage(fog, 0, 0);
  const blob = await new Promise((r) => canvas.toBlob(r, 'image/webp', 0.86));
  return blob?.type === 'image/webp' ? blob : new Promise((r) => canvas.toBlob(r, 'image/png'));
}
