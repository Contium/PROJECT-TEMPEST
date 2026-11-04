// City Map geometry: no DOM, so it can be tested in Node.
//
// A city map is an atlas image (several layers of the same size) plus district
// outlines in 0..1 map coordinates. The view is { x, y, scale }: the image's
// top-left corner sits at (x, y) on screen and one image pixel is `scale` screen
// pixels wide.

/** The atlas layers, in the order the switch shows them. */
export const NIGHT_CITY = {
  slug: 'nightcity',
  base: '/assets/maps/nightcity',
  width: 3300,
  height: 5100,
  layers: [
    { id: 'districts', label: 'Districts', file: 'districts.jpg' },
    { id: 'streets', label: 'Streets', file: 'streets.jpg' },
    { id: 'locations', label: 'Locations', file: 'locations.jpg' },
    { id: 'full', label: 'Full', file: 'full.jpg' },
  ],
};

export const CITY_MAPS = { nightcity: NIGHT_CITY };

export const MIN_ZOOM = 0.5; // relative to "fit"
export const MAX_ZOOM = 12;

/** Districts as the viewer uses them: rings in image pixels, plus their bounds. */
export function prepareDistricts(data, { width, height }) {
  return (data?.districts ?? [])
    .filter((d) => d && typeof d.name === 'string' && Array.isArray(d.rings) && d.rings.length)
    .map((d) => {
      const rings = d.rings.map((r) => r.map(([x, y]) => [x * width, y * height])).filter((r) => r.length >= 3);
      const xs = rings.flat().map((p) => p[0]);
      const ys = rings.flat().map((p) => p[1]);
      return {
        id: String(d.id ?? d.name.toLowerCase().replace(/\s+/g, '-')),
        name: d.name,
        area: Number(d.area) || 0,
        center: [(d.center?.[0] ?? 0.5) * width, (d.center?.[1] ?? 0.5) * height],
        rings,
        bounds: { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) },
      };
    })
    .filter((d) => d.rings.length)
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** SVG path data for a district's rings. */
export const pathOf = (rings) => rings.map((r) => `M${r.map(([x, y]) => `${x.toFixed(1)} ${y.toFixed(1)}`).join('L')}Z`).join('');

/** Even-odd point-in-polygon over all of a district's rings. */
export function contains(rings, [px, py]) {
  let inside = false;
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i];
      const [xj, yj] = ring[j];
      if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
    }
  }
  return inside;
}

/** The district under an image point, if any. */
export const districtAt = (districts, point) => districts.find((d) => contains(d.rings, point)) ?? null;

/** The view that fits a box (image pixels) into a viewport, with some padding. */
export function fitBox(box, viewport, pad = 24) {
  const w = Math.max(box.x1 - box.x0, 1);
  const h = Math.max(box.y1 - box.y0, 1);
  const scale = Math.min((viewport.width - pad * 2) / w, (viewport.height - pad * 2) / h);
  return {
    scale,
    x: viewport.width / 2 - ((box.x0 + box.x1) / 2) * scale,
    y: viewport.height / 2 - ((box.y0 + box.y1) / 2) * scale,
  };
}

/** The view that shows the whole map. */
export const fitMap = (map, viewport) => fitBox({ x0: 0, y0: 0, x1: map.width, y1: map.height }, viewport, 12);

/**
 * Keep a view within its zoom limits (relative to the fit scale), and keep some
 * of the map on screen.
 */
export function clampView(view, map, viewport) {
  const fit = fitMap(map, viewport).scale;
  const scale = Math.min(Math.max(view.scale, fit * MIN_ZOOM), fit * MAX_ZOOM);
  const w = map.width * scale;
  const h = map.height * scale;
  const margin = 80;
  const x = Math.min(Math.max(view.x, margin - w), viewport.width - margin);
  const y = Math.min(Math.max(view.y, margin - h), viewport.height - margin);
  return { x, y, scale };
}

/** Zoom by `factor` keeping the screen point (sx, sy) over the same map point. */
export function zoomAt(view, factor, sx, sy) {
  const scale = view.scale * factor;
  return { scale, x: sx - (sx - view.x) * factor, y: sy - (sy - view.y) * factor };
}

/**
 * zoomAt, but the zoom stops at the limits. The factor is capped *before* the
 * view moves; capping only the scale afterwards would leave the position of the
 * uncapped zoom, and the map would slide away at the limit.
 */
export function zoomWithin(view, factor, sx, sy, map, viewport) {
  const fit = fitMap(map, viewport).scale;
  const scale = Math.min(Math.max(view.scale * factor, fit * MIN_ZOOM), fit * MAX_ZOOM);
  return zoomAt(view, scale / view.scale, sx, sy);
}

/** Screen pixels → image pixels. */
export const toImage = (view, sx, sy) => [(sx - view.x) / view.scale, (sy - view.y) / view.scale];

/** Zoom relative to the fit view, for the readout. */
export const relativeZoom = (view, map, viewport) => view.scale / fitMap(map, viewport).scale;

/** A district's share of the city's mapped land, as a percentage. */
export function shareOf(district, districts) {
  const total = districts.reduce((sum, d) => sum + d.area, 0);
  return total ? (district.area / total) * 100 : 0;
}
