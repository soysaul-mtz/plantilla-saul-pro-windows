"""Tope de la cabeza (silueta) y manos cada N segundos (versión Windows/Linux de manos.swift).
Uso: manos video.mov desde hasta paso  → una línea por muestra: t cabeza_y manos_min_y manos_max_y
(fracciones del alto, 0 = arriba; -1 si no hay manos)
"""
import sys, os, subprocess
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import numpy as np, cv2
import mediapipe as mp
from mediapipe.tasks.python import vision, BaseOptions
from comun import info, modelo, Persona, coronilla

video, desde, hasta, paso = sys.argv[1], float(sys.argv[2]), float(sys.argv[3]), float(sys.argv[4])
W, H, _, _ = info(video)
k = min(1.0, 1280 / max(W, H)); w, h = round(W * k), round(H * k)
manos = vision.HandLandmarker.create_from_options(vision.HandLandmarkerOptions(
    base_options=BaseOptions(model_asset_path=modelo("manos.task")), num_hands=2, min_hand_detection_confidence=0.2, min_hand_presence_confidence=0.3))
per = Persona(fina=False)
t = desde
while t <= hasta + 1e-9:
    r = subprocess.run(["ffmpeg", "-v", "error", "-ss", f"{t:.3f}", "-i", video, "-frames:v", "1", "-vf", f"scale={w}:{h}",
                        "-pix_fmt", "bgr24", "-f", "rawvideo", "-"], capture_output=True)
    if len(r.stdout) == w * h * 3:
        img = np.frombuffer(r.stdout, np.uint8).reshape(h, w, 3)
        res = manos.detect(mp.Image(image_format=mp.ImageFormat.SRGB, data=np.ascontiguousarray(cv2.cvtColor(img, cv2.COLOR_BGR2RGB))))
        ys = [p.y for mano in res.hand_landmarks for p in mano]
        top = coronilla(per.mascara(img), fraccion=1 / 30)
        cabeza = top / h if top >= 0 else -1.0
        print(f"{t:.2f} {cabeza:.3f} {min(ys) if ys else -1:.3f} {max(ys) if ys else -1:.3f}")
    t += paso
