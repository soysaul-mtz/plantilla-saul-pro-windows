"""Revisión final, cuadro por cuadro, del video TERMINADO (el que se entrega). Último paso antes de entregar.

Uso:  .venv/bin/python revisar_final.py <proyecto> [video] [--cada N]
      .venv/bin/python revisar_final.py <carpeta> <video_de_cualquier_editor>   (sin pages.json: revisa imagen, audio y
      zona segura de todo el texto que vea; las hojas quedan en <carpeta>/revision_final)
Lee con Vision TODOS los fotogramas (bin/fotogramas: cara + texto real en pantalla) y además la imagen de cada uno:
  1. subtítulo encima de la cara (texto que de verdad aparece, no el que se planeó)
  2. subtítulo fuera de la zona segura de Instagram
  3. subtítulo que casi no se ve (en menos de la mitad de los cuadros donde debería estar completo)
  4. cuadros negros o en blanco antes del fundido final
  5. destellos de un solo cuadro (un cuadro distinto entre dos iguales: una toma o un corte que se coló)
  6. imagen congelada (> 0.5 s sin ningún cambio antes del fundido)
  7. audio que satura (pico > −0.3 dBFS) y volumen final fuera de ±1 LUFS de lo pedido
Arma hojas de contacto en <proyecto>/revision_final/ (uno de cada N cuadros; los que tienen problema van con marco rojo)
para revisarlas con los ojos. Sale con código 1 si hay errores.
"""
import sys, os, json, re, subprocess, difflib, unicodedata
import numpy as np, cv2
import conf

args = [a for a in sys.argv[1:] if not a.startswith("--")]
proj = args[0]; P = lambda f: os.path.join(proj, f); os.makedirs(proj, exist_ok=True)
HERE = conf.HERE
video = args[1] if len(args) > 1 else P("final.mp4")
if os.path.exists(P("proyecto.json")): C = conf.cargar(proj)
else:                                                   # video de otro editor: valores de la plantilla
    C = {k: v for k, v in json.load(open(os.path.join(HERE, "plantilla.json"))).items() if not k.startswith("_")}
    wh = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=p=0", video], capture_output=True, text=True).stdout.split(",")
    C["vertical"] = int(wh[1]) > int(wh[0])
CADA = int(sys.argv[sys.argv.index("--cada") + 1]) if "--cada" in sys.argv else 3
norm = lambda s: re.sub(r"[^a-z0-9ñ]", "", "".join(c for c in unicodedata.normalize("NFD", s.lower()) if unicodedata.category(c) != "Mn"))
errores, avisos = [], []

# ---------- leer todos los fotogramas ----------
FJ = P("_fotogramas.json")
if not os.path.exists(FJ) or os.path.getmtime(FJ) < os.path.getmtime(video):
    subprocess.run([os.path.join(HERE, "bin", "fotogramas"), video, FJ], check=True)
FO = json.load(open(FJ)); W, H, FPS = FO["w"], FO["h"], FO["fps"]; FR = FO["f"]
n = len(FR); dur = n / FPS
ZS = C.get("zona_segura") if C.get("vertical") else None
CJ = json.load(open(P("cortes.json"))) if os.path.exists(P("cortes.json")) else {}
FADE0 = max(0, CJ.get("fin_voz", dur - 1.0) - .15)
br = C.get("broll", [])
en_stock = lambda t: any(r["a"] - .03 <= t < r["b"] + .03 for r in br)
PG = json.load(open(P("pages.json"))) if os.path.exists(P("pages.json")) else []
if not PG: avisos.append("sin pages.json: no se revisa subtítulo contra cara ni visibilidad (sí imagen, audio y hojas)")
pal_pag = [{norm(w["t"]) for l in p["lines"] for w in l["w"] if len(norm(w["t"])) >= 4} for p in PG]
pal_corta = [{norm(w["t"]) for l in p["lines"] for w in l["w"] if len(norm(w["t"])) >= 2} for p in PG]

LY = json.load(open(P("layout.json")))["paginas"] if os.path.exists(P("layout.json")) else []
def en_su_lugar(x, activas):
    """la palabra está donde el overlay dibujó el subtítulo (texto del fondo que diga lo mismo no cuenta)"""
    if not LY: return True
    cx, cy = (x[1] + x[3]) / 2, (x[2] + x[4]) / 2
    return any(k < len(LY) and LY[k] and LY[k]["x0"] - 40 <= cx <= LY[k]["x1"] + 40 and LY[k]["y0"] - 60 <= cy <= LY[k]["y1"] + 60 for k in activas)

def recortar(x, activas, m=60):
    """si el OCR juntó la palabra con texto del fondo, solo cuenta la parte que cae donde puede estar el subtítulo (+60 px)"""
    if not LY: return x
    cajas = [LY[k] for k in activas if k < len(LY) and LY[k]]
    if not cajas: return x
    X0, Y0 = min(c["x0"] for c in cajas) - m, min(c["y0"] for c in cajas) - m
    X1, Y1 = max(c["x1"] for c in cajas) + m, max(c["y1"] for c in cajas) + m
    return [x[0], max(x[1], X0), max(x[2], Y0), min(x[3], X1), min(x[4], Y1)]

def es_subtitulo(txt, activas):
    # solo palabras de 4+ letras: "en", "el", "a" salen en cualquier letrero del fondo
    toks = [norm(x) for x in txt.split() if len(norm(x)) >= 4]
    if not toks: return False
    ok = sum(any(difflib.SequenceMatcher(None, t, w).ratio() >= .8 for k in activas for w in pal_pag[k]) for t in toks)
    return ok >= max(1, len(toks) * .6)

marcas = {}                                   # índice de fotograma → motivo (para las hojas)
def marca(i, motivo): marcas.setdefault(i, motivo)

# ---------- 1–3. texto real contra cara, zona segura y visibilidad ----------
vistos = [0] * len(PG); esperados = [0] * len(PG)
cara_mal, zona_mal = [], []
for f in FR:
    t, i = f["t"], f["i"]
    activas = [k for k, p in enumerate(PG) if p["start"] - .3 <= t <= p["end"] + .05]
    subs = [recortar(x, activas) for x in f["texto"] if activas and es_subtitulo(x[0], activas) and en_su_lugar(x, activas)]
    for k, p in enumerate(PG):
        if p["start"] + .35 <= t <= p["end"] - .25:
            esperados[k] += 1
            # para "se ve" cuentan también palabras cortas ("que no es un"), siempre que estén donde se dibujó esa página
            if any(es_subtitulo(x[0], [k]) for x in subs) or any(norm(x[0]) in pal_corta[k] and en_su_lugar(x, [k]) for x in f["texto"]): vistos[k] += 1
    if not subs: continue
    if not en_stock(t):
        for c in f["caras"]:
            x0, y0, x1, y1 = c; hc, wc = y1 - y0, x1 - x0
            if hc < 60: continue
            cx0, cx1, cy0, cy1 = x0 - .1 * wc, x1 + .1 * wc, y0 - .2 * hc, y1 + .08 * hc
            if any(s[1] < cx1 and s[3] > cx0 and s[2] < cy1 and s[4] > cy0 for s in subs):
                cara_mal.append(t); marca(i, "texto sobre la cara"); break
    if ZS:
        # 30 px de tolerancia: el OCR agranda la caja de palabras borrosas y las palabras entran 22 px más abajo al animarse
        for s in subs:
            if s[1] < ZS["x0"] - 30 or s[3] > ZS["x1"] + 30 or s[2] < ZS["y0"] - 30 or s[4] > ZS["y1"] + 30:
                zona_mal.append((i, t)); break
if cara_mal: errores.append(f"texto encima de la cara en {len(cara_mal)} fotogramas ({cara_mal[0]:.2f}–{cara_mal[-1]:.2f}s)")
# solo cuenta si se repite en 4+ cuadros seguidos (uno suelto es ruido del OCR)
seguidos, rachas = [], []
for i, t in zona_mal:
    if seguidos and i - seguidos[-1][0] > 2: rachas.append(seguidos); seguidos = []
    seguidos.append((i, t))
if seguidos: rachas.append(seguidos)
zona_mal = [x for r in rachas if len(r) >= 4 for x in r]
for i, _ in zona_mal: marca(i, "fuera de zona segura")
if zona_mal: errores.append(f"texto fuera de la zona segura de Instagram en {len(zona_mal)} fotogramas ({zona_mal[0][1]:.2f}–{zona_mal[-1][1]:.2f}s)")
for k, p in enumerate(PG):
    txt = " / ".join(" ".join(w["t"] for w in l["w"]) for l in p["lines"])
    if esperados[k] == 0: avisos.append(f"el subtítulo «{txt}» dura tan poco que nunca se ve completo"); continue
    if vistos[k] / esperados[k] < .5:
        errores.append(f"el subtítulo «{txt}» ({p['start']:.2f}s) casi no se ve: legible en {vistos[k]}/{esperados[k]} cuadros")

# ---------- 4–6. imagen: negros, destellos, congelados ----------
raw = subprocess.run(["ffmpeg", "-v", "error", "-i", video, "-vf", "scale=90:160,format=gray", "-f", "rawvideo", "-"], capture_output=True).stdout
G = np.frombuffer(raw, np.uint8).reshape(-1, 160, 90).astype(np.float32)
luz = G.mean(axis=(1, 2)); d = np.r_[0, np.abs(np.diff(G, axis=0)).mean(axis=(1, 2))]
t_ = lambda i: i / FPS
# tramo negro/blanco de más de 0.5 s antes del final = error (un destello a blanco de unos cuadros es una transición a propósito)
liso = (luz < 10) | (luz > 248)
negros, i = [], 0
while i < len(G):
    if not liso[i] or t_(i) >= FADE0: i += 1; continue
    j = i
    while j < len(G) and liso[j]: j += 1
    if (j - i) / FPS > .5: negros += list(range(i, j))     # los de 1–2 cuadros de golpe ya los marca el detector de destellos
    i = j
if negros: errores.append(f"{len(negros)} cuadros negros o en blanco por más de 0.5 s ({t_(negros[0]):.2f}s…)"); [marca(i, "cuadro negro") for i in negros]
dest = []
for i in range(1, len(G) - 1):
    if t_(i) >= FADE0: break
    salto = min(d[i], d[i + 1]); vuelta = np.abs(G[i + 1] - G[i - 1]).mean()
    if salto > 22 and vuelta < salto / 3: dest.append(i); marca(i, "destello de 1 cuadro")
if dest: errores.append(f"{len(dest)} destellos de un solo cuadro en {', '.join(f'{t_(i):.2f}s' for i in dest[:6])}")
run_, congel = 0, []
for i in range(1, len(G)):
    run_ = run_ + 1 if d[i] < .12 and t_(i) < FADE0 else 0
    if run_ == int(.5 * FPS): congel.append(i); marca(i, "imagen congelada")
if congel: avisos.append(f"imagen sin ningún cambio más de 0.5 s en {', '.join(f'{t_(i):.2f}s' for i in congel)} (¿cuadro congelado?)")

# ---------- 7. audio ----------
o = subprocess.run(["ffmpeg", "-hide_banner", "-nostats", "-i", video, "-af", "volumedetect,ebur128=framelog=quiet", "-f", "null", "-"], capture_output=True, text=True).stderr
pico = float(re.search(r"max_volume: (-?[\d.]+)", o).group(1)); I = float(re.findall(r"I:\s+(-?[\d.]+) LUFS", o)[-1])
if pico > -.3: errores.append(f"el audio satura (pico {pico} dBFS)")
if abs(I - C.get("lufs", -14)) > 1: avisos.append(f"volumen final {I} LUFS (pedido {C.get('lufs', -14)})")

# ---------- hojas de contacto ----------
os.makedirs(P("revision_final"), exist_ok=True)
for f_ in os.listdir(P("revision_final")): os.remove(P("revision_final/" + f_))
tw, th = 135, 240
raw = subprocess.run(["ffmpeg", "-v", "error", "-i", video, "-vf", f"scale={tw}:{th}", "-pix_fmt", "bgr24", "-f", "rawvideo", "-"], capture_output=True).stdout
RGB = np.frombuffer(raw, np.uint8).reshape(-1, th, tw, 3)
sel = sorted(set(range(0, len(RGB), CADA)) | set(marcas))
COL, FIL = 10, 4; hojas = []
for h in range(0, len(sel), COL * FIL):
    hoja = np.full((FIL * (th + 22), COL * tw, 3), 18, np.uint8)
    for k, i in enumerate(sel[h:h + COL * FIL]):
        y, x = (k // COL) * (th + 22), (k % COL) * tw; img = RGB[i].copy()
        if i in marcas: cv2.rectangle(img, (0, 0), (tw - 1, th - 1), (0, 0, 255), 5)
        hoja[y:y + th, x:x + tw] = img
        cv2.putText(hoja, f"{i / FPS:.2f}s" + (" !" if i in marcas else ""), (x + 4, y + th + 16), cv2.FONT_HERSHEY_SIMPLEX, .42,
                    (60, 60, 255) if i in marcas else (220, 220, 220), 1, cv2.LINE_AA)
    ruta = P(f"revision_final/hoja_{len(hojas) + 1:02d}.jpg"); cv2.imwrite(ruta, hoja, [cv2.IMWRITE_JPEG_QUALITY, 85]); hojas.append(ruta)

print(f"{n} fotogramas revisados uno por uno ({dur:.1f}s · {FPS:.2f} fps) · pico {pico} dBFS · {I} LUFS")
print(f"hojas de contacto ({len(sel)} cuadros, marco rojo = problema): " + ", ".join(os.path.basename(h) for h in hojas))
for a in avisos: print("  ·", a)
for e in errores: print("  ⚠", e)
if not errores: print("✓ revisión final cuadro por cuadro sin errores (mira las hojas antes de entregar)")
sys.exit(1 if errores else 0)
