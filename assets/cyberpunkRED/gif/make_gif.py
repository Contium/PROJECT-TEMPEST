import sys, random, math
sys.path.insert(0, r"C:\Users\nathu\AppData\Local\Temp\claude\91618236c26cf613\4a8c2368-2d66-4444-ac69-cd898d04e245\scratchpad\pylib")
from PIL import Image, ImageDraw, ImageFont, ImageChops

OUT = sys.argv[1]
W, H = 640, 360
N = 72            # frames
DUR = 55          # ms per frame (~4s loop)

BG    = (14, 14, 23)
RED   = (247, 80, 73)
DRED  = (90, 24, 28)
CYAN  = (94, 246, 255)
WHITE = (255, 255, 255)
MINT  = (29, 237, 131)
GOLD  = (241, 181, 55)

FONTS = r"C:\Windows\Fonts"
def bahn(size, var):
    f = ImageFont.truetype(FONTS + r"\bahnschrift.ttf", size)
    f.set_variation_by_name(var)
    return f
title_f = bahn(78, "Bold Condensed")
sub_f   = bahn(22, "SemiBold SemiCondensed")
mono    = ImageFont.truetype(FONTS + r"\consolab.ttf", 13)
mono_s  = ImageFont.truetype(FONTS + r"\consola.ttf", 11)

rng = random.Random(2045)

# --- static skyline ---------------------------------------------------------
sky = Image.new("RGB", (W, H), BG)
sd = ImageDraw.Draw(sky)
# perspective floor grid
hy = 250
for i in range(-20, 21):
    sd.line([(W/2 + i*14, hy), (W/2 + i*90, H)], fill=(38, 16, 24), width=1)
y, step = hy, 3
while y < H:
    sd.line([(0, y), (W, y)], fill=(38, 16, 24))
    step *= 1.35; y += step
buildings, windows = [], []
x = -10
while x < W + 10:
    bw = rng.randint(22, 60); bh = rng.randint(50, 170)
    if 230 < x < 410: bh = rng.randint(30, 80)   # keep the title clear
    buildings.append((x, hy - bh, x + bw, hy))
    for wx in range(x + 4, x + bw - 4, 7):
        for wy in range(hy - bh + 6, hy - 4, 9):
            if rng.random() < 0.28:
                windows.append((wx, wy, rng.random()))
    x += bw + rng.randint(-6, 4)
for b in buildings:
    sd.rectangle(b, fill=(20, 16, 28), outline=(60, 20, 26))
# spire
sd.polygon([(520, hy), (548, 40), (576, hy)], fill=(22, 16, 30), outline=(90, 28, 34))

drops = [(rng.randint(0, W), rng.randint(0, H), rng.randint(10, 22), rng.uniform(9, 15)) for _ in range(70)]

def corners(d, box, c, L=16, w=2):
    x0, y0, x1, y1 = box
    for (px, py, dx, dy) in [(x0, y0, 1, 1), (x1, y0, -1, 1), (x0, y1, 1, -1), (x1, y1, -1, -1)]:
        d.line([(px, py), (px + dx*L, py)], fill=c, width=w)
        d.line([(px, py), (px, py + dy*L)], fill=c, width=w)

def text_c(d, cx, y, s, f, fill):
    w = d.textlength(s, font=f)
    d.text((cx - w/2, y), s, font=f, fill=fill)

BOOT = ["> NCOT//BOOT.SEQ  v2045.11",
        "> NET.ICE ........ BYPASS",
        "> CYBERDECK ...... LINKED",
        "> NEURAL HANDSHAKE OK"]

def frame(t):
    p = t / N
    im = sky.copy()
    d = ImageDraw.Draw(im)

    # flickering windows
    for wx, wy, ph in windows:
        on = math.sin(t * 0.35 + ph * 40) > -0.6
        c = GOLD if ph > 0.93 else (CYAN if ph > 0.8 else RED)
        if on:
            d.rectangle((wx, wy, wx + 2, wy + 3), fill=tuple(int(v * (0.45 + 0.3*ph)) for v in c))
    # spire beacon
    if (t // 6) % 2 == 0:
        d.ellipse((544, 34, 552, 42), fill=RED)

    # rain
    for (rx, ry, ln, sp) in drops:
        yy = (ry + t * sp) % (H + 30) - 30
        xx = rx - (t * sp * 0.25) % W
        xx = xx % W
        d.line([(xx, yy), (xx - ln*0.25, yy + ln)], fill=(70, 90, 110), width=1)

    # HUD frame
    corners(d, (12, 12, W - 13, H - 13), RED, 22, 2)
    d.line([(40, 12), (200, 12)], fill=DRED, width=1)
    d.line([(W - 200, H - 13), (W - 40, H - 13)], fill=DRED, width=1)

    # boot log (typed)
    chars = int(t * 2.4)
    yy = 24
    for line in BOOT:
        shown = line[:max(0, chars)]
        chars -= len(line)
        d.text((28, yy), shown, font=mono, fill=RED if "OK" not in line else MINT)
        yy += 16
        if chars < 0: break

    # right-side readouts
    d.text((W - 160, 24), f"LAT 37.77 N", font=mono_s, fill=CYAN)
    d.text((W - 160, 38), f"LON 122.41 W", font=mono_s, fill=CYAN)
    d.text((W - 160, 52), f"SIG {70 + int(25*abs(math.sin(t*0.4))):>3}%", font=mono_s, fill=CYAN)
    d.text((W - 160, 66), f"HEAT {'#'*(1 + t % 5):<5}", font=mono_s, fill=(251, 147, 46))

    # title panel
    panel = (150, 118, 490, 228)
    d.rectangle(panel, fill=(14, 14, 23))
    d.rectangle(panel, outline=DRED)
    corners(d, panel, CYAN, 12, 2)
    text_c(d, W/2, 118, "NIGHT CITY", title_f, RED)
    text_c(d, W/2, 200, "OPERATIONS  TERMINAL", sub_f, CYAN)

    # progress bar
    prog = min(1.0, p / 0.78)
    bx0, by0, bx1, by1 = 170, 262, 470, 276
    d.rectangle((bx0, by0, bx1, by1), outline=RED)
    segs = 30
    for i in range(int(segs * prog)):
        sx = bx0 + 3 + i * ((bx1 - bx0 - 4) / segs)
        d.rectangle((sx, by0 + 3, sx + 6, by1 - 3), fill=RED if i < segs - 1 else WHITE)
    if prog < 1:
        dots = "." * (1 + (t // 4) % 3)
        d.text((bx0, by1 + 6), f"JACKING IN{dots}", font=mono, fill=RED)
        d.text((bx1 - 34, by1 + 6), f"{int(prog*100):>3}%", font=mono, fill=WHITE)
    else:
        if (t // 3) % 2 == 0:
            text_c(d, W/2, by1 + 6, "[ STATUS: NOMINAL ]  WELCOME, CHOOMBA", mono, MINT)

    # --- glitch passes ------------------------------------------------------
    glitch = t in (9, 10, 31, 32, 33, 50, 57, 58) or (prog >= 1 and t == N - 12)
    if glitch:
        r, g, b = im.split()
        off = rng.choice([-6, -4, 4, 6])
        r = ImageChops.offset(r, off, 0)
        b = ImageChops.offset(b, -off, 0)
        im = Image.merge("RGB", (r, g, b))
        for _ in range(rng.randint(3, 6)):
            y0 = rng.randint(100, 250); hh = rng.randint(3, 14)
            sl = im.crop((0, y0, W, y0 + hh))
            im.paste(ImageChops.offset(sl, rng.randint(-30, 30), 0), (0, y0))

    # scanlines + sweep
    ov = Image.new("RGB", (W, H), (0, 0, 0))
    od = ImageDraw.Draw(ov)
    for y in range(0, H, 3):
        od.line([(0, y), (W, y)], fill=(255, 255, 255))
    im = Image.blend(im, ImageChops.multiply(im, Image.new("RGB", (W, H), (200, 200, 200))), 0.0)
    mask = ov.convert("L").point(lambda v: 40 if v else 0)
    im.paste((0, 0, 0), mask=mask)
    sweep_y = int((t / N) * (H + 60)) - 30
    band = Image.new("RGB", (W, H), (0, 0, 0))
    bd = ImageDraw.Draw(band)
    for k in range(14):
        a = 1 - abs(k - 7) / 7
        bd.line([(0, sweep_y + k), (W, sweep_y + k)], fill=(int(45*a), int(12*a), int(16*a)))
    return ImageChops.add(im, band)

frames = [frame(t) for t in range(N)]

# global palette, no dithering -> no shimmer between frames
sheet = Image.new("RGB", (W, H * 6))
for i, t in enumerate([0, 10, 30, 50, 60, 70]):
    sheet.paste(frames[t], (0, H * i))
pal = sheet.quantize(colors=128, method=Image.Quantize.MEDIANCUT)
q = [f.quantize(palette=pal, dither=Image.Dither.NONE) for f in frames]
q[0].save(OUT, save_all=True, append_images=q[1:], duration=DUR, loop=0, optimize=True, disposal=1)
frames[40].save(OUT.replace(".gif", "_preview.png"))
frames[N - 6].save(OUT.replace(".gif", "_preview_end.png"))
print("ok", OUT)
