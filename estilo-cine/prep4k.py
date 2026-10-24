"""Prepara los cuadros 4K de un proyecto para el render final con --perfil 4k.

Uso: .venv/bin/python estilo-cine/prep4k.py proyectos/<n> [--hilos 3] [--conservar]
     [--fuerza/--color/--suave igual que en piel.py]

Flujo de bajo consumo: todo se edita y se revisa con la copia ligera en 1080 (cuadros, mascaras, cuadros_pro).
Esto solo corre al final:
  1. corte/cam_4k.mov → cuadros_4k/ (2160x3840), mismos cuadros que la copia 1080.
  2. Reutiliza las máscaras de 1080 (no se vuelve a segmentar en 4K).
  3. Filtro de piel en 4K con pocos hilos → cuadros_pro_4k/ (se puede reanudar).
  4. Borra cuadros_4k/ al terminar (salvo --conservar, que se necesita para la escena "antes/después").
Corre con prioridad baja para que la compu siga usable.
"""
import sys, os, json, glob, shutil, subprocess

args = sys.argv[1:]; proy = args[0]
opt = lambda k, d: type(d)(args[args.index(k) + 1]) if k in args else d
HILOS = opt('--hilos', 3)
PY = sys.executable
AQUI = os.path.dirname(os.path.abspath(__file__))
try: os.nice(10)
except OSError: pass

cam4 = os.path.join(proy, 'corte', 'cam_4k.mov')
if not os.path.exists(cam4):
    sys.exit('✗ no hay corte/cam_4k.mov: el proyecto se cortó en perfil redes. Pon "perfil": "4k" en metodo.json y vuelve a cortar.')
mc = os.path.join(proy, 'metodo.json')
if os.path.exists(mc):
    src = json.load(open(mc)).get('camara')
    if src and os.path.exists(src):
        w, h = map(int, subprocess.run(['ffprobe', '-v', 'error', '-select_streams', 'v', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', src],
                                        capture_output=True, text=True).stdout.strip().split(',')[:2])
        if min(w, h) < 2160: print(f'⚠ la cámara original es {w}x{h}: el 4K saldrá escalado (no tendrá más detalle que el 1080).')

n1080 = len(glob.glob(os.path.join(proy, 'cuadros', '*.jpg')))
d4 = os.path.join(proy, 'cuadros_4k'); dp = os.path.join(proy, 'cuadros_pro_4k')
if len(glob.glob(os.path.join(dp, '*.jpg'))) < n1080:
    if len(glob.glob(os.path.join(d4, '*.jpg'))) < n1080:
        shutil.rmtree(d4, ignore_errors=True); os.makedirs(d4)
        print('1/3 cuadros 4K…', flush=True)
        subprocess.run(['ffmpeg', '-v', 'error', '-y', '-threads', '4', '-i', cam4, '-q:v', '3', os.path.join(d4, '%05d.jpg')], check=True)
        n4 = len(glob.glob(os.path.join(d4, '*.jpg')))
        for i in range(n4 + 1, n1080 + 1): shutil.copy(os.path.join(d4, f'{n4:05d}.jpg'), os.path.join(d4, f'{i:05d}.jpg'))  # relleno al final
        if n4 > n1080 + 2: print(f'⚠ cam_4k tiene {n4} cuadros y la copia 1080 {n1080}: revisa que se hayan cortado igual')
    print(f'2/3 filtro de piel en 4K ({HILOS} hilos, reanudable)…', flush=True)
    extra = [a for k in ('--fuerza', '--color', '--suave') if k in args for a in (k, args[args.index(k) + 1])]
    subprocess.run([PY, os.path.join(AQUI, 'piel.py'), proy, '--entrada', 'cuadros_4k', '--salida', 'cuadros_pro_4k',
                    '--hilos', str(HILOS), '--calidad', '92', '--reanudar', *extra], check=True)
if '--conservar' not in args: shutil.rmtree(d4, ignore_errors=True)
print(f'3/3 ✓ {len(glob.glob(os.path.join(dp, "*.jpg")))} cuadros 4K listos en cuadros_pro_4k/ → node estilo-cine/render.mjs {proy} --perfil 4k')
