"""Quita las pausas de un corte (momentos en que sales a cuadro sin decir nada).

Uso: python3 estilo-cine/silencios.py entrada.mov salida.mov [--umbral 300] [--min 0.12] [--deja 0.06]
- Busca tramos con audio debajo de --umbral (RMS en 10 ms, 16 kHz) de al menos --min segundos.
- De cada tramo deja solo --deja segundos (mitad antes, mitad después) y quita el resto.
- Corta en cuadros enteros para que audio y video sigan sincronizados.
Escribe salida.mov y salida.mov.mapa.json con los tramos quitados (tiempo original), para recalcular tiempos.
"""
import sys, json, subprocess
import numpy as np

a = sys.argv[1:]
src, dst = a[0], a[1]
opt = lambda k, d: type(d)(a[a.index(k) + 1]) if k in a else d
UMB, MIN, DEJA = opt('--umbral', 300.0), opt('--min', 0.12), opt('--deja', 0.06)

fr = subprocess.run(['ffprobe', '-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=r_frame_rate', '-of', 'csv=p=0', src], capture_output=True, text=True).stdout.strip()
n, d = map(int, fr.split('/')); fps = n / d
raw = subprocess.run(['ffmpeg', '-v', 'error', '-i', src, '-ac', '1', '-ar', '16000', '-f', 's16le', '-'], capture_output=True).stdout
x = np.frombuffer(raw, np.int16).astype(float); h = 160
e = np.array([np.sqrt((x[i:i + h] ** 2).mean()) for i in range(0, len(x) - h, h)])
sil, quitar, i = e < UMB, [], 0
while i < len(sil):
    if sil[i]:
        j = i
        while j < len(sil) and sil[j]: j += 1
        if (j - i) * .01 >= MIN and i > 0 and j < len(sil):  # no toca el arranque ni el final
            f0 = int(np.ceil((i * .01 + DEJA / 2) * fps)); f1 = int(np.floor((j * .01 - DEJA / 2) * fps))
            if f1 - f0 >= 2: quitar.append([f0 / fps, f1 / fps])
        i = j
    else: i += 1

if not quitar:
    subprocess.run(['cp', src, dst]); json.dump([], open(dst + '.mapa.json', 'w')); print('sin pausas que quitar'); sys.exit()
expr = '+'.join(f'between(t,{q0 - 0.1 / fps:.6f},{q1 - 0.5 / fps:.6f})' for q0, q1 in quitar)  # cuadros
expa = '+'.join(f'between(t,{q0:.6f},{q1:.6f})' for q0, q1 in quitar)                            # audio
subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', src,
                '-vf', f"select='not({expr})',setpts=N/FRAME_RATE/TB",
                '-af', f"aselect='not({expa})',asetpts=N/SR/TB",
                '-c:v', 'libx264', '-crf', '12', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', '-c:a', 'pcm_s16le', dst], check=True)
json.dump(quitar, open(dst + '.mapa.json', 'w'))
tot = sum(q1 - q0 for q0, q1 in quitar)
print(f'✓ {len(quitar)} pausas quitadas, {tot:.2f} s menos → {dst}')
