# Guía para Claude · Plantilla Saúl Pro

> Esta guía explica **qué es** Saúl Pro y **cómo hacerlo** paso a paso con este sistema. Léela completa antes de editar.
> Rutas relativas a la raíz del sistema. Ejemplo real terminado: `proyectos/ejemplo-c8252/` (su `cine.json`) y el video final
> en la página de *Releases* del repositorio ("Video editado - C8252.mp4").

## Qué es
Reel **vertical 1080×1920** de marca personal, con look de cine: la persona habla a cámara **con su fondo real** y un filtro de
piel sutil; el texto aparece **palabra por palabra** con la voz (línea chica + palabra gigante, a veces gigante **detrás de la
cabeza**), y entre frases entran **escenas gráficas** hechas con código (logos 3D, teléfonos, hoja de guion, laptop, contador,
chat, interfaz de una herramienta…) que ilustran lo que dice. Encima va **textura de película** (grano fino, leve separación RGB,
viñeta), transiciones rápidas (whip, glitch, flash, zoom), **música que se oye desde el segundo 0** con un *drop* en el giro del
guion, efectos de sonido en los golpes y un **CTA** de "comenta PALABRA" con una notificación de DM.

**Para qué sirve:** reels de Dolor, Valor, Autoridad y Objeciones para una marca personal: retener con ritmo y explicar con
imágenes sin perder la cara de la persona.

**Cómo se reconoce:** persona con su fondo real + tipografía Helvetica Neue chica/gigante + escenas que alternan papel claro y
negro + grano de película + un golpe visual en cada idea. Ritmo: algo cambia cada 1–3 s, nunca más de 0.3 s quieto.

## Antes de empezar (siempre)
1. Pregunta una sola vez: **música** (carpeta con canciones o MCP de música como Epidemic Sound), **duración máxima**,
   **formato** (Redes 1080 por defecto; 4K solo si lo pide), nombres propios y **la palabra del CTA** ("comenta VIDEO").
2. Transcribe y busca retomas (abajo, paso 2) y entrega la **ESCALETA** sin editar nada: tabla
   `# · tiempo · qué dice · qué se ve (persona/escena) · animación · texto en pantalla` + retomas que se quitan + preguntas.
   Muestra el plan **tal cual** y corrige fila por fila hasta que diga "sí".

## Cómo hacerlo, paso a paso
Todo desde la raíz del sistema; `.venv/bin/python` es el Python del sistema. Cada video en su carpeta `proyectos/<nombre>/`.

1. **Corte** (`metodo.json` con la cámara y los tramos elegidos; la base está en `proyectos/ejemplo-c8252/metodo.json` si existe, o
   pon `{"camara": "<video>", "tramos": [[ini, fin], …]}`):
   `.venv/bin/python estilo-cine/metodo_corte.py proyectos/<n>` → `corte/cam.mov` (1080×1920).
   Si la toma es horizontal, recorta a 1080×1920 con la persona centrada (o del lado contrario a donde señala).
   Si el video es HDR (iPhone/DJI en HLG), conviértelo antes: `bin/sdr entrada salida.mov`.
2. **Transcripción** palabra por palabra y caza de retomas:
   `.venv/bin/python estilo-cine/transcribir.py proyectos/<n> --tramos` → `voz/palabras.json`.
   Whisper de corrido **fusiona frases repetidas**: confirma cada sospecha con la energía del audio y transcribiendo clips cortos.
   Si suena audio de fondo (una bocina, otro video), sepáralo por volumen: la persona suena ~10 dB más fuerte; nunca uses esos tramos.
3. **Quitar tropiezos** sin rehacer nada: `.venv/bin/python estilo-cine/quitar_tramos.py proyectos/<n> 3.67-3.77 33.16-33.33`
4. **Cuadros + máscara de la persona (Vision) + filtro de piel:**
   `.venv/bin/python estilo-cine/preparar.py proyectos/<n>` → `cuadros/`, `mascaras/`, `cuadros_pro/`.
   Prueba la piel antes: `.venv/bin/python estilo-cine/piel.py proyectos/<n> --prueba 300` (valores por defecto; subirlo se ve "demasiado filtro").
5. **`cine.json`** (ver formato abajo y el ejemplo `proyectos/ejemplo-c8252/cine.json`): una escena por idea.
6. **Cuadros de prueba:** `node estilo-cine/render.mjs proyectos/<n> --stills 3,12.5,40` (6–10 tiempos: cortes, escenas, CTA) y míralos
   con `estilo-cine/zona_segura.png` en mente.
7. **Render:** `node estilo-cine/render.mjs proyectos/<n>` → `"salida"` (por defecto `Video editado - <nombre>.mp4` junto al original).
   4K solo si lo piden: `metodo.json` con `"perfil": "4k"`, todo se edita en 1080 y al final
   `.venv/bin/python estilo-cine/prep4k.py proyectos/<n>` + `node estilo-cine/render.mjs proyectos/<n> --perfil 4k`.
8. **Revisión final cuadro por cuadro (obligatoria):**
   `revision/.venv/bin/python revision/revisar_final.py proyectos/<n>/revision "<video final>"` → mira las hojas de
   `revision_final/` (marco rojo = problema: destellos de un cuadro, cuadros negros, imagen congelada, audio que satura).
   Además transcribe el audio final **por tramos** (con música Whisper inventa cosas) y mide el volumen (−14 LUFS).

## El `cine.json`
```json
{
 "handle": "@tu_usuario", "fps": "24000/1001", "cola": 0.7, "voz": "corte/cam.mov",
 "salida": "/ruta/Video editado - C8252.mp4",
 "persona": {"cuadros": "cuadros_pro", "mascaras": "mascaras", "crudos": "cuadros", "n": 1068, "fondo": "real"},
 "cortes": [4.8, 7.05, 12.68],
 "musica": {"archivo": "audio/cancion.mp3", "desde": 58.44, "vol": 0.2, "vol_drop": 0.26, "drop": 17.26, "bajar": [[7.03, 12.7, 0.35]]},
 "marcas": {"impacto": -9, "tap": -9}, "sfx_auto": true,
 "sfx": [{"f": "estilo-cine/sfx/boom.mp3", "en": 1.42, "pico": 0.5, "vol": 0.5}],
 "escenas": [
  {"visual": "persona", "tema": "oscuro", "golpe": 1.42, "grupos": [
     {"y": 0.7, "lineas": ["-Todos tus videos", "los estás haciendo"]},
     {"y": 0.2, "detras": true, "lineas": ["mal"]}]},
  {"visual": "guion", "tema": "claro", "trans": "whip", "sello": 4.28, "grupos": [{"y": 0.2, "lineas": ["-porque estás usando", "inteligencia artificial"]}]}
 ]
}
```
- **Líneas:** `-` = chica · sin prefijo = gigante · `*` = marcatextos · `~` = contorno. Cada palabra se empareja en orden con la voz.
  `palabra|como se ve` cambia cómo se escribe (vacío la oculta).
- **Escenas (`visual`):** `persona` (con `"detras": true` = texto gigante tras la cabeza, `"ventanas"`, `"cta": {en, texto}`),
  `logos` (`"logos": [{marca, en}]`, `"link": t`), `telefonos` (`"resaltar": t`), `prompt`, `ojo`, `guion`, `laptop` (`img` + `pantalla` = 4 esquinas),
  `tripie`, `censurados`, `clip`, `contador`, `tarjetas`, `chat`, `herramienta`, `vscode`, `napkin`, `interfaz`
  (`tipo`: notebooklm, napkin, higgsfield, heygen, elevenlabs, claudecode), `moneda`, `silueta`.
- **Transiciones (`trans`):** whip, glitch, flash, zoom, drop, pan. Marcas `impacto` (golpe + destello) y `tap`.
- `tema`: `claro` (papel) / `oscuro` (negro). `textoTema: "oscuro"` = subtítulos blancos cuando la ropa es oscura.
- Un guion con metáforas nuevas puede necesitar una escena nueva en `estilo-cine/cine.js` (`const VIS = {…}` al final).

## Reglas que ya se aprendieron (respétalas siempre)
- **Fondo real.** No recortar a la persona ni cambiarle el fondo ni bajarla en el cuadro: "se ve chafa". La máscara solo sirve para
  meter texto gigante **detrás** de la cabeza (oscuro con halo claro si la pared es clara; en y≈0.095 para que se lea arriba).
- **Piel sutil** (valores por defecto de `piel.py`) y que **no se vea verde ni naranja**: nada de `eq=saturation` ni grano en canales
  de color; si la toma es muy cálida, `colorbalance` hacia azul y `piel.py --color 0.5`.
- **Sin cuadros muertos:** arrancar justo cuando empieza a hablar; quitar pausas largas y tropiezos; volver de una escena gráfica
  sin quedarse a cuadro callado.
- **Zona segura de Instagram:** nada importante con y < 262, y > 1540, ni x > 900 desde y > 700 (botones), 42 px de margen.
- **Nada encima de la cara.**
- **Cuando menciona una herramienta:** su interfaz emulada en código **a pantalla completa** con interacción (escribir, clic,
  generar), no como tarjeta encima; en esas escenas no pongas `cortes`.
- **Listas:** del lado al que la persona **señala** (revisa sus gestos cuadro por cuadro); solo lo que dice.
- **Zoom lento** con tope +5 % que se reinicia en cada corte; nunca acercamientos acumulados.
- **Ritmo:** animaciones encadenadas, < 5 % del video quieto, pausas ≤ 0.3 s; transición visible en cada corte.
- **Música:** una canción distinta por video, que se escuche desde el segundo 0 (sin intro suave), el *drop* en el giro del guion,
  la voz siempre ≥ 8 dB por encima; los efectos no pisan la última sílaba de una frase.
- **Imágenes con IA (Higgsfield):** solo imágenes, nunca videos (son caros); se animan con código.
- **Clips ajenos:** pide el recorte exacto a la persona y úsalo tal cual; no lo cortes a media oración.
- **Primero la escaleta**, luego un mini render de lo nuevo, luego el completo.

## Evita
- Inventar datos, cifras o pantallas de apps que no existen.
- Entregar sin la revisión final cuadro por cuadro.
- Mezclar con otras plantillas: este paquete solo trae Saúl Pro.
