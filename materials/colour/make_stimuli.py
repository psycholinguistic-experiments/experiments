"""The colour task's 14 stimuli: OKLCH L = 0.70, C = 0.10, hue 160°–264° in 8°
steps (green → turquoise → blue). Converts to sRGB (Ottosson's OKLab
matrices), checks the gamut, rounds to 8-bit hex, and reports distances
between neighbours (OKLab ΔE and CIEDE2000 from the rounded hex values) for
the 1-, 2- and 3-step comparisons used in the task. Writes stimuli.json.
python3 materials/colour/make_stimuli.py"""
import json, math, os
def oklch_to_linear(L, C, h):
    a, b = C * math.cos(math.radians(h)), C * math.sin(math.radians(h))
    l_ = L + 0.3963377774 * a + 0.2158037573 * b
    m_ = L - 0.1055613458 * a - 0.0638541728 * b
    s_ = L - 0.0894841775 * a - 1.2914855480 * b
    l, m, s = l_ ** 3, m_ ** 3, s_ ** 3
    return (+4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
            -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
            -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s)
enc = lambda x: 12.92 * x if x <= 0.0031308 else 1.055 * x ** (1 / 2.4) - 0.055
dec = lambda x: x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4
def hex_to_lab(hx):
    r, g, b = (dec(int(hx[i:i + 2], 16) / 255) for i in (1, 3, 5))
    X = 0.4124564 * r + 0.3575761 * g + 0.1804375 * b; Y = 0.2126729 * r + 0.7151522 * g + 0.0721750 * b; Z = 0.0193339 * r + 0.1191920 * g + 0.9503041 * b
    f = lambda t: t ** (1 / 3) if t > 216 / 24389 else (24389 / 27 * t + 16) / 116
    fx, fy, fz = f(X / 0.95047), f(Y / 1.0), f(Z / 1.08883)
    return (116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz))
def hex_to_oklab(hx):
    r, g, b = (dec(int(hx[i:i + 2], 16) / 255) for i in (1, 3, 5))
    l = 0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b; m = 0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b; s = 0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b
    l, m, s = (x ** (1 / 3) for x in (l, m, s))
    return (0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s, 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s)
def de2000(L1, a1, b1, L2, a2, b2):
    C1, C2 = math.hypot(a1, b1), math.hypot(a2, b2); Cm = (C1 + C2) / 2
    G = 0.5 * (1 - math.sqrt(Cm ** 7 / (Cm ** 7 + 25 ** 7))); a1p, a2p = a1 * (1 + G), a2 * (1 + G)
    C1p, C2p = math.hypot(a1p, b1), math.hypot(a2p, b2)
    h1p, h2p = math.degrees(math.atan2(b1, a1p)) % 360, math.degrees(math.atan2(b2, a2p)) % 360
    dL, dC = L2 - L1, C2p - C1p
    dh = h2p - h1p
    if C1p * C2p == 0: dh = 0
    elif dh > 180: dh -= 360
    elif dh < -180: dh += 360
    dH = 2 * math.sqrt(C1p * C2p) * math.sin(math.radians(dh / 2))
    Lm, Cmp = (L1 + L2) / 2, (C1p + C2p) / 2
    hm = h1p + h2p if C1p * C2p == 0 else ((h1p + h2p) / 2 if abs(h1p - h2p) <= 180 else ((h1p + h2p + 360) / 2 if h1p + h2p < 360 else (h1p + h2p - 360) / 2))
    T = 1 - 0.17 * math.cos(math.radians(hm - 30)) + 0.24 * math.cos(math.radians(2 * hm)) + 0.32 * math.cos(math.radians(3 * hm + 6)) - 0.20 * math.cos(math.radians(4 * hm - 63))
    dth = 30 * math.exp(-((hm - 275) / 25) ** 2); Rc = 2 * math.sqrt(Cmp ** 7 / (Cmp ** 7 + 25 ** 7))
    Sl = 1 + 0.015 * (Lm - 50) ** 2 / math.sqrt(20 + (Lm - 50) ** 2); Sc = 1 + 0.045 * Cmp; Sh = 1 + 0.015 * Cmp * T; Rt = -math.sin(math.radians(2 * dth)) * Rc
    return math.sqrt((dL / Sl) ** 2 + (dC / Sc) ** 2 + (dH / Sh) ** 2 + Rt * (dC / Sc) * (dH / Sh))
out = []
for i, h in enumerate(range(160, 265, 8)):
    lin = oklch_to_linear(0.70, 0.10, h)
    inside = all(-1e-9 <= v <= 1 + 1e-9 for v in lin)
    rgb = [round(max(0, min(1, enc(max(0, v)))) * 255) for v in lin]
    hx = '#%02x%02x%02x' % tuple(rgb)
    lab = hex_to_lab(hx); ok = hex_to_oklab(hx)
    out.append({'id': f'C{i + 1:02d}', 'oklch': [0.70, 0.10, h], 'hex': hx, 'rgb': rgb, 'in_gamut': inside, 'lab': [round(v, 2) for v in lab], 'oklab': [round(v, 4) for v in ok]})
for k in (1, 2, 3):
    de = [de2000(*out[i]['lab'], *out[i + k]['lab']) for i in range(14 - k)]
    dok = [math.dist(out[i]['oklab'], out[i + k]['oklab']) for i in range(14 - k)]
    print(f'{k}-step: CIEDE2000 {min(de):.2f}–{max(de):.2f} (mean {sum(de)/len(de):.2f}); OKLab ΔE {min(dok):.4f}–{max(dok):.4f}')
print('all in sRGB gamut:', all(c['in_gamut'] for c in out))
print(' '.join(c['id'] + ' ' + c['hex'] for c in out))
json.dump(out, open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'stimuli.json'), 'w'), indent=1)
