"""Cara (y coronilla de la persona) en TODOS los fotogramas (versión Windows/Linux de caras.swift).
Uso: caras video.mp4 salida.json [desde hasta paso]
Salida: {"w","h","fps","f":[[t, x0,y0,x1,y1, cabeza_y], ...]} en px del video, y hacia abajo.
  x0..y1 = caja de la cara más grande (-1 si no hay cara) · cabeza_y = punto más alto de la silueta (-1 si no hay persona)
"""
import sys, os, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import cv2
from comun import cuadros, info, Caras, Persona, coronilla

a = sys.argv
if len(a) < 3: sys.exit("uso: caras video salida.json [desde hasta paso]")
W, H, fps, _ = info(a[1])
desde = hasta = None; paso = 0.0
if len(a) >= 6: desde, hasta, paso = float(a[3]), float(a[4]), float(a[5])
det, per = Caras(), Persona(fina=False)
filas = []; siguiente = -1.0
for i, t, img in cuadros(a[1], desde=desde, hasta=hasta):
    if paso > 0:
        if t < siguiente: continue
        siguiente = t + paso
    f = [t, -1, -1, -1, -1, -1]
    c = det.detectar(img)
    if c: f[1:5] = c[0]
    peq = cv2.resize(img, (256, round(256 * H / W)), interpolation=cv2.INTER_AREA)
    top = coronilla(per.mascara(peq))
    if top >= 0: f[5] = top / peq.shape[0] * H
    filas.append([round(v * 10) / 10 for v in f])
json.dump({"w": float(W), "h": float(H), "fps": fps, "f": filas}, open(a[2], "w"))
print(f"✓ {len(filas)} fotogramas · cara en {sum(1 for f in filas if f[1] >= 0)} · {a[2]}")
