#!/usr/bin/env python3
"""Genera las imágenes y los clips animados de un proyecto con la CLI de Higgsfield.

Uso: python3 estilo-cine/gen_hf.py proyectos/<nombre> [imagenes|videos] [--solo 01_instagram,05_ojo]
Por defecto SOLO imágenes. Los videos cuestan mucho más (~64 créditos c/u): solo con `videos` explícito y si Saúl lo pidió.
Lee proyectos/<nombre>/hf_prompts.json y deja en proyectos/<nombre>/hf/:
  <id>.png  imagen (GPT Image 2.5, 9:16, 2k)
  <id>.mp4  clip animado desde esa imagen (Seedance 2.5, 1080p, sin audio)
Lo que ya existe no se vuelve a generar (no gasta créditos).
"""
import json, subprocess, sys, urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

proy = Path(sys.argv[1]).resolve()
paso = sys.argv[2] if len(sys.argv) > 2 and not sys.argv[2].startswith('--') else 'imagenes'
solo = sys.argv[sys.argv.index('--solo') + 1].split(',') if '--solo' in sys.argv else None
cfg = json.loads((proy / 'hf_prompts.json').read_text())
out = proy / 'hf'; out.mkdir(exist_ok=True)
DUR = cfg.get('duracion', 4)


def hf(args, log):
    r = subprocess.run(['higgsfield', 'generate', 'create', *args, '--wait', '--wait-timeout', '20m', '--json'],
                       capture_output=True, text=True)
    (out / f'{log}.json').write_text(r.stdout + '\n' + r.stderr)
    if r.returncode != 0:
        raise RuntimeError(f'{log}: {r.stderr.strip()[-300:]}')
    job = json.loads(r.stdout)[0]
    if job.get('status') != 'completed':
        raise RuntimeError(f"{log}: {job.get('status')}")
    return job['result_url']


def imagen(e):
    f = out / f"{e['id']}.png"
    if f.exists():
        return f'= {f.name}'
    url = hf(['gpt_image_2_5', '--prompt', e['imagen'], '--aspect_ratio', '9:16', '--quality', 'high', '--resolution', '2k'], e['id'])
    urllib.request.urlretrieve(url, f)
    return f'✓ {f.name}'


def video(e):
    f, img = out / f"{e['id']}.mp4", out / f"{e['id']}.png"
    if f.exists():
        return f'= {f.name}'
    url = hf(['seedance_2_5', '--prompt', e['video'], '--mode', 'omni_reference', '--start-image', str(img),
              '--duration', str(DUR), '--resolution', '1080p', '--aspect_ratio', '9:16', '--generate_audio', 'false'],
             e['id'] + '_video')
    urllib.request.urlretrieve(url, f)
    return f'✓ {f.name}'


escenas = [e for e in cfg['escenas'] if not solo or e['id'] in solo]
for nombre, fn in (('imagenes', imagen), ('videos', video)):
    if paso != nombre:
        continue
    print(f'— {nombre} ({len(escenas)})', flush=True)
    with ThreadPoolExecutor(8) as ex:
        for e, fut in [(e, ex.submit(fn, e)) for e in escenas]:
            try:
                print(' ', fut.result(), flush=True)
            except Exception as err:
                print('  ✗', err, flush=True)
