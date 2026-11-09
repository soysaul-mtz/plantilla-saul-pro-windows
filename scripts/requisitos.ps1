# Revisa, del lado de Windows, que exista Ubuntu dentro de Windows (WSL), que es donde corre la plantilla. No instala nada solo.
# Uso (PowerShell): powershell -ExecutionPolicy Bypass -File scripts\requisitos.ps1
$wsl = Get-Command wsl.exe -ErrorAction SilentlyContinue
if (-not $wsl) { Write-Host "X Falta WSL (Ubuntu dentro de Windows)`n    -> wsl --install -d Ubuntu   (en PowerShell como administrador; luego reinicia la compu y abre Ubuntu una vez para crear tu usuario)" -ForegroundColor Red; exit 1 }
$d = (wsl.exe -l -q) -replace "`0", "" | Where-Object { $_ -match "Ubuntu" }
if (-not $d) { Write-Host "X Falta Ubuntu en WSL`n    -> wsl --install -d Ubuntu   (luego abre Ubuntu una vez para crear tu usuario)" -ForegroundColor Red; exit 1 }
Write-Host "OK Ubuntu dentro de Windows: $($d | Select-Object -First 1)" -ForegroundColor Green
Write-Host "Sigue dentro de Ubuntu:  wsl -d Ubuntu -- bash -lc 'cd ~/proyectos/plantilla-saul-pro-windows && scripts/requisitos.sh'"
