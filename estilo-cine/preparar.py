"""Prepara un proyecto ya cortado para el motor cine: cuadros + máscaras de persona + filtro de piel.

Uso: .venv/bin/python estilo-cine/preparar.py proyectos/<n> [--sin-piel] [--fuerza 0.75 --color 1 --suave 1]
Lee corte/cam.mov (1080x1920, 24000/1001) y escribe:
  cuadros/%05d.jpg      cuadros originales
  mascaras/%05d.jpg     silueta de la persona (Vision de macOS, 540x960; se rellenan las que falten al final)
  cuadros_pro/%05d.jpg  con suavizado de piel + corrección de color (piel.py)
Después: transcribir.py → escaleta → cine.json → render.mjs. Si persona.n en cine.json no coincide, usa el número que imprime.
"""
import sys, os, glob, shutil, subprocess

args = sys.argv[1:]
if not args: sys.exit(__doc__)
proy = args[0]
RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SEG = os.path.join(RAIZ, 'bin', 'segmentar')
cam = os.path.join(proy, 'corte', 'cam.mov')
if not os.path.exists(cam): sys.exit(f'✗ no existe {cam}')
if not os.path.exists(SEG): sys.exit('✗ falta bin/segmentar. Corre ./instalar.sh (Mac) o ./instalar-windows.sh (Windows/Linux)')

for d in ['cuadros', 'mascaras', 'cuadros_pro']: shutil.rmtree(os.path.join(proy, d), ignore_errors=True)
os.makedirs(os.path.join(proy, 'cuadros')); os.makedirs(os.path.join(proy, 'mascaras'))
print('1/3 cuadros…', flush=True)
subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', cam, '-q:v', '2', os.path.join(proy, 'cuadros', '%05d.jpg')], check=True)
print('2/3 máscaras de persona (Vision)…', flush=True)
p = subprocess.Popen([SEG, cam, '540', '960'], stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
subprocess.run(['ffmpeg', '-v', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'gray', '-s', '540x960', '-r', '24000/1001', '-i', '-',
                os.path.join(proy, 'mascaras', '%05d.jpg')], stdin=p.stdout, check=True)
n = len(glob.glob(os.path.join(proy, 'cuadros', '*.jpg'))); m = len(glob.glob(os.path.join(proy, 'mascaras', '*.jpg')))
for i in range(m + 1, n + 1):  # Vision a veces entrega 1–3 cuadros menos al final: se repite la última máscara
    shutil.copy(os.path.join(proy, 'mascaras', f'{m:05d}.jpg'), os.path.join(proy, 'mascaras', f'{i:05d}.jpg'))
if '--sin-piel' in args:
    shutil.copytree(os.path.join(proy, 'cuadros'), os.path.join(proy, 'cuadros_pro'))
else:
    print('3/3 filtro de piel…', flush=True)
    extra = [a for k in ('--fuerza', '--color', '--suave') if k in args for a in (k, args[args.index(k) + 1])]
    subprocess.run([sys.executable, os.path.join(RAIZ, 'estilo-cine', 'piel.py'), proy, *extra], check=True)
print(f'✓ {n} cuadros listos (persona.n = {n})')
