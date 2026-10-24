#!/usr/bin/env bash
# Instalador de la plantilla Saúl Pro para WINDOWS (con WSL, Ubuntu) y Linux. (La versión para Mac es otro repositorio.)
# Uso:  ./instalar.sh              instala todo lo de tu usuario (se puede correr varias veces)
#       sudo ./instalar.sh --sistema   programas del sistema (ffmpeg, Node, Chrome, fuentes…); pide tu contraseña
# Si faltan programas del sistema, el instalador te dice el comando exacto para pegarlo TÚ en la terminal de Ubuntu.
set -e
KIT="$(cd "$(dirname "$0")" && pwd)"
cd "$KIT"
ok()   { printf "\033[32m✓\033[0m %s\n" "$1"; }
paso() { printf "\n\033[36m▸ %s\033[0m\n" "$1"; }
aviso(){ printf "\033[33m⚠ %s\033[0m\n" "$1"; }
ARCH="$(uname -m)"

# ------------------------------------------------------------------ parte 1: programas del sistema (con sudo)
if [[ "$1" == "--sistema" ]]; then
  [[ $EUID -eq 0 ]] || { echo "Corre: sudo $0 --sistema"; exit 1; }
  export DEBIAN_FRONTEND=noninteractive
  paso "Programas base (ffmpeg, Python, fuentes, zsh)"
  apt-get update -qq
  apt-get install -y -qq git curl ca-certificates gnupg unzip zsh ffmpeg python3 python3-venv python3-pip python3-dev \
    fontconfig fonts-urw-base35 fonts-noto-color-emoji fonts-liberation fonts-dejavu-core libgl1 libegl1 libgles2 libglib2.0-0 libportaudio2 >/dev/null
  # el sistema usa opciones de ffmpeg 7+ (Ubuntu trae la 6): se pone la compilación estática oficial de BtbN en /usr/local/bin
  v=$(/usr/local/bin/ffmpeg -version 2>/dev/null | head -1 | sed -E 's/^ffmpeg version n?([0-9]+).*/\1/'); [[ "$v" =~ ^[0-9]+$ ]] || v=0
  if (( v < 7 )); then
    [[ "$ARCH" == "x86_64" ]] && A=linux64 || A=linuxarm64
    N=$(curl -fsSL https://api.github.com/repos/BtbN/FFmpeg-Builds/releases/latest | grep -oE "ffmpeg-n[0-9.]+-latest-$A-gpl-[0-9.]+\.tar\.xz" | sort -uV | tail -1)
    [[ -n "$N" ]] || N="ffmpeg-master-latest-$A-gpl.tar.xz"
    echo "   bajando $N (≈130 MB)…"
    curl -fsSL -o /tmp/ffmpeg.tar.xz "https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/$N"
    rm -rf /tmp/ffmpeg-btbn && mkdir -p /tmp/ffmpeg-btbn && tar -xJf /tmp/ffmpeg.tar.xz -C /tmp/ffmpeg-btbn --strip-components=1
    install -m 755 /tmp/ffmpeg-btbn/bin/ffmpeg /tmp/ffmpeg-btbn/bin/ffprobe /usr/local/bin/ && rm -rf /tmp/ffmpeg.tar.xz /tmp/ffmpeg-btbn
  fi
  ok "ffmpeg $(/usr/local/bin/ffmpeg -version | head -1 | awk '{print $3}') · $(python3 --version)"
  paso "Node 22"
  if ! command -v node >/dev/null || [[ "$(node -v | tr -d v | cut -d. -f1)" -lt 20 ]]; then
    curl -fsSL https://deb.nodesource.com/setup_22.x | bash - >/dev/null
    apt-get install -y -qq nodejs >/dev/null
  fi
  ok "node $(node -v)"
  paso "GitHub CLI (gh)"
  if ! command -v gh >/dev/null; then
    install -d -m 755 /etc/apt/keyrings
    curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg -o /etc/apt/keyrings/githubcli-archive-keyring.gpg
    chmod go+r /etc/apt/keyrings/githubcli-archive-keyring.gpg
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" > /etc/apt/sources.list.d/github-cli.list
    apt-get update -qq && apt-get install -y -qq gh >/dev/null
  fi
  ok "gh $(gh --version | head -1 | awk '{print $3}')"
  paso "Navegador para renderizar (Chrome)"
  if [[ -x /usr/bin/google-chrome || -x /usr/bin/chromium || -x /usr/local/bin/chromium ]]; then ok "ya instalado"
  elif [[ "$ARCH" == "x86_64" ]]; then
    curl -fsSL -o /tmp/chrome.deb https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb
    apt-get install -y -qq /tmp/chrome.deb >/dev/null && rm -f /tmp/chrome.deb && ok "Google Chrome $(google-chrome --version | awk '{print $3}')"
  else   # Windows en ARM / Linux ARM: Chromium de Playwright (Chrome no publica versión ARM para Linux)
    U="${SUDO_USER:-root}"; H=$(getent passwd "$U" | cut -d: -f6)
    sudo -u "$U" -H npx -y playwright@1 install chromium >/dev/null 2>&1 || true
    npx -y playwright@1 install-deps chromium >/dev/null 2>&1 || true
    C=$(ls -d "$H"/.cache/ms-playwright/chromium-*/chrome-linux*/chrome 2>/dev/null | tail -1)
    [[ -n "$C" ]] && ln -sf "$C" /usr/local/bin/chromium && ok "Chromium (ARM) → /usr/local/bin/chromium" || aviso "no pude instalar Chromium para ARM"
  fi
  ok "Listo. Ahora, SIN sudo:  ./instalar.sh"
  exit 0
fi

# ------------------------------------------------------------------ parte 2: todo lo de tu usuario (sin sudo)
[[ $EUID -ne 0 ]] || { aviso "No lo corras con sudo (solo la parte --sistema)."; exit 1; }
grep -qi microsoft /proc/version 2>/dev/null && EN_WSL=1 || EN_WSL=0
if [[ $EN_WSL == 1 && "$KIT" == /mnt/* ]]; then
  aviso "El sistema está en una carpeta de Windows ($KIT): funciona, pero MUY lento."
  aviso "Muévelo a tu carpeta de Linux:  mv \"$KIT\" ~/  y vuelve a correr el instalador desde ahí."
fi

paso "1/9 Programas del sistema"
falta=()
for c in ffmpeg node npm git gh zsh fc-match; do command -v $c >/dev/null || falta+=("$c"); done
v=$(ffmpeg -version 2>/dev/null | head -1 | sed -E 's/^ffmpeg version n?([0-9]+).*/\1/'); [[ "$v" =~ ^[0-9]+$ ]] && (( v >= 7 )) || falta+=("ffmpeg-7")
python3 -c "import venv, ensurepip" 2>/dev/null || falta+=("python3-venv")
[[ -x /usr/bin/google-chrome || -x /usr/bin/chromium || -x /usr/local/bin/chromium ]] || falta+=("chrome")
fc-list 2>/dev/null | grep -qi "Nimbus Sans" || falta+=("fuentes")
ldconfig -p 2>/dev/null | grep -q "libEGL.so.1" || falta+=("libegl (para MediaPipe)")
if [[ ${#falta[@]} -gt 0 ]]; then
  aviso "Faltan programas del sistema: ${falta[*]}"
  echo
  echo "   Pega esto en tu terminal de Ubuntu (te pide tu contraseña de Ubuntu; no se ve al escribirla):"
  echo
  printf "       \033[1msudo \"%s/instalar.sh\" --sistema\033[0m\n" "$KIT"
  echo
  echo "   y cuando termine, vuelve a correr:  ./instalar.sh"
  exit 1
fi
ok "ffmpeg · node $(node -v) · $(python3 --version) · gh · Chrome"

paso "2/9 Llavero (comando security, para llaves como la de Higgsfield)"
mkdir -p "$HOME/.local/bin"
if ! command -v security >/dev/null || [[ "$(command -v security)" == "$HOME/.local/bin/security" ]]; then
  install -m 755 plataforma/security "$HOME/.local/bin/security"
fi
for rc in "$HOME/.bashrc" "$HOME/.profile" "$HOME/.zshrc"; do
  [[ -f "$rc" || "$rc" != *zshrc ]] && ! grep -q 'HOME/.local/bin' "$rc" 2>/dev/null && echo 'export PATH="$HOME/.local/bin:$PATH"' >> "$rc"
done
export PATH="$HOME/.local/bin:$PATH"
ok "llaves en ~/.config/sistema-edicion/llaves (solo tu usuario puede leerlas)"

paso "3/9 Fuentes (Helvetica Neue → Nimbus Sans, emojis a color)"
mkdir -p "$HOME/.config/fontconfig/conf.d"
cat > "$HOME/.config/fontconfig/conf.d/60-sistema-edicion.conf" <<'EOF'
<?xml version="1.0"?>
<!DOCTYPE fontconfig SYSTEM "fonts.dtd">
<fontconfig>
  <!-- las plantillas se diseñaron con Helvetica Neue (Mac); en Linux la más parecida es Nimbus Sans -->
  <alias binding="same"><family>Helvetica Neue</family><prefer><family>Nimbus Sans</family></prefer></alias>
  <alias binding="same"><family>Helvetica</family><prefer><family>Nimbus Sans</family></prefer></alias>
  <alias binding="same"><family>Apple Color Emoji</family><prefer><family>Noto Color Emoji</family></prefer></alias>
  <alias binding="same"><family>SF Mono</family><prefer><family>DejaVu Sans Mono</family></prefer></alias>
  <alias binding="same"><family>Menlo</family><prefer><family>DejaVu Sans Mono</family></prefer></alias>
</fontconfig>
EOF
fc-cache -f >/dev/null 2>&1 || true
ok "Helvetica Neue → $(fc-match -f '%{family}' 'Helvetica Neue' | cut -d, -f1)"

paso "4/9 Entorno de Python (.venv) + Whisper local"
[[ -d .venv ]] || python3 -m venv .venv
.venv/bin/pip install -q --upgrade pip
.venv/bin/pip install -q -r requirements.txt
# mlx_whisper solo existe en Mac: en Windows/Linux se usa un módulo con la misma interfaz (plataforma/python)
SP=$(.venv/bin/python -c "import sysconfig; print(sysconfig.get_paths()['purelib'])")
echo "$KIT/plataforma/python" > "$SP/sistema-edicion-plataforma.pth"
.venv/bin/python -c "import mlx_whisper, faster_whisper, mediapipe, cv2; assert cv2.__version__.startswith('4.')" && ok "paquetes de Python listos"
echo "   bajando el modelo de Whisper (≈1.6 GB, solo la primera vez)…"
.venv/bin/python -c "from faster_whisper import WhisperModel as W; W('large-v3-turbo', device='cpu', compute_type='int8')" >/dev/null 2>&1 \
  && ok "modelo Whisper listo" || aviso "no se pudo bajar el modelo ahora; se baja solo la primera vez que transcribas"
echo "   bajando los modelos de visión (≈25 MB)…"
.venv/bin/python -c "import sys; sys.path.insert(0, 'plataforma'); import comun; [comun.modelo(n) for n in comun.URL]" 2>/dev/null \
  && ok "modelos de visión listos" || aviso "no se pudieron bajar ahora; se bajan solos la primera vez"

paso "5/9 Motor de render"
(cd motor && npm install --silent --no-audit --no-fund >/dev/null) && ok "motor (puppeteer)"

paso "6/9 Herramientas de visión (en Mac son Vision de Apple; aquí, plataforma/*.py)"
envolver() {   # envolver <destino> <script.py>: un comando con el mismo nombre que la herramienta de Mac
  mkdir -p "$(dirname "$1")"
  printf '#!/bin/sh\nexec "%s/.venv/bin/python" "%s/plataforma/%s" "$@"\n' "$KIT" "$KIT" "$2" > "$1"; chmod +x "$1"
}
envolver bin/segmentar segmentar.py;  envolver bin/sdr sdr.py;  envolver bin/recortar recortar.py
envolver revision/bin/fotogramas fotogramas.py;  envolver revision/bin/caras caras.py
[[ -e revision/.venv ]] || ln -s ../.venv revision/.venv
ok "bin/segmentar (máscara de persona) · bin/sdr (HDR → color normal) · revision/bin/fotogramas (revisión final)"

paso "7/9 Efectos de sonido (libres de derechos)"
.venv/bin/python audio/efectos_basicos.py >/dev/null && ok "estilo-cine/sfx (efectos libres)"

SK="${SKILLS_DIR:-$HOME/.claude/skills}"
paso "8/9 Skill de Claude Code ($SK)"
mkdir -p "$SK"
for s in skills/*/; do
  n=$(basename "$s"); rm -rf "$SK/$n"; cp -R "$s" "$SK/$n"
  printf '\n> Carpeta de la plantilla: `%s` (las rutas de esta skill son relativas a esa carpeta). Versión Windows (WSL) / Linux: ver CLAUDE.md › "En Windows".\n' "$KIT" >> "$SK/$n/SKILL.md"
  ok "skill $n"
done

paso "9/9 Tus datos (para los videos)"
if [[ ! -f config/kit.json && -t 0 ]]; then
  read -r -p "Tu nombre como sale en los videos: " nom; read -r -p "Tu usuario de Instagram (con @): " han
  mkdir -p config; cat > config/kit.json <<EOF
{ "nombre": "${nom:-Tu nombre}", "handle": "${han:-@tu_usuario}", "idioma": "es", "perfil_salida_por_defecto": "redes" }
EOF
  ok "config/kit.json"
elif [[ -f config/kit.json ]]; then ok "config/kit.json ya existe"
else aviso "falta config/kit.json: Claude, pregúntale a la persona su nombre y su @usuario y créalo (ver instalar.sh, paso 9)"; fi

printf "\n\033[32mListo.\033[0m Sigue con: ./verificar.sh\n"
[[ $EN_WSL == 1 ]] && echo "Tus videos de Windows están en /mnt/c/Users/<tu usuario>/ (por ejemplo /mnt/c/Users/Ana/Videos)."
true
