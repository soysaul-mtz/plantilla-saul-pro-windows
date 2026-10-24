"""Corte de un tutorial "cámara + pantalla" (formato Metodología): toma los tramos elegidos de la cámara,
quita las pausas internas y saca el mismo tramo de la grabación de pantalla, sincronizado por audio.

Uso: python3 estilo-cine/metodo_corte.py proyectos/<n>
Lee proyectos/<n>/metodo.json:
  { "camara": "...C8260.MP4", "pantalla": "...mov", "words": "corte/words.json",
    "tramos": [[a, b], [a, b, "sin", c, d], ...],   # tiempos de la cámara; "sin" quita [c, d] dentro del tramo
    "recorte": {"w": 2600, "cx": 0.5, "y": 100} }    # recorte de la cámara 4K para el panel de arriba (1080x768)
Escribe corte/cam.mov (1080x768 + audio), corte/scr.mov (1920x1080) y corte/mapa.json.
Con "perfil": "4k" y recorte vertical, además escribe corte/cam_4k.mov (2160x3840, sin audio) con exactamente los mismos
cortes: se edita todo sobre cam.mov (copia ligera) y cam_4k.mov solo se usa en el render final (prep4k.py).
"""
import sys, os, json, subprocess
import numpy as np

proy = sys.argv[1]
cfg = json.load(open(os.path.join(proy, 'metodo.json')))
words = json.load(open(os.path.join(proy, cfg.get('words', 'corte/words.json'))))
FPS = '24000/1001'
PAUSA, ANTES, DESPUES = .32, .08, .14


def lee_audio(f, ss=0, t=None, sr=8000):
    cmd = ['ffmpeg', '-v', 'error', '-ss', str(ss), '-i', f] + (['-t', str(t)] if t else []) + ['-ac', '1', '-ar', str(sr), '-f', 's16le', '-']
    return np.frombuffer(subprocess.run(cmd, capture_output=True).stdout, np.int16).astype(float)


# ---- desfase pantalla = cámara + lag (envolvente en todo el archivo y luego fino en 40 s) ----
def env(x):
    e = np.sqrt(np.convolve(x ** 2, np.ones(400) / 400, 'same'))[::80]
    e = np.log(e + 1); return (e - e.mean()) / e.std()

if not cfg.get('pantalla'):
    lag = 0
elif 'lag' in cfg:
    lag = cfg['lag']
else:
    ec, es = env(lee_audio(cfg['camara'])), env(lee_audio(cfg['pantalla']))
    n = len(ec) + len(es); c = np.fft.irfft(np.fft.rfft(es, n) * np.conj(np.fft.rfft(ec, n)), n)
    i = int(np.argmax(c)); lag = (i if i < n // 2 else i - n) / 100
    t0 = 60.0  # afinar a nivel de muestra
    a = lee_audio(cfg['camara'], t0, 40); b = lee_audio(cfg['pantalla'], t0 + lag - 1, 42)
    cc = np.correlate(b, a, 'valid'); lag = lag - 1 + int(np.argmax(cc)) / 8000
print(f'desfase pantalla = cámara {lag:+.3f} s')

# ---- tramos → subtramos sin pausas largas ----
piezas = []
for tr in cfg['tramos']:
    a, b = tr[0], tr[1]
    quita = [(tr[i + 1], tr[i + 2]) for i in range(2, len(tr), 3) if tr[i] == 'sin']
    ws = [w for w in words if w['s'] >= a - .05 and w['e'] <= b + .05 and not any(q0 <= w['s'] < q1 for q0, q1 in quita)]
    if not ws: continue
    ini = ws[0]
    for w0, w1 in zip(ws, ws[1:] + [None]):
        if w1 is None or w1['s'] - w0['e'] > PAUSA or any(w0['e'] <= q0 < w1['s'] + .01 for q0, _ in quita):
            fin = w0['e'] + DESPUES
            for q0, _ in quita:
                if w0['e'] <= q0 + .05: fin = min(fin, q0)
            if w1 is None: fin = min(fin, b + .03)  # no llevarse el arranque de la palabra que sigue a la toma
            ini_t = (a if ws[0]['s'] - a > .35 else max(a, ini['s'] - ANTES)) if ini is ws[0] else ini['s'] - ANTES  # si Whisper ubicó tarde la 1ª palabra, respetar el inicio dado
            piezas.append([ini_t, fin])
            ini = w1
# Whisper estira las palabras sobre los silencios: partir además por silencio real del audio (10 ms)
voz = lee_audio(cfg['camara'])
def parte(a, b):
    x = voz[int(a * 8000):int(b * 8000)]; h = 80
    e = 20 * np.log10(np.array([np.sqrt((x[i:i + h] ** 2).mean()) for i in range(0, len(x) - h, h)]) / 32768 + 1e-9)
    if not len(e): return [[a, b]]
    sil = e < np.percentile(e, 90) - 24; out, i0, i = [], 0, 0
    while i < len(sil):
        if sil[i]:
            j = i
            while j < len(sil) and sil[j]: j += 1
            if (j - i) * .01 > PAUSA and i > 0 and j < len(sil):
                out.append([a + i0 * .01, a + i * .01 + DESPUES]); i0 = max(i0, j - int(ANTES / .01))
            i = j
        else: i += 1
    out.append([a + i0 * .01, b]); return out
piezas = [q for p in piezas for q in parte(*p)]
# que no se encimen
for p, q in zip(piezas, piezas[1:]):
    if p[1] > q[0] and q[0] > p[0]: p[1] = q[0] = (p[1] + q[0]) / 2
tot = sum(b - a for a, b in piezas)
print(f'{len(piezas)} piezas · {tot:.1f} s')

R = cfg.get('recorte', {}); rw = R.get('w', 2600); ALTO = R.get('alto', 768); rh = round(rw * ALTO / 1080)
rx = round(3840 * R.get('cx', .5) - rw / 2); rx = max(0, min(3840 - rw, rx)); ry = R.get('y', 100)

def corta(src, salida, desfase, vf, con_audio, vf4=None):
    fc, ins = [], []
    for k, (a, b) in enumerate(piezas):
        fc.append(f'[0:v]trim={a + desfase:.4f}:{b + desfase:.4f},setpts=PTS-STARTPTS,fps={FPS}[v{k}]')
        if con_audio: fc.append(f'[0:a]atrim={a + desfase:.4f}:{b + desfase:.4f},asetpts=PTS-STARTPTS,aresample=48000[a{k}]')
        ins.append(f'[v{k}]' + (f'[a{k}]' if con_audio else ''))
    fc.append(''.join(ins) + f'concat=n={len(piezas)}:v=1:a={1 if con_audio else 0}' + ('[vc][a]' if con_audio else '[vc]'))
    fc.append(f'[vc]split=2[x][y];[x]{vf}[v];[y]{vf4}[v4]' if vf4 else f'[vc]{vf}[v]')
    f = os.path.join(proy, 'corte', '_fc.txt'); open(f, 'w').write(';\n'.join(fc))
    cmd = ['ffmpeg', '-v', 'error', '-y', '-i', src, '-/filter_complex', f, '-map', '[v]'] + (['-map', '[a]', '-c:a', 'pcm_s16le'] if con_audio else []) + \
          ['-c:v', 'libx264', '-crf', '14', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', salida] + \
          (['-map', '[v4]', '-c:v', ('h264_videotoolbox' if sys.platform == 'darwin' else 'libx264'), '-b:v', '60M', '-pix_fmt', 'yuv420p', '-an', salida.replace('.mov', '_4k.mov')] if vf4 else [])
    subprocess.run(cmd, check=True)

os.makedirs(os.path.join(proy, 'corte'), exist_ok=True)
K4 = cfg.get('perfil') == '4k' and R.get('vertical')
if cfg.get('perfil') == '4k' and not R.get('vertical'): print('⚠ el perfil 4K solo aplica a cámara vertical (recorte.vertical); se corta en 1080')
corta(cfg['camara'], os.path.join(proy, 'corte', 'cam.mov'), 0, 'scale=1080:1920' if R.get('vertical') else f'crop={rw}:{rh}:{rx}:{ry},scale=1080:{ALTO}', True,
      'scale=2160:3840:flags=lanczos' if K4 else None)
if cfg.get('pantalla'): corta(cfg['pantalla'], os.path.join(proy, 'corte', 'scr.mov'), lag, 'scale=1920:1080', False)
json.dump({'lag': lag, 'piezas': piezas}, open(os.path.join(proy, 'corte', 'mapa.json'), 'w'))
print('✓ corte/cam.mov + corte/scr.mov')
