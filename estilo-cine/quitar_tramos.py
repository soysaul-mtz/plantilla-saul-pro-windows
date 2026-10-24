"""Quita tramos (errores, retomas) de un proyecto ya cortado sin rehacer máscaras ni piel.
Uso: python estilo-cine/quitar_tramos.py proyectos/<n> 3.67-3.77 33.16-33.33 ...   (segundos de corte/cam.mov)
- Respaldo en <proyecto>/respaldo_<fecha>/ (cam.mov, palabras.json; las carpetas de cuadros se renombran ahí).
- Los tramos se ajustan a cuadros completos para que audio y video sigan sincronizados.
- Recorre cuadros, mascaras, cuadros_pro (y cuadros_4k, cuadros_pro_4k si existen); audio de cam.mov con micro-fundidos;
  palabras.json desplazado. Si hay corte/cam_4k.mov (perfil 4K) le quita exactamente los mismos cuadros.
Imprime el mapa de tiempos (para mover escenas de cine.json).
"""
import sys, os, json, shutil, subprocess, time
from fractions import Fraction

base = sys.argv[1]; FPS = Fraction(24000, 1001)
R = sorted(tuple(map(float, a.split('-'))) for a in sys.argv[2:])
RF = [(round(a * FPS), round(b * FPS)) for a, b in R]  # cuadros [ia, ib) (índice desde 0)
run = lambda *a: subprocess.run(*a, check=True)

resp = os.path.join(base, 'respaldo_' + time.strftime('%Y%m%d_%H%M%S')); os.makedirs(resp)
cam = os.path.join(base, 'corte', 'cam.mov'); shutil.copy2(cam, os.path.join(resp, 'cam.mov'))
pal = os.path.join(base, 'voz', 'palabras.json'); shutil.copy2(pal, os.path.join(resp, 'palabras.json'))

def nuevo_t(t):  # tiempo viejo → nuevo
    q = 0.0
    for ia, ib in RF:
        a, b = float(ia / FPS), float(ib / FPS)
        if t >= b: q += b - a
        elif t > a: return a - q
    return t - q

for d in ['cuadros', 'mascaras', 'cuadros_pro', 'cuadros_4k', 'cuadros_pro_4k']:
    src = os.path.join(base, d)
    if not os.path.isdir(src): continue
    old = os.path.join(resp, d); shutil.move(src, old); os.makedirs(src)
    fs = sorted(f for f in os.listdir(old) if f.endswith('.jpg')); k = 0
    for i, f in enumerate(fs):
        if any(ia <= i < ib for ia, ib in RF): continue
        k += 1; os.link(os.path.join(old, f), os.path.join(src, f'{k:05d}.jpg'))
    print(d, len(fs), '→', k)

# audio (y video de referencia) con trim por segmentos + fundidos de 5 ms
segs, p = [], 0
for ia, ib in RF: segs.append((p, ia)); p = ib
segs.append((p, None))
fc = ''
for j, (a, b) in enumerate(segs):
    ta = float(a / FPS); tb = '' if b is None else f':end={float(b / FPS):.6f}'
    fc += f"[0:v]trim=start={ta:.6f}{tb},setpts=PTS-STARTPTS[v{j}];[0:a]atrim=start={ta:.6f}{tb},asetpts=PTS-STARTPTS,afade=t=in:d=0.005"
    fc += (f",areverse,afade=t=in:d=0.005,areverse[a{j}];" if b is not None else f"[a{j}];")
fc += ''.join(f'[v{j}][a{j}]' for j in range(len(segs))) + f'concat=n={len(segs)}:v=1:a=1[v][a]'
run(['ffmpeg', '-v', 'error', '-y', '-i', os.path.join(resp, 'cam.mov'), '-filter_complex', fc, '-map', '[v]', '-map', '[a]',
     '-c:v', 'libx264', '-crf', '16', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', '-c:a', 'pcm_s16le', cam])

P = json.load(open(pal)); Q = []
for w in P:
    if any(float(ia / FPS) - .01 <= w['a'] and w['b'] <= float(ib / FPS) + .01 for ia, ib in RF): continue
    Q.append({**w, 'a': round(nuevo_t(w['a']), 3), 'b': round(nuevo_t(w['b']), 3)})
json.dump(Q, open(pal, 'w'), ensure_ascii=False, indent=1)
print('palabras', len(P), '→', len(Q))
print('quitado:', [(round(float(ia / FPS), 3), round(float(ib / FPS), 3)) for ia, ib in RF])
json.dump({'quitado': [[float(ia / FPS), float(ib / FPS)] for ia, ib in RF]}, open(os.path.join(resp, 'quitado.json'), 'w'))

# perfil 4K: mismos cortes al video 4K (solo imagen)
cam4 = os.path.join(base, 'corte', 'cam_4k.mov')
if os.path.exists(cam4):
    shutil.copy2(cam4, os.path.join(resp, 'cam_4k.mov'))
    fv = ''.join(f"[0:v]trim=start={float(a / FPS):.6f}{'' if b is None else f':end={float(b / FPS):.6f}'},setpts=PTS-STARTPTS[v{j}];" for j, (a, b) in enumerate(segs))
    fv += ''.join(f'[v{j}]' for j in range(len(segs))) + f'concat=n={len(segs)}:v=1:a=0[v]'
    run(['ffmpeg', '-v', 'error', '-y', '-i', os.path.join(resp, 'cam_4k.mov'), '-filter_complex', fv, '-map', '[v]',
         '-c:v', ('h264_videotoolbox' if sys.platform == 'darwin' else 'libx264'), '-b:v', '60M', '-pix_fmt', 'yuv420p', cam4])
    print('cam_4k.mov recortado igual')

