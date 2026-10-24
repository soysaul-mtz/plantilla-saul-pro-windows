# Estilo "cine" (referencia: Referencia de edicion.mp4)

Reel sin cara: voz profunda + tipografía palabra por palabra (Helvetica Neue, línea chica + palabra gigante, marcatextos amarillo, contorno dorado),
escenas que alternan papel claro / negro, objetos 3D, y textura de película (grano, separación RGB, fallas, destellos, borde Kodak, motas).

Dos modos con el mismo texto, transiciones y audio:
- `codigo`: todo en 3D con Three.js (logos extruidos de Simple Icons, ojo, cuadrícula de teléfonos, moneda). Sin costo.
- `hf`: imágenes de Higgsfield (GPT Image 2.5) animadas con código. **Solo imágenes, no videos** (los videos cuestan ~64–80 créditos c/u).

## Uso
```
python3 estilo-cine/gen_hf.py proyectos/<nombre>                 # imágenes de hf_prompts.json → hf/<id>.png
node estilo-cine/render.mjs proyectos/<nombre> --modo codigo     # → salida/cine_codigo.mp4
node estilo-cine/render.mjs proyectos/<nombre> --modo hf         # → salida/cine_hf.mp4
node estilo-cine/render.mjs proyectos/<nombre> --stills 1.2,8.5  # cuadros sueltos para revisar
```
Proyecto: `cine.json` (escenas, grupos de texto, transiciones, música, sfx), `voz/palabras.json` (tiempos por palabra de ElevenLabs), `audio/` (Epidemic).
Líneas de texto: `-` chica · sin prefijo grande · `*` marcatextos · `~` contorno. Cada palabra se empareja en orden con la voz.
Transiciones (`trans`): whip, glitch, flash, zoom, drop, pan. Marcas: `impacto` (golpe + destello) y `tap` (toque en pantalla).
Voz usada en la prueba: ElevenLabs "Miguel – Deep, Rich and Cinematic" (`k8cFOyAg7B9qwBlDDNTC`), eleven_multilingual_v2.
Las escenas visuales (logos, silueta, ojo, telefonos, moneda) están en `cine.js`; un guion nuevo con otras metáforas necesita escenas nuevas.

## Con video de una persona (plantillas "Saúl Pro" y "Saúl Pro 3D")
Todo desde la raíz del repositorio (`.venv/bin/python` = el Python del sistema):
```
# 1. corte: metodo.json con la cámara y los tramos elegidos (ver plantillas/saul-pro-3d/metodo_base.json)
.venv/bin/python estilo-cine/metodo_corte.py proyectos/<n>          # → corte/cam.mov (1080x1920) [+ cam_4k.mov con "perfil": "4k"]
# 2. transcripción palabra por palabra (+ --tramos para cazar retomas)
.venv/bin/python estilo-cine/transcribir.py proyectos/<n> --tramos   # → voz/palabras.json
# 3. si aparecen tropiezos o frases repetidas: quitarlas sin rehacer nada
.venv/bin/python estilo-cine/quitar_tramos.py proyectos/<n> 3.67-3.77 33.16-33.33
# 4. cuadros + máscara de persona (Vision) + filtro de piel
.venv/bin/python estilo-cine/preparar.py proyectos/<n>               # → cuadros/, mascaras/, cuadros_pro/
.venv/bin/python estilo-cine/piel.py proyectos/<n> --prueba 300      # (opcional) antes/después de la piel
# 5. escaleta → cine.json (base: plantillas/saul-pro-3d/cine_base.json) → revisar y render
node estilo-cine/render.mjs proyectos/<n> --stills 3,12.5,40
node estilo-cine/render.mjs proyectos/<n>                            # [--perfil 4k tras prep4k.py]
```
Material horizontal o con otro encuadre: cortar con ffmpeg a 1080x1920 (ver `corte.py` de ejemplo en INSTRUCCIONES de CLAUDE.md) y seguir desde el paso 2.
Visual `persona`: por defecto **fondo real** (`persona.fondo: "real"`, `persona.cuadros: "cuadros_pro"`); `fondo: "estilo"` usa papel/negro según `tema`. Grupos con `"detras": true` (texto gigante tras la cabeza), `"ventanas": true`, `"cta": {en, texto}`.
Otras escenas: `logos` con `"logos": [{marca, en}]` y `"link": t`, `telefonos` con `"resaltar": t`, `prompt`, `ojo`.

## Perfiles de salida: Redes (1080) y 4K
Se activan solo cuando el usuario dice qué calidad quiere. Sin indicación = **Redes**. Configuración en `perfiles.json`.

| | Redes (1080) | 4K |
|---|---|---|
| Salida | 1080x1920 · H.264 CRF 20 | 2160x3840 · HEVC por hardware de la Mac (45 Mbps) |
| Nombre | `Video editado - X.mp4` | `Video editado - X (4K).mp4` |
| Render | de un tirón | por bloques de 240 cuadros, reanudable (`--reanudar`), página recargada entre bloques, prioridad baja |

**Flujo 4K (bajo consumo):** la edición y las revisiones se hacen SIEMPRE con la copia ligera en 1080. El 4K solo se toca al final.
1. `metodo.json` con `"perfil": "4k"` → `metodo_corte.py` saca `corte/cam.mov` (1080, con audio) y `corte/cam_4k.mov` (mismos cortes) leyendo el original una sola vez.
2. Cuadros, máscaras (Vision a 540x960), `piel.py`, escaleta, `quitar_tramos.py` (también recorta `cam_4k.mov`), stills: todo como siempre, en 1080.
3. Al aprobar: `python estilo-cine/prep4k.py proyectos/<n>` → `cuadros_pro_4k/` (reusa las máscaras de 1080, 3 hilos, reanudable; borra los cuadros 4K crudos al terminar).
4. `node estilo-cine/render.mjs proyectos/<n> --perfil 4k` (stills 4K: `--perfil 4k --stills 12.3`).

El motor dibuja todo en coordenadas de 1080 y lo escala ×2 (`?e=2`): textos, gráficos, Three.js, sombras y desenfoques salen idénticos al 1080, pero nítidos. Si la cámara original no es 4K, `prep4k.py` avisa que el 4K saldrá escalado.
