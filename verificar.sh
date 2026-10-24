#!/usr/bin/env bash
# Revisa la instalación (Windows con WSL / Linux) y renderiza el video de prueba (proyectos/demo). Uso: ./verificar.sh [--sin-render]
KIT="$(cd "$(dirname "$0")" && pwd)"; cd "$KIT"; f=0
export PATH="$HOME/.local/bin:$PATH"
chk() { if eval "$2" >/dev/null 2>&1; then printf "\033[32m✓\033[0m %s\n" "$1"; else printf "\033[31m✗\033[0m %s  →  %s\n" "$1" "$3"; f=1; fi; }
chk "ffmpeg 7+"                "ffmpeg -version | head -1 | grep -qE 'version n?([7-9]|[1-9][0-9])'" "sudo ./instalar.sh --sistema"
chk "Node 20+"                 "node -e 'process.exit(+process.versions.node.split(\".\")[0] >= 20 ? 0 : 1)'" "sudo ./instalar.sh --sistema"
chk "Chrome"                   "test -x /usr/bin/google-chrome -o -x /usr/bin/chromium -o -x /usr/local/bin/chromium" "sudo ./instalar.sh --sistema"
chk "Fuente Helvetica (Nimbus Sans)" "fc-match 'Helvetica Neue' | grep -qi nimbus"   "./instalar.sh"
chk "Python + Whisper"         ".venv/bin/python -c 'import mlx_whisper, faster_whisper, cv2, numpy'" "./instalar.sh"
chk "Visión (MediaPipe, OpenCV, RapidOCR)" ".venv/bin/python -c 'import sys; sys.path.insert(0, \"plataforma\"); import comun, rapidocr_onnxruntime; comun.Persona(False); comun.Caras()'" "sudo ./instalar.sh --sistema  y luego  ./instalar.sh"
chk "motor (puppeteer)"        "test -d motor/node_modules/puppeteer-core"        "cd motor && npm install"
chk "bin/segmentar"            "test -x bin/segmentar"                            "./instalar.sh"
chk "revisión final"           "test -x revision/bin/fotogramas"                  "./instalar.sh"
chk "efectos de sonido"        "test -f estilo-cine/sfx/whoosh_rapido.mp3"        "./instalar.sh"
chk "skill plantilla-saul-pro" "test -f ${SKILLS_DIR:-$HOME/.claude/skills}/plantilla-saul-pro/SKILL.md" "./instalar.sh"
[[ "$1" == "--sin-render" ]] && exit $f
printf "\n\033[36mRender de prueba (proyectos/demo)…\033[0m\n"
if node estilo-cine/render.mjs proyectos/demo; then
  V="$KIT/proyectos/demo/salida/cine_codigo.mp4"; printf "\033[32m✓ Todo funciona:\033[0m %s\n" "$V"
  if grep -qi microsoft /proc/version 2>/dev/null; then echo "  En Windows lo ves en: $(wslpath -w "$V" 2>/dev/null)"; explorer.exe "$(wslpath -w "$(dirname "$V")")" >/dev/null 2>&1 || true; fi
else f=1; fi
exit $f
