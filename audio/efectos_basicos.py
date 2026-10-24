"""Genera efectos de sonido básicos (sintetizados con ffmpeg, libres de derechos) en estilo-cine/sfx/ con los mismos
nombres que usa el motor. Sirven para que todo funcione sin cuenta de Epidemic Sound; si después bajas los de Epidemic
(ver audio/LEEME.md) con el mismo nombre, simplemente los reemplazan.
Uso: python3 audio/efectos_basicos.py [--forzar]
"""
import os, subprocess, sys
D = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'estilo-cine', 'sfx')
os.makedirs(D, exist_ok=True)
EF = {  # nombre: (duración, expresión de onda o fuente lavfi, filtros)
 'whoosh_rapido': (0.5, 'anoisesrc=d=0.5:c=pink:a=0.6', 'bandpass=f=1800:w=1600,afade=t=in:d=0.25,afade=t=out:st=0.25:d=0.25,volume=1.6'),
 'whoosh_grave': (0.9, 'anoisesrc=d=0.9:c=brown:a=0.8', 'lowpass=f=900,afade=t=in:d=0.6,afade=t=out:st=0.6:d=0.3,volume=1.8'),
 'boom': (1.2, "aevalsrc='sin(2*PI*(55-25*t)*t)*exp(-3*t)':d=1.2", 'lowpass=f=300,volume=1.5'),
 'glitch_corto': (0.3, "aevalsrc='sin(2*PI*1200*t)*(mod(floor(t*60),2))':d=0.3", 'volume=0.5,afade=t=out:st=0.2:d=0.1'),
 'glitch_pulso': (0.9, "aevalsrc='sin(2*PI*220*t)*(mod(floor(t*24),2))*exp(-2*t)':d=0.9", 'volume=0.6'),
 'listo': (0.45, "aevalsrc='(sin(2*PI*880*t)*lt(t,0.15)+sin(2*PI*1320*t)*gte(t,0.15))*exp(-6*t)':d=0.45", 'volume=0.7'),
 'moneda': (0.8, "aevalsrc='sin(2*PI*2400*t)*exp(-5*t)+sin(2*PI*3200*t)*exp(-7*t)*0.5':d=0.8", 'volume=0.6'),
 'rec': (0.35, "aevalsrc='sin(2*PI*(900+800*t)*t)*exp(-4*t)':d=0.35", 'volume=0.6'),
 'riser': (2.2, "aevalsrc='sin(2*PI*(120+500*t*t)*t)*t/2.2':d=2.2", 'volume=0.5'),
 'tic': (0.12, "aevalsrc='sin(2*PI*1600*t)*exp(-40*t)':d=0.12", 'volume=0.8'),
 'teclear': (0.1, 'anoisesrc=d=0.1:c=white:a=0.5', 'highpass=f=2500,afade=t=out:st=0.02:d=0.08,volume=1.2'),
}
for n, (d, src, af) in EF.items():
    f = os.path.join(D, n + '.mp3')
    if os.path.exists(f) and '--forzar' not in sys.argv: continue
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-f', 'lavfi', '-i', src, '-af', af + ',aformat=channel_layouts=stereo', '-t', str(d), '-ar', '48000', f], check=True)
    print('✓', n)
print('Efectos básicos listos en', D)
