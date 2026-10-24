# Plantilla Saúl Pro · edición de video con IA (gratis) · Windows

Edita tus reels con **Claude Code** en el estilo **Saúl Pro**: tú hablando con tu fondo real y un filtro de piel sutil, texto
palabra por palabra (chico + gigante, incluso detrás de tu cabeza), escenas animadas que ilustran lo que dices, textura de
película, música y efectos. Claude encuentra tus mejores tomas, te muestra un plan paso a paso, edita y revisa el video cuadro
por cuadro antes de entregártelo.

Ejemplo terminado: **"Video editado - C8252.mp4"** en la sección *Releases* de este repositorio.

## Requisitos
**Windows 10/11** con WSL (Ubuntu, gratis de Microsoft) · 16 GB de RAM recomendados · ~12 GB libres · un plan de Claude que
incluya **Claude Code** (Pro o Max). También funciona en Linux. (¿Tienes Mac? Pide la versión para Mac.)

## Instalación (Claude lo hace por ti)
Lo más fácil: sigue la **guía PDF para Windows**. En resumen:
1. Abre PowerShell como administrador y corre `wsl --install -d Ubuntu`; reinicia y abre **Ubuntu** (crea tu usuario y contraseña).
2. En Ubuntu instala Claude Code: `curl -fsSL https://claude.ai/install.sh | bash`, cierra, vuelve a abrir y escribe `claude`.
3. Arrastra la guía PDF a la ventana y escribe **"Instala la plantilla siguiendo este PDF"**. Claude descarga la plantilla en
   `~/plantilla-saul-pro`, te pide pegar un comando con tu contraseña de Ubuntu y al final renderiza un video de prueba.

## Cómo se usa
Abre Ubuntu, escribe `cd ~/plantilla-saul-pro && claude` y pídele: *"Edita este video con Saúl Pro: está en mi Escritorio, se llama video.mp4"*.
Te pregunta la música (una carpeta con tus canciones o un conector de música), la duración máxima y la palabra para tu CTA,
te enseña el plan y edita cuando le dices "sí".

## ¿Quieres más?
Esta es 1 de las **61 plantillas** del *Sistema de edición de video con IA* (Saúl Pro 3D, testimoniales, anuncios con retomas,
reacciones, original vs editado, Editor 1–50…). Escríbeme por Instagram **@soysaul_mtz**.

## Licencia
Gratis para uso personal y de tu negocio. No se puede revender ni volver a publicar como propio. Ver [LICENCIA.md](LICENCIA.md).
