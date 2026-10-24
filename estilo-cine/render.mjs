// Render del estilo "cine": cine.json + voz → salida/cine_<modo>.mp4
// Uso: node estilo-cine/render.mjs proyectos/<nombre> [--perfil redes|4k] [--modo codigo|hf] [--stills 1.2,3.4] [--hasta 8] [--reanudar]
// Perfil (estilo-cine/perfiles.json): redes = 1080x1920; 4k = 2160x3840 por bloques, HEVC por hardware y prioridad baja.
// En 4K conviene revisar con --perfil redes (rápido) y dejar --perfil 4k solo para el render final.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import puppeteer from '../motor/node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CHROME = process.env.CHROME || ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Chromium.app/Contents/MacOS/Chromium', '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/local/bin/chromium'].find(f => fs.existsSync(f)) || 'google-chrome';  // Mac, Linux o Windows (WSL)
const args = process.argv.slice(2), proy = path.resolve(args[0] || '');
const opt = k => { const i = args.indexOf(k); return i > 0 ? args[i + 1] : null; };
const modo = opt('--modo') || 'codigo';
const cfg = JSON.parse(fs.readFileSync(path.join(proy, 'cine.json')));
const W = cfg.lienzo?.w || 1080, H = cfg.lienzo?.h || 1920, FPS = String(cfg.fps || 30), fps = eval(FPS);
const PERFILES = JSON.parse(fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'perfiles.json')));
// fuera de Mac no hay codificador por hardware de Apple (videotoolbox): se usa x264/x265
if (process.platform !== 'darwin') for (const p of Object.values(PERFILES)) {
  p.video = p.video.map(a => a === 'hevc_videotoolbox' ? 'libx265' : a === 'h264_videotoolbox' ? 'libx264' : a);
  const i = p.video.indexOf('-allow_sw'); if (i >= 0) p.video.splice(i, 2);
}
const nPerfil = opt('--perfil') || cfg.perfil || 'redes', PF = PERFILES[nPerfil];
if (!PF) { console.error(`✗ perfil "${nPerfil}" no existe (usa: ${Object.keys(PERFILES).join(', ')})`); process.exit(1); }
const ES = PF.escala;
if (PF.prioridad) try { os.setPriority(PF.prioridad); } catch {}
if (cfg.persona && ES > 1) {
  const d4 = path.join(proy, PF.cuadros), n4 = fs.existsSync(d4) ? fs.readdirSync(d4).filter(f => f.endsWith('.jpg')).length : 0;
  if (n4 < cfg.persona.n) { console.error(`✗ faltan los cuadros 4K (${PF.cuadros}: ${n4}/${cfg.persona.n}). Corre primero: python3 estilo-cine/prep4k.py ${path.relative(RAIZ, proy)}`); process.exit(1); }
}
console.log(`  perfil: ${PF.nombre} → ${W * ES}x${H * ES}`);
const voz = JSON.parse(fs.readFileSync(path.join(proy, 'voz/palabras.json')));
const norm = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9ñ]/g, '');
const limpio = s => s.replace(/[.,;:…]+$/u, '').replace(/^[¿¡]+/, '');

// ---- asignar cada palabra del guion visual a su palabra de la voz ----
let iw = 0;
const ESTILO = { '-': 'chico', '*': 'resalte', '~': 'contorno' };
const escenas = cfg.escenas.map(s => ({
  ...s,
  grupos: s.grupos.map(gp => ({
    y: gp.y, x: gp.x, lim: gp.lim, velo: !!gp.velo, detras: !!gp.detras, a0: voz[iw] ? voz[iw].a : 0,
    lineas: gp.lineas.map(l => {
      const estilo = ESTILO[l[0]] || 'grande', txt = ESTILO[l[0]] ? l.slice(1) : l;
      return {
        estilo, palabras: txt.split(/\s+/).map(tk => {
          // "palabra|como se muestra" cambia lo que se ve; "palabra|" la oculta
          const [oye, ve] = tk.includes('|') ? tk.split('|') : [tk, tk];
          const w = voz[iw++];
          if (!w || norm(w.t) !== norm(oye)) console.warn(`  ⚠ "${oye}" no coincide con la voz ("${w && w.t}")`);
          return { txt: limpio(ve).replace(/_/g, ' '), a: w.a, b: w.b };  // "un|a_tu" → se ve "a tu"
        }).filter(p => p.txt !== ''),
      };
    }).filter(l => l.palabras.length),  // un grupo puede quedar oculto entero (lo dibuja otra capa, p. ej. el anillo)
  })),
}));
if (iw !== voz.length) console.warn(`  ⚠ el guion visual usa ${iw} palabras y la voz tiene ${voz.length}`);
const dur = voz.at(-1).b + (cfg.cola ?? .8);
escenas.forEach((s, i) => {
  s.ini = s.inicio ?? (i === 0 ? 0 : s.grupos[0].a0);  // escena sin voz: "inicio" explícito
  s.grupos.forEach(gp => gp.ini = gp.a0);
});
escenas.forEach((s, i) => {
  s.fin = i < escenas.length - 1 ? escenas[i + 1].ini : dur;
  s.grupos.forEach((gp, j) => gp.fin = j < s.grupos.length - 1 ? s.grupos[j + 1].ini : s.fin);
});
const marca = k => { const v = (cfg.marcas || {})[k]; if (typeof v === 'number') return v; const w = voz.find(w => norm(w.t) === norm(v || '')); return w ? w.a + (k === 'tap' ? .12 : 0) : -9; };
const rel = `/${path.relative(RAIZ, proy)}`;
escenas.forEach(s => { if (s.clip) s.clip = { ...s.clip, dir: `${rel}/${s.clip.dir}` }; });
const EDIT = { modo, escenas, dur, fps, handle: cfg.handle, nombre: cfg.nombre, hfDir: `${rel}/hf`, marca: { impacto: marca('impacto'), tap: marca('tap') }, cortes: cfg.cortes || [],
  persona: cfg.persona ? { cuadros: `${rel}/${ES > 1 ? PF.cuadros : cfg.persona.cuadros}`, mascaras: `${rel}/${cfg.persona.mascaras}`, n: cfg.persona.n, fondo: cfg.persona.fondo || 'real', crudos: `${rel}/${cfg.persona.crudos || 'cuadros'}`,
    bajar: cfg.persona.bajar || 0, zoomAlt: cfg.persona.zoomAlt ?? 1.13, fondoImg: cfg.persona.fondoImg || null } : null,
  bio: cfg.bio || null, anillos: cfg.anillos || [], titular: cfg.titular || null, top5: cfg.top5 || null,
  logos: Object.fromEntries(Object.entries(cfg.logos || {}).map(([k, v]) => [k, `${rel}/${v}`])),
  imagenes: Object.fromEntries(Object.entries(cfg.imagenes || {}).map(([k, v]) => [k, `${rel}/${v}`])) };

// ---- servidor local (los módulos ES no cargan desde file://) ----
const TIPOS = { '.html': 'text/html', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.json': 'application/json' };
const srv = http.createServer((req, res) => {
  const f = path.join(RAIZ, decodeURIComponent(req.url.split('?')[0]));
  if (!f.startsWith(RAIZ) || !fs.existsSync(f)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': TIPOS[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res);
}).listen(0, '127.0.0.1');
await new Promise(r => srv.once('listening', r));
const base = `http://127.0.0.1:${srv.address().port}`;

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: [...(process.platform === 'linux' ? ['--no-sandbox'] : []), '--force-color-profile=srgb', '--hide-scrollbars', ...(process.platform === 'darwin' ? ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] : [])] });
const page = await browser.newPage();
page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') console.log('  [página]', m.text()); });
page.on('pageerror', e => console.log('  [página]', e.message));
await page.setViewport({ width: W, height: H, deviceScaleFactor: ES });
const abrir = async () => {  // (re)carga la página: en 4K se hace en cada bloque para soltar la memoria de imágenes y texturas
  await page.goto(`${base}/estilo-cine/cine.html?w=${W}&h=${H}&e=${ES}`);
  await page.waitForFunction(() => window.init);
  const faltan = await page.evaluate(e => window.init(e), EDIT);
  if (faltan.length) console.warn('  ⚠ imágenes que no cargaron:', faltan);
};
await abrir();
const cuadro = async (t, tipo = 'jpeg') => { await page.evaluate(t => window.render(t), t); return page.screenshot({ type: tipo, ...(tipo === 'jpeg' ? { quality: PF.jpeg, optimizeForSpeed: true } : {}) }); };
fs.mkdirSync(path.join(proy, 'salida'), { recursive: true });
const fin = async () => { await browser.close(); srv.close(); };

if (opt('--stills')) {
  for (const t of opt('--stills').split(',').map(Number)) {
    const f = path.join(proy, 'salida', `${modo}${ES > 1 ? '_' + nPerfil : ''}_${t.toFixed(2)}.png`); fs.writeFileSync(f, await cuadro(t, 'png')); console.log(f);
  }
  await fin(); process.exit(0);
}

// ---- audio: voz + música (con hueco antes del golpe) + efectos ----
const hasta = Math.min(dur, Number(opt('--hasta')) || dur), N = Math.ceil(hasta * fps);
const ff = ['-y', '-v', 'error', '-f', 'concat', '-safe', '0', '-i', '__LISTA__', '-i', path.join(proy, cfg.voz || 'voz/voz.mp3')];
// música opcional: sin archivo (p. ej. sin cuenta de Epidemic) se renderiza solo con voz y efectos
const m = { desde: 0, vol: .2, vol_drop: .2, ...(cfg.musica || {}) }, musicaOk = cfg.musica?.archivo && fs.existsSync(path.join(proy, cfg.musica.archivo));
if (cfg.musica?.archivo && !musicaOk) console.warn(`  ⚠ no está la música ${cfg.musica.archivo}: el video sale sin música (ver audio/LEEME.md)`);
if (musicaOk) ff.push('-ss', String(m.desde), '-i', path.join(proy, m.archivo)); else { ff.push('-f', 'lavfi', '-t', '1', '-i', 'anullsrc=r=48000:cl=stereo'); m.vol = m.vol_drop = 0; }
// efectos automáticos según la transición de cada escena
const SFX = path.join(RAIZ, 'estilo-cine/sfx'), AUTO = {
  whip: ['whoosh_rapido.mp3', .35, .45], glitch: ['glitch_corto.mp3', .25, .4], flash: ['whoosh_grave.mp3', .8, .5],
  zoom: ['whoosh_rapido.mp3', .35, .45], drop: ['boom.mp3', .5, .75], pan: ['whoosh_grave.mp3', .8, .45] };
// el efecto nunca empieza antes de que termine la última palabra de la escena anterior (no tapa la voz)
const finPrevio = t => Math.max(0, ...voz.filter(w => w.a < t - .02).map(w => w.b));
const auto = cfg.sfx_auto ? escenas.filter(s => s.trans && AUTO[s.trans]).map(s => {
  const [f, pico, vol] = AUTO[s.trans], en = Math.max(s.ini + (s.sfxDesfase || 0), finPrevio(s.ini) + pico + .02);
  return { f: path.join(SFX, f), en, pico, vol };
}) : [];
const fxTodos = [...auto, ...(cfg.sfx || []).map(s => ({ ...s, f: path.resolve(proy, s.f) }))].map(s => ({ ...s, ini: s.en - s.pico }));
const fx = fxTodos.filter(s => fs.existsSync(s.f)), faltaFx = [...new Set(fxTodos.filter(s => !fs.existsSync(s.f)).map(s => path.basename(s.f)))];
if (faltaFx.length) console.warn(`  ⚠ faltan efectos (${faltaFx.join(', ')}): se omiten. Corre: python3 audio/efectos_basicos.py`);
fx.forEach(s => ff.push('-i', s.f));
const D = hasta.toFixed(3), tDrop = m.drop ?? escenas.find(s => s.trans === 'drop')?.ini ?? 0;
const [s0, s1] = m.silencio || [-1, -1];
let fc = `[1:a]aresample=48000,aformat=channel_layouts=stereo,loudnorm=I=-16:TP=-2,apad,atrim=0:${D},asplit=2[v][vsc];`;
fc += `[2:a]aresample=48000,atrim=0:${D},asetpts=PTS-STARTPTS,volume='if(between(t,${s0},${s1}),0,if(lt(t,${tDrop}),${m.vol},${m.vol_drop}))${(m.bajar || []).map(([a, b, k]) => `*if(between(t,${a},${b}),${k},1)`).join('')}':eval=frame,afade=t=in:d=0.25,afade=t=out:st=${Math.max(0, hasta - 1.2).toFixed(2)}:d=1.2[m0];`;
const duck = { threshold: .03, ratio: 5, ...(m.ducking || {}) };  // cuánto se agacha la música cuando hablas
fc += `[m0][vsc]sidechaincompress=threshold=${duck.threshold}:ratio=${duck.ratio}:attack=10:release=300[m];`;
const mezcla = ['[v]', '[m]'];
fx.forEach((s, i) => {
  const k = i + 3, recorte = Math.max(0, -s.ini), ms = Math.round(Math.max(0, s.ini) * 1000);
  fc += `[${k}:a]aresample=48000,aformat=channel_layouts=stereo,atrim=start=${recorte.toFixed(3)},asetpts=PTS-STARTPTS,adelay=${ms}|${ms},volume=${s.vol}[s${i}];`;
  mezcla.push(`[s${i}]`);
});
fc += `${mezcla.join('')}amix=inputs=${mezcla.length}:normalize=0:duration=first,atrim=0:${D},loudnorm=I=-14:TP=-1[a]`;
const salida = cfg.salida && !opt('--hasta') ? path.resolve(proy, cfg.salida).replace(/(\.mp4)$/i, ES > 1 ? ` (${PF.nombre})$1` : '$1') : path.join(proy, 'salida', `cine_${modo}${ES > 1 ? '_' + nPerfil : ''}.mp4`);
// ---- video por bloques: cada bloque se codifica a su archivo (se puede reanudar si algo se cae) ----
fs.mkdirSync(path.dirname(salida), { recursive: true });   // "salida" relativa = relativa a la carpeta del proyecto
const dirB = path.join(proy, 'salida', `_bloques_${nPerfil}`); fs.mkdirSync(dirB, { recursive: true });
const tamB = PF.bloque || N, bloques = [];
for (let i0 = 0, k = 0; i0 < N; i0 += tamB, k++) bloques.push({ k, i0, i1: Math.min(N, i0 + tamB), f: path.join(dirB, `b${String(k).padStart(4, '0')}.mp4`) });
if (!opt('--reanudar')) for (const b of bloques) fs.rmSync(b.f, { force: true });
const t0 = Date.now();
for (const b of bloques) {
  if (fs.existsSync(b.f)) { console.log(`  bloque ${b.k + 1}/${bloques.length} ya estaba (reanudar)`); continue; }
  if (b.k > 0 && PF.bloque) await abrir();
  const tmpF = b.f.replace(/\.mp4$/, '.tmp.mp4');
  const enc = spawn('ffmpeg', ['-y', '-v', 'error', '-f', 'image2pipe', '-c:v', 'mjpeg', '-framerate', FPS, '-i', '-', ...PF.video, '-r', FPS, '-an', tmpF], { stdio: ['pipe', 'inherit', 'inherit'] });
  let err = null; enc.on('close', c => { if (c) err = c; });
  for (let i = b.i0; i < b.i1; i++) {
    const buf = await cuadro(i / fps);
    if (err) { console.error(`\n✗ ffmpeg terminó con error (${err})`); process.exit(1); }
    if (!enc.stdin.write(buf)) await new Promise(r => enc.stdin.once('drain', r));
    if (i % 30 === 0) process.stdout.write(`\r  cuadro ${i}/${N}  (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
  }
  enc.stdin.end();
  await new Promise(r => enc.on('close', r));
  if (err) { console.error(`\n✗ ffmpeg terminó con error (${err})`); process.exit(1); }
  fs.renameSync(tmpF, b.f);
}
await fin();
// ---- unir bloques (sin recodificar) + audio ----
const lista = path.join(dirB, 'lista.txt'); fs.writeFileSync(lista, bloques.map(b => `file '${b.f.replace(/'/g, "'\\''")}'`).join('\n'));
ff[ff.indexOf('__LISTA__')] = lista;
ff.push('-filter_complex', fc, '-map', '0:v', '-map', '[a]', '-t', D, '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-map_chapters', '-1', '-map_metadata', '-1', '-movflags', '+faststart', salida);
const mux = spawn('ffmpeg', ff, { stdio: ['ignore', 'inherit', 'inherit'] });
const cod = await new Promise(r => mux.on('close', r));
if (cod) { console.error(`\n✗ ffmpeg (unión) terminó con error (${cod})`); process.exit(1); }
fs.rmSync(dirB, { recursive: true, force: true });
console.log(`\n✓ ${salida}  (${PF.nombre}, ${hasta.toFixed(1)} s, ${N} cuadros, ${((Date.now() - t0) / 1000).toFixed(0)} s de render)`);
