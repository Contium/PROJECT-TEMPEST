"""Trace Night City's districts from the 2045 atlas into outlines for the City Map.

The atlas marks district borders with red dotted lines (drawn over the roads)
and water in blue-teal. This works on a half-size 24-bit BMP of the
"w District Names" layer (3300 x 5100; quarter size works too, less well):

  1. borders = red dots joined into lines (plus MANUAL_WALLS); water is a wall too
  2. each district is flood-filled from a seed point (its label) inside the walls
  3. regions grow back over the walls they were shrunk by, meeting their neighbours
  4. each region's outline is traced and simplified, in 0..1 map coordinates

Usage: python scripts/extract-districts.py <quarter.bmp> <out.json> [preview.bmp]
Needs only numpy. The seeds below are label positions on a 1294 x 2000 copy of
the map; they're scaled to the working size.
"""

import json
import struct
import sys

import numpy as np

# name, (x, y) on the 1294 x 2000 map, [extra seeds for pieces split off by water or walls]
DISTRICTS = [
    ("NorCal Military Base", (522, 475), [(330, 470)]),
    ("Watson Development", (565, 628), []),
    ("Kabuki", (668, 640), []),
    ("New Westbrook", (783, 600), [(760, 470)]),
    ("Charter Hill", (928, 700), []),
    ("Exec Zone", (946, 800), []),
    ("Little Europe", (500, 822), []),
    ("Upper Marina", (706, 834), []),
    ("Downtown", (390, 890), []),
    ("The Hot Zone", (613, 910), []),
    ("Little China", (785, 958), []),
    ("University District", (390, 970), []),
    ("Old Japantown", (693, 1028), []),
    ("South Night City", (436, 1055), []),
    ("The Glen", (575, 1063), []),
    ("Old Combat Zone", (663, 1110), []),
    ("Port of Night City", (382, 1118), [(368, 1149), (361, 1063)]),
    ("Reclamation Zone", (456, 1158), []),
    ("Heywood Docks", (905, 1046), []),
    ("North Heywood", (975, 1100), []),
    ("Heywood Industrial Zone", (792, 1180), []),
    ("Santo Domingo", (912, 1250), []),
    ("Pacifica Playground", (434, 1334), []),
    ("Rancho Coronado", (649, 1398), []),
    ("Morro Rock", (271, 777), []),
]
SEED_W = 1294.0

# Borders the dots don't close (or the atlas leaves implied), drawn by hand on the
# full 6600 x 10200 atlas.
MANUAL_WALLS = [
    # The Glen | Old Combat Zone, down the Walters overpass
    [(3250, 5380), (3247, 5600), (3233, 5767), (3200, 5860)],
    [(3233, 5400), (3540, 5400)],
    # Port of Night City | South Night City, along Prime Meridian Way
    [(1980, 5120), (1980, 5550), (2440, 5556), (2500, 5580)],
    # Reclamation Zone | Port of Night City, down Palms View Way
    [(2360, 5560), (2200, 5760), (2060, 6000)],
    # Reclamation Zone | South Night City (east side)
    [(2500, 5580), (2500, 5800), (2490, 5990)],
    # Heywood Docks | North Heywood, along 7th St and Wilson St
    [(4150, 5420), (4900, 5470), (5560, 5470), (5720, 5460)],
]
ATLAS_W = 6600.0

# Districts too cut up by roads and coast dots to flood-fill: the unclaimed land
# inside these (full-atlas) outlines goes to them.
MANUAL_FILLS = {
    "Port of Night City": [(1480, 5060), (1995, 5060), (1995, 5562), (2370, 5562), (2060, 6020), (1480, 6020)],
}


def inside_polygon(shape, poly):
    h, w = shape
    ys, xs = np.mgrid[0:h, 0:w]
    xs, ys = xs + 0.5, ys + 0.5
    hit = np.zeros(shape, dtype=bool)
    for (x0, y0), (x1, y1) in zip(poly, poly[1:] + poly[:1]):
        if y0 == y1:
            continue
        crosses = ((y0 <= ys) & (ys < y1)) | ((y1 <= ys) & (ys < y0))
        hit ^= crosses & (xs < x0 + (ys - y0) * (x1 - x0) / (y1 - y0))
    return hit


def draw_walls(shape, scale, width):
    out = np.zeros(shape, dtype=bool)
    h, w = shape
    for line in MANUAL_WALLS:
        for (x0, y0), (x1, y1) in zip(line, line[1:]):
            n = int(max(abs(x1 - x0), abs(y1 - y0)) * scale) + 2
            xs = np.linspace(x0, x1, n) * scale
            ys = np.linspace(y0, y1, n) * scale
            out[ys.round().astype(int).clip(0, h - 1), xs.round().astype(int).clip(0, w - 1)] = True
    return dilate(out, width)


def read_bmp(path):
    with open(path, "rb") as f:
        data = f.read()
    offset = struct.unpack_from("<I", data, 10)[0]
    w, h = struct.unpack_from("<ii", data, 18)
    bpp = struct.unpack_from("<H", data, 28)[0]
    assert bpp == 24, f"need a 24-bit BMP, got {bpp}"
    row = (w * 3 + 3) & ~3
    raw = np.frombuffer(data, dtype=np.uint8, count=row * abs(h), offset=offset).reshape(abs(h), row)[:, : w * 3]
    img = raw.reshape(abs(h), w, 3)[:, :, ::-1]  # BGR -> RGB
    return img[::-1] if h > 0 else img  # bottom-up rows


def write_bmp(path, rgb):
    h, w, _ = rgb.shape
    row = (w * 3 + 3) & ~3
    out = np.zeros((h, row), dtype=np.uint8)
    out[:, : w * 3] = rgb[::-1, :, ::-1].reshape(h, w * 3)
    header = struct.pack("<2sIHHI", b"BM", 54 + out.size, 0, 0, 54) + struct.pack("<IiiHHIIiiII", 40, w, h, 1, 24, 0, out.size, 2835, 2835, 0, 0)
    with open(path, "wb") as f:
        f.write(header + out.tobytes())


def shift(a, dy, dx):
    out = np.zeros_like(a)
    ys = slice(max(dy, 0), a.shape[0] + min(dy, 0))
    yd = slice(max(-dy, 0), a.shape[0] + min(-dy, 0))
    xs = slice(max(dx, 0), a.shape[1] + min(dx, 0))
    xd = slice(max(-dx, 0), a.shape[1] + min(-dx, 0))
    out[ys, xs] = a[yd, xd]
    return out


def dilate(mask, r):
    out = mask.copy()
    for dy in range(-r, r + 1):
        for dx in range(-r, r + 1):
            if dy * dy + dx * dx <= r * r:
                out |= shift(mask, dy, dx)
    return out


def join_dots(red, cell, reach):
    """Turn dotted lines into solid ones: every red cell is joined by a line to the
    red cells within `reach` pixels. Dots sit a few pixels apart along a border, so
    neighbours join up; separate borders are further apart than that."""
    h, w = red.shape
    ch, cw = h // cell, w // cell
    cells = red[: ch * cell, : cw * cell].reshape(ch, cell, cw, cell).any(axis=(1, 3))
    cy, cx = np.nonzero(cells)
    pts = np.stack([cy, cx], axis=1) * cell + cell // 2
    n = int(np.ceil(reach / cell))
    a_list, b_list = [], []
    index = -np.ones((ch, cw), dtype=np.int64)
    index[cy, cx] = np.arange(len(cy))
    for dy in range(0, n + 1):
        for dx in range(-n, n + 1):
            if (dy == 0 and dx <= 0) or (dy * dy + dx * dx) * cell * cell > reach * reach:
                continue
            ny, nx = cy + dy, cx + dx
            ok = (ny < ch) & (nx >= 0) & (nx < cw)
            j = np.full(len(cy), -1)
            j[ok] = index[ny[ok], nx[ok]]
            hit = j >= 0
            a_list.append(np.nonzero(hit)[0])
            b_list.append(j[hit])
    out = red.copy()
    if a_list:
        a, b = np.concatenate(a_list), np.concatenate(b_list)
        steps = int(reach) + 2
        t = np.linspace(0, 1, steps)[None, :, None]
        line = (pts[a][:, None, :] * (1 - t) + pts[b][:, None, :] * t).round().astype(np.int64).reshape(-1, 2)
        out[line[:, 0].clip(0, h - 1), line[:, 1].clip(0, w - 1)] = True
    return out


def flood(free, seeds):
    """Grow from seed pixels through `free` pixels (4-connected) until nothing changes."""
    region = np.zeros_like(free)
    for y, x in seeds:
        if free[y, x]:
            region[y, x] = True
    # Grow inside a bounding box that widens as needed: much faster than whole-image passes.
    while True:
        ys, xs = np.nonzero(region)
        if not len(ys):
            return region
        y0, y1 = max(ys.min() - 40, 0), min(ys.max() + 41, free.shape[0])
        x0, x1 = max(xs.min() - 40, 0), min(xs.max() + 41, free.shape[1])
        sub, ok = region[y0:y1, x0:x1].copy(), free[y0:y1, x0:x1]
        for _ in range(60):
            grown = (sub | shift(sub, 1, 0) | shift(sub, -1, 0) | shift(sub, 0, 1) | shift(sub, 0, -1)) & ok
            if (grown == sub).all():
                region[y0:y1, x0:x1] = sub
                ys2, xs2 = np.nonzero(sub)
                touches = ys2.min() == 0 and y0 > 0 or xs2.min() == 0 and x0 > 0 or ys2.max() == sub.shape[0] - 1 and y1 < free.shape[0] or xs2.max() == sub.shape[1] - 1 and x1 < free.shape[1]
                if not touches:
                    return region
                break
            sub = grown
        region[y0:y1, x0:x1] = sub


def trace(mask):
    """The outer boundary of the largest blob in `mask`, as (x, y) pixel corners (Moore tracing)."""
    ys, xs = np.nonzero(mask)
    start = min(zip(ys, xs))  # top-most, then left-most pixel
    dirs = [(0, 1), (1, 1), (1, 0), (1, -1), (0, -1), (-1, -1), (-1, 0), (-1, 1)]
    h, w = mask.shape
    inside = lambda y, x: 0 <= y < h and 0 <= x < w and mask[y, x]
    path = [start]
    cur, back = start, 4  # came from the left
    for _ in range(200000):
        for i in range(8):
            d = (back + 1 + i) % 8
            ny, nx = cur[0] + dirs[d][0], cur[1] + dirs[d][1]
            if inside(ny, nx):
                back = (d + 4) % 8
                cur = (ny, nx)
                break
        else:
            break
        if cur == start:
            break
        path.append(cur)
    return [(x + 0.5, y + 0.5) for y, x in path]


def simplify(points, tol):
    """Douglas-Peucker on a closed ring."""
    if len(points) < 4:
        return points
    pts = np.array(points)

    def rdp(a, b):
        seg = pts[a : b + 1]
        p, q = seg[0], seg[-1]
        d = q - p
        n = np.hypot(*d) or 1.0
        dist = np.abs(d[0] * (seg[:, 1] - p[1]) - d[1] * (seg[:, 0] - p[0])) / n
        i = int(np.argmax(dist))
        if dist[i] > tol:
            return rdp(a, a + i)[:-1] + rdp(a + i, b)
        return [a, b]

    mid = len(points) // 2
    keep = rdp(0, mid)[:-1] + rdp(mid, len(points) - 1)
    return [tuple(pts[i]) for i in keep]


def main(src, out_json, preview=None):
    img = read_bmp(src).astype(np.int16)
    h, w, _ = img.shape
    r, g, b = img[:, :, 0], img[:, :, 1], img[:, :, 2]
    # Downsizing blends the thin dots into the dark ground, so "red" is generous.
    red = (r > 75) & (r - g > 38) & (r - b > 30)
    water = (b > 70) & (b - r > 35) & (g > 50)
    k = w / 1650.0  # 1 at quarter size, 2 at half
    radius = max(1, round(1 * k))
    walls = dilate(join_dots(red, cell=max(2, round(3 * k)), reach=9 * k), radius) | dilate(water, 1)
    walls |= draw_walls(walls.shape, w / ATLAS_W, max(2, round(2 * k)))
    free = ~walls

    scale = w / SEED_W
    labels = np.zeros((h, w), dtype=np.int16)
    report = []
    for i, (name, seed, extra) in enumerate(DISTRICTS, start=1):
        seeds = [(int(y * scale), int(x * scale)) for x, y in [seed] + extra]
        # Nudge seeds that land on a wall (label text over a border) to the nearest free pixel.
        fixed = []
        for y, x in seeds:
            if not free[y, x]:
                best = None
                for rr in range(1, 30):
                    win = free[max(y - rr, 0) : y + rr + 1, max(x - rr, 0) : x + rr + 1]
                    if win.any():
                        yy, xx = np.argwhere(win)[0]
                        best = (max(y - rr, 0) + yy, max(x - rr, 0) + xx)
                        break
                if best:
                    y, x = best
            fixed.append((y, x))
        region = flood(free & (labels == 0), fixed)
        labels[region] = i
        report.append((name, int(region.sum())))

    land = ~dilate(water, 0)
    names = [d[0] for d in DISTRICTS]
    for name, poly in MANUAL_FILLS.items():
        s = w / ATLAS_W
        x0, x1 = int(min(p[0] for p in poly) * s), int(max(p[0] for p in poly) * s) + 1
        y0, y1 = int(min(p[1] for p in poly) * s), int(max(p[1] for p in poly) * s) + 1
        box = inside_polygon((y1 - y0, x1 - x0), [(x * s - x0, y * s - y0) for x, y in poly])
        sub = labels[y0:y1, x0:x1]
        sub[box & (sub == 0) & land[y0:y1, x0:x1]] = names.index(name) + 1

    # Grow regions back over the walls they were shrunk by, until neighbours meet (never into water).
    for _ in range(2 * radius + 3):
        grew = False
        for i in range(1, len(DISTRICTS) + 1):
            m = labels == i
            ring = dilate(m, 1) & (labels == 0) & land
            if ring.any():
                labels[ring] = i
                grew = True
        if not grew:
            break

    districts = []
    for i, (name, _, _) in enumerate(DISTRICTS, start=1):
        mask = labels == i
        if mask.sum() < 50:
            print(f"!! {name}: nothing found")
            continue
        # One outline per separate piece (e.g. NorCal's pier), skipping crumbs.
        rings, rest = [], mask.copy()
        while rest.sum() >= 50:
            ys, xs = np.nonzero(rest)
            piece = flood(rest, [(ys[0], xs[0])])
            rest &= ~piece
            if piece.sum() >= max(400 * k * k, 0.02 * mask.sum()):
                rings.append(simplify(trace(piece), 1.2 * k))
        ys, xs = np.nonzero(mask)
        districts.append({
            "id": name.lower().replace(" ", "-"),
            "name": name,
            "area": round(float(mask.sum()) / (w * h), 5),
            "center": [round(float(xs.mean()) / w, 4), round(float(ys.mean()) / h, 4)],
            "rings": [[[round(x / w, 4), round(y / h, 4)] for x, y in ring] for ring in rings],
        })
    with open(out_json, "w", encoding="utf-8") as f:
        json.dump({"source": "Night City 2045 Atlas (R. Talsorian Games), traced", "width": w, "height": h, "districts": districts}, f, separators=(",", ":"))
    for name, px in report:
        print(f"{name:26s} {px:8d} px")

    if preview:
        # Colour each district so leaks and gaps are easy to spot.
        rng = np.random.default_rng(7)
        palette = np.vstack([[0, 0, 0], rng.integers(60, 255, size=(len(DISTRICTS), 3))]).astype(np.uint8)
        base = (img.clip(0, 255) * 0.35).astype(np.uint8)
        col = palette[labels]
        out = np.where((labels > 0)[:, :, None], (base * 0.4 + col * 0.6).astype(np.uint8), base)
        out[walls & ~dilate(water, 1)] = [255, 40, 40]
        write_bmp(preview, out)


if __name__ == "__main__":
    main(*sys.argv[1:])
