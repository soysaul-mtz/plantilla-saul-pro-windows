"""Lee TODOS los fotogramas del video FINAL: caras y texto en pantalla (versión Windows/Linux de fotogramas.swift).
Uso: fotogramas video.mp4 salida.json [cada_n]      cada_n = 1 (todos, por defecto) · 2 = uno sí y uno no, etc.
Salida: {"w","h","fps","f":[{"i":n,"t":s,"caras":[[x0,y0,x1,y1],…],"texto":[["palabra",x0,y0,x1,y1],…]}]}  (px, y hacia abajo)
El texto se lee con RapidOCR (renglones) y se parte en una caja por PALABRA, proporcional a sus letras.
Si un fotograma es idéntico al anterior (imagen congelada), se reutiliza su lectura.
"""
import sys, os, json, re
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import numpy as np, cv2
from comun import cuadros, info, Caras

a = sys.argv
if len(a) < 3: sys.exit("uso: fotogramas video salida.json [cada_n]")
cada = max(1, int(a[3])) if len(a) >= 4 else 1
W, H, fps, _ = info(a[1])
from rapidocr_onnxruntime import RapidOCR
ocr = RapidOCR()
det = Caras()
LADO = 960                                    # el texto de los videos es grande: basta leer a 960 px de alto
k = min(1.0, LADO / max(W, H))
PAL = re.compile(r"[\wÁÉÍÓÚÜÑáéíóúüñ¿?¡!.,:;%$#@&'’\"-]+")


def palabras(img):
    peq = cv2.resize(img, (round(W * k), round(H * k)), interpolation=cv2.INTER_AREA) if k < 1 else img
    res, _ = ocr(peq)
    out = []
    for caja, txt, conf in res or []:
        if float(conf) < 0.5 or not txt.strip(): continue
        p = np.array(caja, dtype=float) / k
        x0, y0 = p[:, 0].min(), p[:, 1].min(); x1, y1 = p[:, 0].max(), p[:, 1].max()
        total = max(1, len(txt))
        for m in PAL.finditer(txt):                # cada palabra ocupa la parte del renglón que le toca por letras
            out.append([m.group(0), round(x0 + (x1 - x0) * m.start() / total), round(y0),
                        round(x0 + (x1 - x0) * m.end() / total), round(y1)])
    return out


filas = []; antes = None; leido = None
for i, t, img in cuadros(a[1]):
    if i % cada: continue
    caras = [[round(v) for v in c] for c in det.detectar(img)]
    chico = cv2.resize(cv2.cvtColor(img, cv2.COLOR_BGR2GRAY), (180, 320), interpolation=cv2.INTER_AREA).astype(np.int16)
    if antes is None or leido is None or (np.abs(chico - antes) > 10).sum() > 8:
        leido = palabras(img)
    antes = chico
    filas.append({"i": i, "t": round(t, 3), "caras": caras, "texto": leido})
    if len(filas) % 200 == 0: print(f"  {len(filas)} fotogramas…", file=sys.stderr, flush=True)


def iou(a, b):
    i = max(0, min(a[2], b[2]) - max(a[0], b[0])) * max(0, min(a[3], b[3]) - max(a[1], b[1]))
    return i / max(1, (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - i)


# una cara que aparece en UN solo fotograma suelto es ruido del detector (una mano, un reflejo): se quita
vecinas = [[c for c in f["caras"]] for f in filas]
for k, f in enumerate(filas):
    cerca = (vecinas[k - 1] if k else []) + (vecinas[k + 1] if k + 1 < len(filas) else [])
    f["caras"] = [c for c in vecinas[k] if any(iou(c, d) > 0.3 for d in cerca)]
json.dump({"w": W, "h": H, "fps": fps, "f": filas}, open(a[2], "w"))
print(f"✓ {len(filas)} fotogramas leídos (cara + texto) · {a[2]}")
