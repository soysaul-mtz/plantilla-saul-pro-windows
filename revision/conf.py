"""Configuración del proyecto = plantilla.json (valores por defecto) + proyecto.json (lo que cambie cada proyecto)."""
import os, json, subprocess, tempfile, wave
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))


def cargar(proj):
    base = json.load(open(os.path.join(HERE, "plantilla.json")))
    C = json.load(open(os.path.join(proj, "proyecto.json")))
    out = {k: v for k, v in base.items() if not k.startswith("_")}
    for k, v in C.items():
        out[k] = {**out[k], **v} if isinstance(v, dict) and isinstance(out.get(k), dict) else v
    return out


def guardar(proj, C_mod):
    """guarda solo proyecto.json (sin volcar los valores de la plantilla)"""
    p = os.path.join(proj, "proyecto.json"); C = json.load(open(p))
    C.update({k: v for k, v in C_mod.items() if k in C or k in ("cortes", "broll", "flecha", "intactos")})
    json.dump(C, open(p, "w"), ensure_ascii=False, indent=1)


_cache = {}
def audio16k(src):
    """audio mono 16 kHz del archivo (float), cacheado"""
    if src not in _cache:
        w = os.path.join(tempfile.mkdtemp(), "a.wav")
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", src, "-vn", "-ac", "1", "-ar", "16000", w], check=True)
        _cache[src] = np.frombuffer(wave.open(w).readframes(10 ** 9), np.int16).astype(float)
    return _cache[src]


def energia(src, h=0.01):
    """dB cada h segundos + umbral de voz (piso de ruido + 12 dB, mínimo −44)"""
    x = audio16k(src); n = int(16000 * h)
    e = np.array([20 * np.log10(np.sqrt((x[i:i + n] ** 2).mean()) / 32768 + 1e-9) for i in range(0, len(x) - n, n)])
    return e, max(np.percentile(e, 15) + 12, -44)


def wav_tramo(src, a, b, ruta, colchon=.25):
    """escribe el tramo [a, b] como wav 16 kHz con silencio a los lados (para Whisper)"""
    x = audio16k(src).astype(np.int16); z = np.zeros(int(colchon * 16000), np.int16)
    y = np.concatenate([z, x[max(0, int(a * 16000)):int(b * 16000)], z])
    w = wave.open(ruta, "wb"); w.setnchannels(1); w.setsampwidth(2); w.setframerate(16000); w.writeframes(y.tobytes()); w.close()


def transcribir(ruta, palabras=False, vocabulario=""):
    """Whisper mlx. vocabulario = nombres propios que Whisper escribe mal (proyecto.json -> "vocabulario")."""
    import mlx_whisper
    return mlx_whisper.transcribe(ruta, path_or_hf_repo="mlx-community/whisper-large-v3-turbo", language="es",
                                  condition_on_previous_text=False, word_timestamps=palabras, initial_prompt=vocabulario or None)


def entregar(proj):
    """copia final.mp4 a proyecto.json -> "salida" y verifica la copia (tamaño y duración). Devuelve la ruta o None."""
    import shutil
    C = cargar(proj); final = os.path.join(proj, "final.mp4"); out = C.get("salida")
    if not out: return final
    out = out if os.path.isabs(out) else os.path.join(proj, out)
    dur = lambda f: float(subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", f], capture_output=True, text=True).stdout)
    try:
        os.makedirs(os.path.dirname(out), exist_ok=True); tmp = out + ".parcial"
        shutil.copyfile(final, tmp); os.replace(tmp, out)
        if abs(dur(out) - dur(final)) < .05 and os.path.getsize(out) == os.path.getsize(final): return out
        print("✗ la copia no coincide con el original:", out)
    except OSError as e:
        print(f"✗ no pude escribir en {out} ({e}); el video quedó en {final}")
    return None


def fuente_de(C, c):
    return c[2] if len(c) > 2 else C["fuente"]
