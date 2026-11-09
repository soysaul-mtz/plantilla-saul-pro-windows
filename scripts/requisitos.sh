#!/usr/bin/env bash
# Revisa (dentro de Ubuntu / WSL) que esté todo lo que usa la plantilla Saúl Pro y dice el comando EXACTO para lo que falte.
# No instala nada solo. Uso: scripts/requisitos.sh   (desde la carpeta de la plantilla)
cd "$(dirname "$0")/.."; export PATH="$HOME/.local/bin:$PATH"; falta=0
si() { printf "\033[32m✓\033[0m %s\n" "$1"; }
no() { printf "\033[31m✗\033[0m %s\n    → %s\n" "$1" "$2"; falta=$((falta+1)); }
SIS="sudo ./instalar.sh --sistema   (pide TU contraseña de Ubuntu: pégalo tú en la terminal de Ubuntu)"
grep -qi microsoft /proc/version 2>/dev/null && si "Ubuntu dentro de Windows (WSL)" || si "Linux"
ffmpeg -version 2>/dev/null | head -1 | grep -qE 'version n?([7-9]|[1-9][0-9])' && si "ffmpeg 7+" || no "ffmpeg 7 o más nuevo" "$SIS"
node -e 'process.exit(+process.versions.node.split(".")[0] >= 20 ? 0 : 1)' 2>/dev/null && si "Node $(node -v)" || no "Node 20 o más nuevo" "$SIS"
command -v python3 >/dev/null && python3 -c 'import venv' 2>/dev/null && si "Python $(python3 -V | cut -d' ' -f2)" || no "Python 3 con venv" "$SIS"
{ [ -x /usr/bin/google-chrome ] || [ -x /usr/bin/chromium ] || [ -x /usr/local/bin/chromium ]; } && si "Chrome (el motor dibuja con Chrome)" || no "Chrome" "$SIS"
if (( falta )); then echo; echo "Faltan $falta programa(s) del sistema: un solo comando los instala todos. Luego vuelve a correr scripts/requisitos.sh"; exit 1; fi
p=0
.venv/bin/python -c 'import faster_whisper, cv2, numpy' 2>/dev/null && si "Python de la plantilla + Whisper" || p=1
[ -d motor/node_modules/puppeteer-core ] && si "motor de render" || p=1
[ -x bin/segmentar ] && [ -x revision/bin/fotogramas ] && si "herramientas de visión" || p=1
[ -f estilo-cine/sfx/whoosh_rapido.mp3 ] && si "efectos de sonido" || p=1
[ -f "${SKILLS_DIR:-$HOME/.claude/skills}/plantilla-saul-pro/SKILL.md" ] && si "skill de Claude" || p=1
if (( p )); then echo; printf "\033[31m✗\033[0m Falta preparar la carpeta de la plantilla (Python, motor, visión, efectos y skill; ≈ 10 min, baja ≈ 2 GB la primera vez)\n    → ./instalar.sh\n"; exit 1; fi
[ -f config/kit.json ] && si "config/kit.json (tus datos)" || printf "\033[33m·\033[0m Falta config/kit.json (tu nombre y tu @): Claude, pregúntaselos y créalo\n"
echo; echo "Todo listo. Prueba: node estilo-cine/render.mjs proyectos/demo"
