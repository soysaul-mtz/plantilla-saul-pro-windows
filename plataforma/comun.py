"""Piezas comunes de las herramientas de visión para Windows (WSL) y Linux: lectura de video cuadro por cuadro y modelos.

En Mac el sistema usa Vision de Apple (los .swift). En Windows/Linux usa estas versiones en Python, que dan la MISMA
salida con el mismo uso por línea de comandos:
  segmentar.py  (= segmentar.swift)  máscara de persona      · MediaPipe (selfie multiclass)
  caras.py      (= caras.swift)      cara + coronilla         · OpenCV YuNet + MediaPipe
  fotogramas.py (= fotogramas.swift) caras + texto en pantalla · OpenCV YuNet + RapidOCR
  sdr.py        (= sdr.swift)        HDR → Rec.709            · ffmpeg (zscale + tonemap)
  manos.py / recortar.py                                      · MediaPipe
Los modelos (≈25 MB) se bajan solos la primera vez a plataforma/modelos/.
"""
import os, sys, json, re, subprocess, threading, urllib.request

AQUI = os.path.dirname(os.path.abspath(__file__))
MODELOS = os.path.join(AQUI, "modelos")
URL = {
    "yunet.onnx": "https://github.com/opencv/opencv_zoo/raw/main/models/face_detection_yunet/face_detection_yunet_2023mar.onnx",
    "selfie_multiclass.tflite": "https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_multiclass_256x256/float32/latest/selfie_multiclass_256x256.tflite",
    "selfie.tflite": "https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite",
    "cara_blaze.tflite": "https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/latest/blaze_face_short_range.tflite",
    "manos.task": "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/latest/hand_landmarker.task",
}


def modelo(nombre):
    """Ruta del modelo; lo baja si falta."""
    ruta = os.path.join(MODELOS, nombre)
    if not os.path.exists(ruta):
        os.makedirs(MODELOS, exist_ok=True)
        print(f"  bajando el modelo {nombre} (solo la primera vez)…", file=sys.stderr, flush=True)
        tmp = ruta + ".part"
        urllib.request.urlretrieve(URL[nombre], tmp)
        os.replace(tmp, ruta)
    return ruta


def info(video):
    """Ancho y alto YA ROTADOS (como se ve el video), fps nominal y duración."""
    r = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries",
                        "stream=width,height,r_frame_rate,avg_frame_rate:stream_side_data=rotation:stream_tags=rotate:format=duration",
                        "-of", "json", video], capture_output=True, text=True, check=True)
    j = json.loads(r.stdout); s = j["streams"][0]
    w, h = int(s["width"]), int(s["height"])
    rot = 0
    for sd in s.get("side_data_list", []) or []:
        if "rotation" in sd: rot = int(float(sd["rotation"]))
    if "rotate" in (s.get("tags") or {}): rot = int(s["tags"]["rotate"])
    if abs(rot) % 180 == 90: w, h = h, w
    num, den = (s.get("avg_frame_rate") or s["r_frame_rate"]).split("/")
    fps = float(num) / float(den) if float(den) else 0.0
    if not fps:
        num, den = s["r_frame_rate"].split("/"); fps = float(num) / float(den)
    return w, h, fps, float(j.get("format", {}).get("duration") or 0)


def cuadros(video, ancho=None, alto=None, desde=None, hasta=None, gris=False):
    """Genera (i, t, imagen) por cada fotograma, en orden. imagen = numpy BGR (o gris) de ancho×alto (o tamaño real).
    t = tiempo real del fotograma (pts), igual que Vision/AVFoundation."""
    import numpy as np
    W, H, fps, _ = info(video)
    ow, oh = (ancho or W), (alto or H)
    vf = [f"scale={ow}:{oh}:flags=bicubic"] if (ow, oh) != (W, H) else []
    vf.append("showinfo")
    cmd = ["ffmpeg", "-v", "info", "-nostats", "-hide_banner"]
    if desde is not None: cmd += ["-ss", str(desde)]
    cmd += ["-i", video]
    if hasta is not None: cmd += ["-t", str(hasta - (desde or 0))]
    cmd += ["-map", "0:v:0", "-fps_mode", "passthrough", "-vf", ",".join(vf), "-pix_fmt", "gray" if gris else "bgr24", "-f", "rawvideo", "-"]
    p = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, bufsize=10 ** 7)
    tiempos, cond = [], threading.Condition()
    patron = re.compile(r"\bn:\s*(\d+).*?pts_time:\s*([-0-9.e]+)")

    def leer_err():
        for linea in iter(p.stderr.readline, b""):
            m = patron.search(linea.decode("utf-8", "replace"))
            if m:
                with cond: tiempos.append(float(m.group(2)) + (desde or 0)); cond.notify_all()
        with cond: tiempos.append(None); cond.notify_all()
    hilo = threading.Thread(target=leer_err, daemon=True); hilo.start()
    tam = ow * oh * (1 if gris else 3); i = 0
    while True:
        buf = p.stdout.read(tam)
        if len(buf) < tam: break
        with cond:
            while len(tiempos) <= i: cond.wait(timeout=5)
            t = tiempos[i] if tiempos[i] is not None else (i / fps + (desde or 0))
        img = np.frombuffer(buf, np.uint8).reshape((oh, ow) if gris else (oh, ow, 3))
        yield i, t, img
        i += 1
    p.wait()


class Caras:
    """Detector de caras YuNet (OpenCV). detectar(img BGR) → lista de cajas [x0,y0,x1,y1] en px, de mayor a menor."""
    SEGURA = 0.88   # arriba de esto YuNet casi nunca se equivoca; abajo, se confirma con un segundo detector

    def __init__(self, umbral=0.6):
        import cv2
        self.cv2 = cv2
        self.det = cv2.FaceDetectorYN.create(modelo("yunet.onnx"), "", (320, 320), umbral, 0.3, 5000)
        self._blaze = None

    def _confirmar(self, img, x, y, w, h):
        """Segunda opinión (MediaPipe BlazeFace) sobre un recorte ampliado: descarta manos, estampados y objetos con forma de cara."""
        import numpy as np, mediapipe as mp
        if self._blaze is None:
            from mediapipe.tasks.python import vision, BaseOptions
            self._blaze = vision.FaceDetector.create_from_options(vision.FaceDetectorOptions(
                base_options=BaseOptions(model_asset_path=modelo("cara_blaze.tflite")), min_detection_confidence=0.5))
        H, W = img.shape[:2]; m = max(w, h)
        x0, y0 = int(max(0, x + w / 2 - m)), int(max(0, y + h / 2 - m)); x1, y1 = int(min(W, x + w / 2 + m)), int(min(H, y + h / 2 + m))
        rec = img[y0:y1, x0:x1]
        if rec.size == 0: return False
        rec = self.cv2.resize(rec, (256, 256), interpolation=self.cv2.INTER_LINEAR)
        r = self._blaze.detect(mp.Image(image_format=mp.ImageFormat.SRGB, data=np.ascontiguousarray(self.cv2.cvtColor(rec, self.cv2.COLOR_BGR2RGB))))
        return len(r.detections) > 0

    def detectar(self, img, lado=640, margen=0.08):
        """margen: se agranda la caja a los lados (YuNet la da más angosta que Vision; mejor de más que tapar la cara)."""
        h, w = img.shape[:2]; k = min(1.0, lado / max(w, h))
        peq = self.cv2.resize(img, (round(w * k), round(h * k)), interpolation=self.cv2.INTER_AREA) if k < 1 else img
        self.det.setInputSize((peq.shape[1], peq.shape[0]))
        _, res = self.det.detect(peq)
        crudas = [((float(r[0]) / k, float(r[1]) / k, float(r[2]) / k, float(r[3]) / k), float(r[14])) for r in (res if res is not None else [])]
        claras = [b for b, sc in crudas if sc >= self.SEGURA]

        def en_el_cuerpo(b):   # dudosa, más chica y bajo la barbilla de una cara clara: mano, micrófono o estampado de esa persona
            x, y, bw, bh = b
            for X, Y, W, H in claras:
                if bw * bh < W * H and Y + 0.9 * H < y < Y + 3.5 * H and x < X + 1.5 * W and x + bw > X - 0.5 * W: return True
            return False
        cajas = []
        for (x, y, bw, bh), sc in crudas:
            if sc < self.SEGURA and (en_el_cuerpo((x, y, bw, bh)) or not self._confirmar(img, x, y, bw, bh)): continue
            x -= bw * margen; bw *= 1 + 2 * margen
            cajas.append([max(0.0, x), max(0.0, y), min(float(w), x + bw), min(float(h), y + bh)])
        return sorted(cajas, key=lambda c: -(c[2] - c[0]) * (c[3] - c[1]))


class Persona:
    """Máscara de persona con MediaPipe. fina=True usa el modelo multiclass (pelo, piel, ropa) para recortes;
    fina=False el selfie rápido (para saber dónde está la cabeza)."""
    def __init__(self, fina=True):
        from mediapipe.tasks.python import vision, BaseOptions
        import mediapipe as mp
        self.mp = mp; self.fina = fina
        op = vision.ImageSegmenterOptions(base_options=BaseOptions(model_asset_path=modelo("selfie_multiclass.tflite" if fina else "selfie.tflite")),
                                          running_mode=vision.RunningMode.IMAGE, output_confidence_masks=True, output_category_mask=False)
        self.seg = vision.ImageSegmenter.create_from_options(op)

    def mascara(self, img):
        """img BGR → float32 0..1 (1 = persona) del mismo tamaño."""
        import numpy as np, cv2
        rgb = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
        r = self.seg.segment(self.mp.Image(image_format=self.mp.ImageFormat.SRGB, data=np.ascontiguousarray(rgb)))
        cm = r.confidence_masks
        m = (1.0 - cm[0].numpy_view()) if self.fina else cm[-1].numpy_view()   # multiclass: 0 = fondo · selfie: última = persona
        m = np.squeeze(m).astype(np.float32)
        m = (m - 0.15) / 0.7                                                    # el modelo deja ~10 % en el fondo: fondo 0, persona 1
        if m.shape[:2] != img.shape[:2]: m = cv2.resize(m, (img.shape[1], img.shape[0]), interpolation=cv2.INTER_LINEAR)
        return np.clip(m, 0, 1)


def coronilla(m, umbral=0.5, fraccion=1 / 60):
    """Primera fila (desde arriba) con suficiente persona; -1 si no hay."""
    import numpy as np
    filas = (m > umbral).sum(axis=1)
    idx = np.nonzero(filas > m.shape[1] * fraccion)[0]
    return int(idx[0]) if len(idx) else -1
