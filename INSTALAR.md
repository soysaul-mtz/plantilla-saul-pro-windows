# Instalación (para Claude)

La persona descargó este repositorio y te pidió instalar la plantilla. Habla en español y explica cada paso en una línea.
No le pidas contraseñas ni llaves en el chat.

Esta es la versión para **Windows con WSL (Ubuntu)** (también sirve en Linux). Si `uname -s` no dice `Linux`, la persona necesita la versión para Mac.

## Pasos
1. La carpeta debe estar en Linux (`~/plantilla-saul-pro`), no en `/mnt/c/...` (sería muy lento). Si está en `/mnt/c`, muévela con `mv`.
2. **Corre `./instalar.sh`.** La primera vez dice que faltan programas del sistema e imprime `sudo …/instalar.sh --sistema`.
   Tú NO puedes escribir la contraseña de Ubuntu: **pídele a la persona que pegue ese comando en su ventana de Ubuntu** y te avise
   (instala ffmpeg, Python, Node, Chrome y fuentes; ~2 minutos).
3. Vuelve a correr `./instalar.sh` (sin sudo; córrelo en segundo plano): Python con Whisper (faster-whisper, baja ~1.6 GB),
   herramientas de visión (MediaPipe/OpenCV/RapidOCR, las equivalentes a Vision de Mac), el motor, efectos y la skill.
   Si no pudo preguntar nombre y @usuario, pregúntaselos y crea `config/kit.json`.
4. **Prueba:** `./verificar.sh` (renderiza `proyectos/demo`; tarda unos 3–4 minutos) y dile dónde verlo en Windows (la ruta que imprime).
5. **Enséñale a usarlo:** que abra Ubuntu, escriba `cd ~/plantilla-saul-pro && claude` y pida "Edita este video con Saúl Pro: …".
   Sus videos de Windows están en `/mnt/c/Users/<usuario>/` (Escritorio = `Desktop`, Descargas = `Downloads`). Desde ahí sigue
   `CLAUDE.md` y lee completa `plantillas/saul-pro/GUIA.md`.
6. **Opcional:** música (una carpeta con sus canciones o el conector de Epidemic Sound en claude.ai → Conectores) e imágenes con IA
   (CLI `higgsfield`, solo imágenes; su llave se guarda con `security`).
