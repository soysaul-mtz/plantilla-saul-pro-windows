"""Corte de Objeciones/Video 1: clips verticales de iPhone (se autorrotan) → 1080x1920 a 24000/1001.
T: (clip, a, b, nota). TOMAS: tomas de apoyo (búnker) que tapan la imagen sin tocar tu voz: (archivo, desde, ini_en_corte, dur).
Salida: corte/cam.mov + corte/mapa.json
"""
import subprocess, json, os
B = '<tu carpeta de contenido>/Objeciones/Video 1/'
AQUI = os.path.dirname(os.path.abspath(__file__))
T = [
    ('IMG_3867', 2.00, 4.60, 'volteas a leer la pregunta (mudo)'),
    ('IMG_3867', 14.74, 17.95, 'esto que acaba de pasar es una pinche locura, cabrón'),
    ('IMG_3869', 0.60, 6.30, 'laptop: toda esta empresa de la empresa del cliente…'),
    ('IMG_3871', 0.62, 5.95, 'y justo pareciera irreal… con IA, absolutamente'),
    ('IMG_3873', 0.52, 10.12, 'y eso solo nos deja algo muy claro… o sea,'),
    ('IMG_3873', 15.94, 26.32, 'el que no usa IA… otros negocios van a tener'),
    ('IMG_3873', 32.40, 40.30, 'así que si tú eres un empresario… con IA,'),
    ('IMG_3873', 42.62, 44.50, 'lamento decirte que estás fuera del juego'),
    ('IMG_3874', 14.76, 21.58, 'ahora, si quieres aprender… mándame un mensaje'),
    ('IMG_3874', 23.00, 24.08, 'y te voy a enseñar cómo'),
    ('IMG_3874', 24.47, 26.80, 'utilizar IA de a de veras, no de juguete'),
]
TOMAS = []  # se llenan con el video del búnker
ESC = 'scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1'
ins, fc, partes, mapa, acc = [], '', [], [], 0.0
for i, (f, a, b, nota) in enumerate(T):
    ins += ['-i', B + f + '.MOV']
    fc += f"[{i}:v]trim={a}:{b},setpts=PTS-STARTPTS,fps=24000/1001,{ESC}[v{i}];"
    fc += f"[{i}:a]atrim={a}:{b},asetpts=PTS-STARTPTS,aresample=48000,aformat=channel_layouts=stereo,afade=t=in:d=0.01,areverse,afade=t=in:d=0.02,areverse[a{i}];"
    mapa.append({'clip': f, 'a': a, 'b': b, 'nota': nota, 'ini': round(acc, 3), 'fin': round(acc + b - a, 3)})
    acc += b - a; partes.append(f'[v{i}][a{i}]')
fc += ''.join(partes) + f'concat=n={len(T)}:v=1:a=1[vb][a];'
ult = 'vb'
for j, (f, desde, ini, dur) in enumerate(TOMAS):
    k = len(T) + j; ins += ['-i', f]
    fc += f"[{k}:v]trim={desde}:{desde + dur},setpts=PTS-STARTPTS+{ini}/TB,fps=24000/1001,{ESC}[t{j}];[{ult}][t{j}]overlay=eof_action=pass:enable='between(t,{ini},{ini + dur})'[o{j}];"
    ult = f'o{j}'
fc = fc.rstrip(';')
os.makedirs(os.path.join(AQUI, 'corte'), exist_ok=True)
subprocess.run(['ffmpeg', '-v', 'error', '-y', *ins, '-filter_complex', fc, '-map', f'[{ult}]', '-map', '[a]', '-c:v', 'libx264', '-crf', '14',
                '-preset', 'medium', '-pix_fmt', 'yuv420p', '-c:a', 'pcm_s16le', os.path.join(AQUI, 'corte', 'cam.mov')], check=True)
json.dump({'piezas': [[m['ini'], m['fin']] for m in mapa], 'tramos': mapa, 'tomas': TOMAS}, open(os.path.join(AQUI, 'corte', 'mapa.json'), 'w'), indent=1, ensure_ascii=False)
for m in mapa: print(f"{m['ini']:6.2f}-{m['fin']:6.2f}  {m['clip']} {m['a']}-{m['b']}  {m['nota']}")
print('total', round(acc, 2))
