"""Quita el fondo de una imagen de una PERSONA (versión Windows/Linux de recortar.swift; en Mac, Vision recorta cualquier sujeto).
Uso: recortar entrada.png salida.png
"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import numpy as np, cv2
from comun import Persona

if len(sys.argv) < 3: sys.exit("Uso: recortar entrada salida.png")
img = cv2.imread(sys.argv[1], cv2.IMREAD_COLOR)
if img is None: sys.exit(f"No pude abrir {sys.argv[1]}")
m = Persona(fina=True).mascara(img)
if (m > 0.5).mean() < 0.005: print(f"✗ no encontré una persona en {sys.argv[1]}"); sys.exit(2)
m = cv2.GaussianBlur(m, (0, 0), 1.0)
cv2.imwrite(sys.argv[2], np.dstack([img, (m * 255).round().astype(np.uint8)]))
print(f"✓ {sys.argv[2]}  (1 sujeto(s))")
