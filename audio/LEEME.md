# Música y efectos de sonido

**No vienen en el repositorio**: la música y los efectos que usa el sistema son de **Epidemic Sound**, y su licencia
es personal (cada cuenta descarga los suyos). Hay dos caminos:

1. **Sin Epidemic (funciona de inmediato):** `python3 audio/efectos_basicos.py` genera efectos sintetizados libres de
   derechos con los mismos nombres. El render sale sin música si no hay archivo de música (avisa y sigue).
2. **Con tu cuenta de Epidemic Sound (recomendado):** conecta el MCP de Epidemic (ver INSTALAR.md) y pídele a Claude:
   *"Descarga los efectos y la música de audio/catalogo.json con mi Epidemic"*. Claude busca cada título con
   `SearchSoundEffects` / `SearchRecordings`, los baja con `DownloadSoundEffect` / `DownloadRecording` (MP3) y los guarda
   en `estilo-cine/sfx/` con el nombre de la columna `archivo` (reemplazando los sintetizados).

Reglas de música que ya aprendimos: una canción distinta en cada video, que se escuche desde el segundo 0 (elegir un
`desde` donde la canción ya está llena), mezcla final a −14 LUFS y la voz siempre ≥ 8 dB por encima de la música.
