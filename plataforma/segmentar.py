"""Máscara de persona cuadro por cuadro (versión Windows/Linux de segmentar.swift). Escribe gris crudo a stdout.
Uso: segmentar video.mov ANCHO ALTO | ffmpeg -f rawvideo -pix_fmt gray -s ANCHOxALTO -i - mascaras/%05d.jpg
"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import numpy as np, cv2
from comun import cuadros, Persona

video, ow, oh = sys.argv[1], int(sys.argv[2]), int(sys.argv[3])
seg = Persona(fina=True); n = 0
for i, t, img in cuadros(video, ow, oh):
    m = seg.mascara(img)
    m = cv2.GaussianBlur(m, (0, 0), 0.8)                       # orilla suave, como la de Vision
    sys.stdout.buffer.write((m * 255).round().astype(np.uint8).tobytes())
    n += 1
    if n % 100 == 0: print(f"  máscara {n}", file=sys.stderr, flush=True)
sys.stdout.buffer.flush()
print(f"✓ {n} máscaras", file=sys.stderr)
