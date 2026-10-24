"""Whisper para Windows (WSL) y Linux con la MISMA interfaz que mlx_whisper (que solo existe en Mac con chip Apple).

El sistema llama `mlx_whisper.transcribe(...)`; en Windows/Linux este módulo responde igual usando faster-whisper
(mismo modelo large-v3-turbo; con tarjeta NVIDIA usa la GPU, si no, el procesador).
Lo instala instalar-windows.sh en el entorno de Python (.venv). Modelo: WHISPER_MODELO (por defecto large-v3-turbo).
"""
import os

__version__ = "compat-faster-whisper"
_cache = {}


def _nombre(repo):
    r = (repo or os.environ.get("WHISPER_MODELO") or "large-v3-turbo").lower()
    for k in ("large-v3-turbo", "turbo", "large-v3", "large-v2", "medium", "small", "base", "tiny"):
        if k in r: return "large-v3-turbo" if k == "turbo" else k
    return "large-v3-turbo"


def _modelo(repo):
    from faster_whisper import WhisperModel
    n = _nombre(repo)
    if n not in _cache:
        try:
            import ctranslate2
            gpu = ctranslate2.get_cuda_device_count() > 0
        except Exception:
            gpu = False
        _cache[n] = WhisperModel(n, device="cuda" if gpu else "cpu", compute_type="float16" if gpu else "int8",
                                 cpu_threads=max(1, (os.cpu_count() or 4)))
    return _cache[n]


def transcribe(audio, path_or_hf_repo=None, language=None, word_timestamps=False, condition_on_previous_text=True,
               initial_prompt=None, temperature=(0.0, 0.2, 0.4, 0.6, 0.8, 1.0), verbose=None, **otros):
    m = _modelo(path_or_hf_repo)
    if isinstance(audio, (str, os.PathLike)):                 # se decodifica con ffmpeg (más confiable que PyAV)
        import subprocess, numpy as np
        crudo = subprocess.run(["ffmpeg", "-v", "error", "-nostdin", "-i", str(audio), "-ac", "1", "-ar", "16000", "-f", "f32le", "-"],
                               capture_output=True, check=True).stdout
        audio = np.frombuffer(crudo, np.float32).copy()
    segs, inf = m.transcribe(audio, language=language, word_timestamps=word_timestamps,
                             condition_on_previous_text=condition_on_previous_text, initial_prompt=initial_prompt,
                             temperature=list(temperature) if isinstance(temperature, (list, tuple)) else temperature,
                             beam_size=1, vad_filter=False)
    out = []
    for s in segs:
        d = {"id": s.id, "seek": s.seek, "start": s.start, "end": s.end, "text": s.text, "tokens": list(s.tokens),
             "temperature": s.temperature, "avg_logprob": s.avg_logprob, "compression_ratio": s.compression_ratio,
             "no_speech_prob": s.no_speech_prob}
        if word_timestamps:
            d["words"] = [{"word": w.word, "start": w.start, "end": w.end, "probability": w.probability} for w in (s.words or [])]
        out.append(d)
    return {"text": "".join(s["text"] for s in out), "segments": out, "language": inf.language}
