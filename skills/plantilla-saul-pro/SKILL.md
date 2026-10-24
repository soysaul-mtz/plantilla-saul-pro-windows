---
name: plantilla-saul-pro
description: Edita reels verticales con la plantilla Saúl Pro (persona con su fondo real, texto palabra por palabra chico + gigante y detrás de la cabeza, escenas animadas con código, textura de película, música y CTA). Úsala cuando la persona pase un video para editar "con Saúl Pro" o pida un reel de marca personal con este estilo.
---

# Plantilla Saúl Pro

1. Abre y sigue `CLAUDE.md` de la carpeta de la plantilla (ruta al final de este archivo) y, antes de editar, lee completa
   `plantillas/saul-pro/GUIA.md` (qué es, flujo con comandos, formato de `cine.json`, reglas y qué evitar).
2. Si falta algo instalado (`.venv`, `bin/segmentar`, `config/kit.json`), sigue `INSTALAR.md` (`instalar.sh`). Esta es la versión para Windows (WSL): lee la sección "En Windows" de `CLAUDE.md`.
3. Primero preguntas (música, duración máxima, formato, palabra del CTA) → transcripción y retomas → **plan tal cual** → espera el "sí".
4. Al terminar: revisión final cuadro por cuadro (`revision/revisar_final.py`) y verificación del audio. No se publica nada sin confirmación.
