"""Convierte video HDR (HLG / PQ, BT.2020, p. ej. DJI o iPhone) a SDR Rec.709 (versión Windows/Linux de sdr.swift).
Uso: sdr entrada.mp4 salida.mov [ancho alto]
Sale H.264 8 bits Rec.709 (calidad alta) con el audio en PCM. Si el video ya es Rec.709 solo lo re-codifica.
Usa ffmpeg con zscale si lo tiene (Ubuntu/WSL sí); si no, hace el mapeo de tonos con numpy (mismo resultado, más lento).
"""
import sys, os, json, subprocess
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from comun import info

a = sys.argv
if len(a) < 3: sys.exit("uso: sdr entrada salida [ancho alto]")
src, dst = a[1], a[2]
W, H, fps, _ = info(src)
if len(a) >= 5: W, H = int(a[3]), int(a[4])
pr = json.loads(subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=color_transfer,color_primaries",
                                "-of", "json", src], capture_output=True, text=True).stdout)["streams"][0]
trc = pr.get("color_transfer", "")
hlg, pq = trc == "arib-std-b67", trc == "smpte2084"
tiene_audio = bool(subprocess.run(["ffprobe", "-v", "error", "-select_streams", "a", "-show_entries", "stream=index", "-of", "csv=p=0", src],
                                  capture_output=True, text=True).stdout.strip())
SALIDA = ["-c:v", "libx264", "-preset", "medium", "-crf", "14", "-pix_fmt", "yuv420p",
          "-color_primaries", "bt709", "-color_trc", "bt709", "-colorspace", "bt709"]
AUDIO = ["-c:a", "pcm_s16le", "-ar", "48000", "-ac", "2"] if tiene_audio else ["-an"]
escala = f"scale={W}:{H}:flags=lanczos"
if os.path.exists(dst): os.remove(dst)

if not (hlg or pq):
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", src, "-vf", escala, *SALIDA, *AUDIO, dst], check=True)
    print(f"✓ {os.path.basename(dst)} {W}x{H} Rec.709 (ya era SDR)"); sys.exit()

filtros = subprocess.run(["ffmpeg", "-hide_banner", "-filters"], capture_output=True, text=True).stdout
if " zscale " in filtros:
    curva = "mobius" if hlg else "hable"
    vf = (f"zscale=t=linear:npl={1000 if hlg else 203},format=gbrpf32le,zscale=p=bt709,tonemap=tonemap={curva}:desat=0,"
          f"zscale=t=bt709:m=bt709:r=tv,format=yuv420p,{escala}")
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", src, "-vf", vf, *SALIDA, *AUDIO, dst], check=True)
else:
    import numpy as np
    from comun import cuadros
    M = np.array([[1.6605, -0.5876, -0.0728], [-0.1246, 1.1329, -0.0083], [-0.0182, -0.1006, 1.1187]], np.float32)   # BT.2020 → BT.709

    def a_lineal(e):                     # señal 0..1 → luz relativa al blanco de referencia (203 nits = 1.0)
        if hlg:
            A, B, C = 0.17883277, 0.28466892, 0.55991073
            esc = np.where(e <= 0.5, e * e / 3, (np.exp((e - C) / A) + B) / 12)
            y = (0.2627 * esc[..., 0] + 0.6780 * esc[..., 1] + 0.0593 * esc[..., 2])[..., None]
            return esc * np.power(np.maximum(y, 1e-6), 0.2) * (1000 / 203)      # OOTF γ=1.2, pico 1000 nits
        m1, m2, c1, c2, c3 = 0.1593017578125, 78.84375, 0.8359375, 18.8515625, 18.6875
        p = np.power(e, 1 / m2)
        return np.power(np.maximum(p - c1, 0) / (c2 - c3 * p), 1 / m1) * (10000 / 203)

    tmp = dst + ".video.mov"
    enc = subprocess.Popen(["ffmpeg", "-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}", "-r", str(fps), "-i", "-",
                            *SALIDA, tmp], stdin=subprocess.PIPE)
    dec = subprocess.Popen(["ffmpeg", "-v", "error", "-i", src, "-vf", escala, "-pix_fmt", "rgb48le", "-f", "rawvideo", "-"], stdout=subprocess.PIPE)
    tam = W * H * 6
    while True:
        buf = dec.stdout.read(tam)
        if len(buf) < tam: break
        e = np.frombuffer(buf, np.uint16).reshape(H, W, 3).astype(np.float32) / 65535
        l = np.clip(a_lineal(e) @ M.T, 0, None)
        l = l * (1 + l / 16) / (1 + l)                                         # Reinhard extendido: blancos suaves hasta 4×
        s = np.where(l < 0.018, 4.5 * l, 1.099 * np.power(np.minimum(l, 1), 0.45) - 0.099)   # curva Rec.709
        enc.stdin.write((np.clip(s, 0, 1) * 255 + 0.5).astype(np.uint8).tobytes())
    enc.stdin.close(); enc.wait(); dec.wait()
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", tmp, "-i", src, "-map", "0:v", *(["-map", "1:a:0"] if tiene_audio else []),
                    "-c:v", "copy", "-color_primaries", "bt709", "-color_trc", "bt709", "-colorspace", "bt709", *AUDIO, "-shortest", dst], check=True)
    os.remove(tmp)
print(f"✓ {os.path.basename(dst)} {W}x{H} Rec.709")
