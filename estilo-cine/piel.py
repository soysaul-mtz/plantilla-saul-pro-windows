"""Suavizado de piel + corrección de color (tipo filtro de CapCut) para los cuadros de un proyecto.

Uso: .venv/bin/python estilo-cine/piel.py proyectos/<n> [--fuerza 0.75] [--prueba 120]
     [--entrada cuadros] [--salida cuadros_pro] [--hilos 8]
Lee cuadros/%05d.jpg + mascaras/%05d.jpg y escribe cuadros_pro/%05d.jpg. Funciona igual en 1080 y en 4K (los radios se
escalan con el ancho y el filtro pesado trabaja siempre a 540 px), así el 4K se ve igual que la prueba en 1080.
- Piel: tonos de piel (YCrCb) dentro de la silueta de la persona → filtro bilateral (alisa granitos y marcas,
  respeta bordes), conservando un poco de textura para que no se vea de plástico.
- Color: un poco más cálido, contraste suave en S, sombras levantadas apenas saturación +5 % (piel −8 %).
--prueba N: solo procesa el cuadro N y deja antes/después en salida/piel_prueba.jpg
"""
import sys, os, glob
import numpy as np, cv2
from concurrent.futures import ThreadPoolExecutor

args = sys.argv[1:]
proy = args[0]
opt = lambda k, d: type(d)(args[args.index(k) + 1]) if k in args else d
FUERZA = opt('--fuerza', 0.75)
PRUEBA = opt('--prueba', 0)
COLOR = opt('--color', 1.0)   # intensidad de la corrección de color (1 = sutil)
SUAVE = opt('--suave', 1.0)   # intensidad del suavizado de piel (1 = sutil)
ENTRADA = opt('--entrada', 'cuadros'); SALIDA = opt('--salida', 'cuadros_pro'); HILOS = opt('--hilos', 8)
CALIDAD = opt('--calidad', 95)

# curva de color (LUT por canal)
x = np.arange(256) / 255.0
curva = x + 0.07 * COLOR * np.sin(np.pi * (2 * x - 1)) * (x * (1 - x)) * 4 * 0.5  # S suave
curva = np.clip(0.025 * COLOR + curva * (1 - 0.025 * COLOR), 0, 1)                              # sombras apenas levantadas
LUT_B = np.clip(curva * (1 - 0.008 * COLOR) * 255, 0, 255).astype(np.uint8)
LUT_G = np.clip(curva * 1.0 * 255, 0, 255).astype(np.uint8)
LUT_R = np.clip(np.clip(curva * (1 + 0.012 * COLOR), 0, 1) * 255, 0, 255).astype(np.uint8)


def procesa(img, mask):
    h, w = img.shape[:2]
    m = cv2.resize(mask, (w, h), interpolation=cv2.INTER_LINEAR).astype(np.float32) / 255.0
    ycc = cv2.cvtColor(img, cv2.COLOR_BGR2YCrCb)
    cr, cb = ycc[..., 1].astype(np.float32), ycc[..., 2].astype(np.float32)
    piel = ((cr > 133) & (cr < 178) & (cb > 77) & (cb < 130)).astype(np.float32)
    k = w / 1080  # radios en proporción al ancho (1 en redes, 2 en 4K)
    piel = cv2.GaussianBlur(piel * m, (0, 0), 6 * k)
    # bilateral siempre a 540 px de ancho (rápido y con el mismo resultado en 1080 y 4K) y de vuelta
    small = cv2.resize(img, (540, round(h * 540 / w)), interpolation=cv2.INTER_AREA)
    bil = cv2.bilateralFilter(small, 0, 28 * SUAVE, 6 * SUAVE)
    bil = cv2.bilateralFilter(bil, 0, 22 * SUAVE, 4 * SUAVE)
    liso = cv2.resize(bil, (w, h), interpolation=cv2.INTER_LINEAR).astype(np.float32)
    orig = img.astype(np.float32)
    detalle = orig - cv2.GaussianBlur(orig, (0, 0), 1.2 * k)   # poro fino: se devuelve un poco
    liso = liso + detalle * (0.35 / SUAVE)
    a = (piel * FUERZA)[..., None]
    out = orig * (1 - a) + liso * a
    out = np.clip(out, 0, 255).astype(np.uint8)
    # color
    b, g, r = cv2.split(out)
    out = cv2.merge([cv2.LUT(b, LUT_B), cv2.LUT(g, LUT_G), cv2.LUT(r, LUT_R)])
    hsv = cv2.cvtColor(out, cv2.COLOR_BGR2HSV).astype(np.float32)
    hsv[..., 1] = np.clip(hsv[..., 1] * (1 + 0.05 * COLOR - 0.13 * piel), 0, 255)  # más vida al resto, piel un poco menos saturada
    return cv2.cvtColor(hsv.astype(np.uint8), cv2.COLOR_HSV2BGR)


def uno(f):
    n = os.path.basename(f)
    img = cv2.imread(f); mask = cv2.imread(os.path.join(proy, 'mascaras', n), cv2.IMREAD_GRAYSCALE)
    if os.path.exists(os.path.join(proy, SALIDA, n)) and '--reanudar' in args: return
    k = int(n[:5])
    while mask is None and k > 1:  # si falta la máscara de este cuadro, usar la anterior
        k -= 1; mask = cv2.imread(os.path.join(proy, 'mascaras', f'{k:05d}.jpg'), cv2.IMREAD_GRAYSCALE)
    cv2.imwrite(os.path.join(proy, SALIDA, n), procesa(img, mask), [cv2.IMWRITE_JPEG_QUALITY, CALIDAD])


if PRUEBA:
    n = f'{PRUEBA:05d}.jpg'
    img = cv2.imread(os.path.join(proy, 'cuadros', n)); mask = cv2.imread(os.path.join(proy, 'mascaras', n), cv2.IMREAD_GRAYSCALE)
    pro = procesa(img, mask)
    cara = lambda im: cv2.resize(im[380:1100, 240:840], (600, 720))
    os.makedirs(os.path.join(proy, 'salida'), exist_ok=True)
    cv2.imwrite(os.path.join(proy, 'salida', 'piel_prueba.jpg'), np.hstack([cara(img), cara(pro)]))
    print('antes | después →', os.path.join(proy, 'salida', 'piel_prueba.jpg'))
    sys.exit()

os.makedirs(os.path.join(proy, SALIDA), exist_ok=True)
fs = sorted(glob.glob(os.path.join(proy, ENTRADA, '*.jpg')))
with ThreadPoolExecutor(HILOS) as ex:
    for i, _ in enumerate(ex.map(uno, fs)):
        if i % 200 == 0: print(f'  {i}/{len(fs)}', flush=True)
print(f'✓ {len(fs)} cuadros → {SALIDA}/')
