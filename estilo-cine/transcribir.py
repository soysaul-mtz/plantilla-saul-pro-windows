"""Transcribe palabra por palabra (Whisper local, MLX) un video o audio → voz/palabras.json para el motor cine.

Uso: .venv/bin/python estilo-cine/transcribir.py proyectos/<n> [archivo] [--prompt "nombres propios, marcas"] [--tramos]
- Sin archivo usa corte/cam.mov.
- --tramos: además transcribe cada tramo de voz por separado e imprime el texto (para cazar retomas: Whisper de corrido
  fusiona frases repetidas; revisar SIEMPRE las sospechas con la energía del audio y clips cortos).
Salida: voz/palabras.json = [{t, a, b}] y una lista numerada en pantalla (índices para armar los grupos de cine.json).
"""
import sys, os, json, subprocess, tempfile, wave
import numpy as np
import mlx_whisper

args = sys.argv[1:]
if not args: sys.exit(__doc__)
proy = args[0]
src = args[1] if len(args) > 1 and not args[1].startswith('--') else os.path.join(proy, 'corte', 'cam.mov')
prompt = args[args.index('--prompt') + 1] if '--prompt' in args else None
MODELO = os.environ.get('WHISPER_MODELO', 'mlx-community/whisper-large-v3-turbo')

wav = os.path.join(tempfile.mkdtemp(), 'a.wav')
subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', src, '-vn', '-ac', '1', '-ar', '16000', wav], check=True)
r = mlx_whisper.transcribe(wav, path_or_hf_repo=MODELO, language=os.environ.get('IDIOMA', 'es'), word_timestamps=True,
                           condition_on_previous_text=False, initial_prompt=prompt)
W = [{'t': w['word'].strip(), 'a': round(w['start'], 3), 'b': round(w['end'], 3)} for s in r['segments'] for w in s['words']]
os.makedirs(os.path.join(proy, 'voz'), exist_ok=True)
json.dump(W, open(os.path.join(proy, 'voz', 'palabras.json'), 'w'), ensure_ascii=False, indent=1)
print(' '.join(f"{i}:{w['t']}@{w['a']:.2f}" for i, w in enumerate(W)))
print(f'\n✓ {len(W)} palabras → voz/palabras.json')

if '--tramos' in args:
    x = np.frombuffer(wave.open(wav).readframes(10 ** 9), np.int16).astype(float); h = 1600
    e = np.array([20 * np.log10(np.sqrt((x[i:i + h] ** 2).mean()) / 32768 + 1e-9) for i in range(0, len(x) - h, h)])
    voz, i, R = e > np.percentile(e, 90) - 24, 0, []
    while i < len(voz):
        if voz[i]:
            j = fin = i
            while j < len(voz) and (voz[j] or j - fin < 5):
                if voz[j]: fin = j
                j += 1
            if fin - i >= 2: R.append((i / 10, (fin + 1) / 10))
            i = j
        else: i += 1
    print('\n— tramos de voz (para cazar retomas) —')
    for a, b in R:
        seg = np.concatenate([np.zeros(5000), x[int(a * 16000):int(b * 16000)], np.zeros(5000)]).astype(np.int16)
        t = os.path.join(os.path.dirname(wav), 't.wav'); w = wave.open(t, 'wb'); w.setnchannels(1); w.setsampwidth(2); w.setframerate(16000)
        w.writeframes(seg.tobytes()); w.close()
        txt = mlx_whisper.transcribe(t, path_or_hf_repo=MODELO, language=os.environ.get('IDIOMA', 'es'), condition_on_previous_text=False)['text']
        print(f'{a:7.1f}-{b:7.1f} [{np.percentile(e[int(a * 10):int(b * 10)], 90):5.1f} dB] {txt.strip()}')
