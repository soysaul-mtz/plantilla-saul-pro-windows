// Estilo "cine": tipografía palabra por palabra + escenas 3D (o imágenes de Higgsfield animadas)
// + textura de película (grano, separación RGB, fallas, destellos). Todo depende solo de t (determinista).
import * as THREE from 'three';
import { SVGLoader } from './lib/SVGLoader.js';
import { RoundedBoxGeometry } from './lib/RoundedBoxGeometry.js';
import { RoomEnvironment } from './lib/RoomEnvironment.js';

const Q = new URLSearchParams(location.search), W = +Q.get('w') || 1080, H = +Q.get('h') || 1920, HORIZ = W > H;  // horizontal: pantalla 16:9 dentro de un marco
// ES = escala de salida (perfil): 1 = redes 1080, 2 = 4K. Todo se diseña en coordenadas de 1080 y se dibuja a W*ES × H*ES.
const ES = +Q.get('e') || 1;
let E, MODO;

// ---------- utilidades ----------
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const lerp = (a, b, k) => a + (b - a) * k;
const prog = (t, a, b) => clamp((t - a) / (b - a));
const eOut = k => 1 - Math.pow(1 - k, 3);
const eOut4 = k => 1 - Math.pow(1 - k, 4);
const eInOut = k => k < .5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
const eSine = k => -(Math.cos(Math.PI * k) - 1) / 2;
const bump = (d, w) => Math.exp(-(d * d) / (2 * w * w));
const hash = n => { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };
const FONT = '"Helvetica Neue", Helvetica, Arial, sans-serif';
// zona segura de Instagram Reels medida en un iPhone (ver zona_segura.json)
const ZS = HORIZ ? { arriba: 60, abajo: H - 60, derecha: W - 360, botonesDesde: H, lado: 100 } : { arriba: 270, abajo: 1530, derecha: 890, botonesDesde: 700, lado: 50 };
const TS = HORIZ ? .95 : 1;  // escala del texto


// En 4K los lienzos miden el doble pero se dibuja en coordenadas de 1080 (setTransform ES). El navegador NO escala con la
// transformación las sombras ni los filtros (blur, drop-shadow), así que se multiplican aquí; y los lienzos internos
// (c3 de Three.js, tmp) se dibujan a tamaño lógico para no duplicarse.
function escalar(ctx) {
  if (ES === 1) return;
  const P = CanvasRenderingContext2D.prototype;
  for (const k of ['shadowBlur', 'shadowOffsetX', 'shadowOffsetY']) {
    const d = Object.getOwnPropertyDescriptor(P, k);
    Object.defineProperty(ctx, k, { get() { return d.get.call(this) / ES; }, set(v) { d.set.call(this, v * ES); } });
  }
  const df = Object.getOwnPropertyDescriptor(P, 'filter');
  Object.defineProperty(ctx, 'filter', { get() { return df.get.call(this); }, set(v) { df.set.call(this, String(v).replace(/(-?[\d.]+)px/g, (m, n) => (n * ES) + 'px')); } });
  const st = P.setTransform;
  ctx.setTransform = function (a, b, c, d, e, f) { if (typeof a === 'number' && arguments.length === 6) return st.call(this, a * ES, b * ES, c * ES, d * ES, e * ES, f * ES); return st.apply(this, arguments); };
  const di = P.drawImage;
  ctx.drawImage = function (im, ...a) {
    if (im === c3 || im === tmp || im === c2) {
      if (a.length === 2) return di.call(this, im, a[0], a[1], W, H);
      if (a.length === 8) { a[0] *= ES; a[1] *= ES; a[2] *= ES; a[3] *= ES; }
    }
    return di.call(this, im, ...a);
  };
}

// ---------- lienzos ----------
const out = document.getElementById('out');
const c2 = document.createElement('canvas'); c2.width = W * ES; c2.height = H * ES;
const g = c2.getContext('2d');
const c3 = document.createElement('canvas'); c3.width = W; c3.height = H;
const tmp = document.createElement('canvas'); tmp.width = W * ES; tmp.height = H * ES;
const gt = tmp.getContext('2d');

const R3 = new THREE.WebGLRenderer({ canvas: c3, alpha: true, antialias: true, preserveDrawingBuffer: true });
R3.setPixelRatio(ES); R3.setSize(W, H, false);
R3.toneMapping = THREE.ACESFilmicToneMapping; R3.toneMappingExposure = 1.0;
R3.outputColorSpace = THREE.SRGBColorSpace;
R3.shadowMap.enabled = true; R3.shadowMap.type = THREE.PCFSoftShadowMap;
const ENV = new THREE.PMREMGenerator(R3).fromScene(new RoomEnvironment(), 0.04).texture;

// ---------- post (shader final) ----------
const R2 = new THREE.WebGLRenderer({ canvas: out, preserveDrawingBuffer: true });
R2.setPixelRatio(ES); R2.setSize(W, H, false); out.style.width = W + 'px'; out.style.height = H + 'px';
escalar(g); escalar(gt);
const tex2 = new THREE.CanvasTexture(c2);
tex2.minFilter = THREE.LinearFilter; tex2.generateMipmaps = false;
const U = {
  tex: { value: tex2 }, res: { value: new THREE.Vector2(W, H) }, time: { value: 0 },
  rgb: { value: 2 }, glitch: { value: 0 }, zoomBlur: { value: 0 }, dir: { value: new THREE.Vector2() },
  flash: { value: 0 }, grain: { value: .06 }, vig: { value: .4 }, dark: { value: 0 }, zoom: { value: 1.02 },
  pan: { value: new THREE.Vector2() }, leak: { value: 0 },
};
const postScene = new THREE.Scene(), postCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
postScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({
  uniforms: U, depthTest: false,
  vertexShader: `varying vec2 vUv; void main(){ vUv=uv; gl_Position=vec4(position.xy,0.,1.); }`,
  fragmentShader: `
    uniform sampler2D tex; uniform vec2 res, dir, pan; uniform float time, rgb, glitch, zoomBlur, flash, grain, vig, dark, zoom, leak;
    varying vec2 vUv;
    float h(float n){ return fract(sin(n*127.1+.3)*43758.5453); }
    float h2(vec2 p){ return fract(sin(dot(p,vec2(12.9898,78.233)))*43758.5453); }
    vec3 samp(vec2 uv){
      vec2 c = uv-.5;
      vec2 off = c*(rgb/res.y)*1.6 + vec2(rgb*.4/res.x, 0.);
      return vec3(texture2D(tex, uv+off).r, texture2D(tex, uv).g, texture2D(tex, uv-off).b);
    }
    void main(){
      vec2 uv = (vUv-.5)/zoom + .5 + pan;
      if(glitch > 0.){
        float fr = floor(time*30.);
        float row = floor(uv.y*26. + h(fr)*5.);
        if(h(row+fr*3.7) < glitch*.55) uv.x += (h(row*1.3+fr)-.5)*.22*glitch;
      }
      vec3 col = vec3(0.);
      if(zoomBlur > .001 || length(dir) > .5){
        for(int i=0;i<14;i++){ float k = float(i)/13.-.5; col += samp(uv + (uv-.5)*zoomBlur*.3*k + dir/res*k); }
        col /= 14.;
      } else col = samp(uv);
      vec2 q = vUv-.5;
      col *= 1. - vig*dot(q,q)*2.4;
      col += leak*vec3(1.,.55,.25)*smoothstep(.9,.0,length(vUv-vec2(.95,.15)))*.9;
      col += (h2(vUv*res + fract(time*7.13)*317.) - .5)*grain;
      col = mix(col, vec3(1.), flash);
      col *= 1. - dark;
      gl_FragColor = vec4(clamp(col,0.,1.),1.);
    }`,
})));

// ---------- recursos ----------
const IMG = {};
const loadImg = src => new Promise((ok, bad) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => bad(src); i.src = src; });
const texLoader = new THREE.TextureLoader();

function drawCover(img, zoom = 1, fx = .5, fy = .5, rot = 0, alpha = 1, ctx = g) {
  const s = Math.max(W / img.width, H / img.height) * zoom;
  ctx.save(); ctx.globalAlpha = alpha;
  ctx.translate(W / 2, H / 2); ctx.rotate(rot); ctx.scale(s, s);
  ctx.drawImage(img, -img.width * fx, -img.height * fy);
  ctx.restore();
}
function drawCoverRect(img, x, y, w, h, zoom = 1, fx = .5, fy = .5) {
  const s = Math.max(w / img.width, h / img.height) * zoom;
  g.save(); g.beginPath(); g.rect(x, y, w, h); g.clip();
  g.translate(x + w / 2, y + h / 2); g.scale(s, s);
  g.drawImage(img, -img.width * fx, -img.height * fy);
  g.restore();
}

// =====================================================================
// ESCENA LOGOS (Instagram, TikTok, YouTube)
// =====================================================================
const LG = { scene: new THREE.Scene(), cam: new THREE.PerspectiveCamera(32, W / H, .1, 100), items: [] };
LG.scene.environment = ENV;

function roundedSquare(s, r) {
  const sh = new THREE.Shape(), a = -s, b = s;
  sh.moveTo(a + r, a); sh.lineTo(b - r, a); sh.quadraticCurveTo(b, a, b, a + r);
  sh.lineTo(b, b - r); sh.quadraticCurveTo(b, b, b - r, b); sh.lineTo(a + r, b);
  sh.quadraticCurveTo(a, b, a, b - r); sh.lineTo(a, a + r); sh.quadraticCurveTo(a, a, a + r, a);
  return sh;
}
async function svgGeo(file, ancho, depth, bevel) {
  const txt = await (await fetch(file)).text();
  const shapes = new SVGLoader().parse(txt).paths.flatMap(p => SVGLoader.createShapes(p));
  const geo = new THREE.ExtrudeGeometry(shapes, { depth, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel * .8, bevelSegments: 5, curveSegments: 28 });
  const s = ancho / 24;
  geo.translate(-12, -12, 0); geo.scale(s, -s, -1); // voltear Y (y Z para conservar el sentido de las caras)
  geo.computeBoundingBox(); geo.computeVertexNormals();
  return geo;
}
const brillo = (color, extra = {}) => new THREE.MeshPhysicalMaterial({ color, roughness: .18, metalness: 0, clearcoat: 1, clearcoatRoughness: .08, envMapIntensity: 1.1, ...extra });

const MARCAS = {
  claude: { body: '#d97757', glyph: '#fff6ef', ancho: 1.3 },
  openai: { body: '#111111', glyph: '#ffffff', ancho: 1.3 },
  googlegemini: { body: '#f2f2f4', glyph: '#3d7bf5', ancho: 1.25, emi: .25 },
  anthropic: { body: '#191919', glyph: '#f0e6d8', ancho: 1.3 },
  google: { body: '#f6f6f7', glyph: '#4285f4', ancho: 1.25, emi: .2 },
};
async function buildLogoCodigo(nombre) {
  const grp = new THREE.Group();
  const bodyOpts = { depth: .42, bevelEnabled: true, bevelThickness: .14, bevelSize: .12, bevelSegments: 10, curveSegments: 40 };
  const front = .42 / 2 + .14;
  if (nombre === 'instagram') {
    const cv = document.createElement('canvas'); cv.width = cv.height = 512; const x = cv.getContext('2d');
    const gr = x.createRadialGradient(80, 560, 0, 80, 560, 720);
    [[0, '#fdf497'], [.08, '#fdf497'], [.42, '#fd5949'], [.62, '#d6249f'], [.95, '#285AEB']].forEach(([o, c]) => gr.addColorStop(o, c));
    x.fillStyle = gr; x.fillRect(0, 0, 512, 512);
    const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.repeat.set(.5, .5); t.offset.set(.5, .5);
    const body = new THREE.ExtrudeGeometry(roundedSquare(1, .48), bodyOpts); body.translate(0, 0, -.21);
    grp.add(new THREE.Mesh(body, [brillo('#ffffff', { map: t }), brillo('#c22f8a')]));
    const glyph = await svgGeo('logos/instagram.svg', 1.42, .08, .03);
    const m = new THREE.Mesh(glyph, brillo('#ffffff', { roughness: .25 })); m.position.z = front + .1; grp.add(m);
  } else if (nombre === 'tiktok') {
    const body = new THREE.ExtrudeGeometry(roundedSquare(1, .48), bodyOpts); body.translate(0, 0, -.21);
    grp.add(new THREE.Mesh(body, brillo('#0b0b0b', { roughness: .12 })));
    const glyph = await svgGeo('logos/tiktok.svg', 1.25, .07, .025);
    [['#25F4EE', -.045, .04, -.02], ['#FE2C55', .045, -.04, -.01], ['#ffffff', 0, 0, 0]].forEach(([c, dx, dy, dz]) => {
      const m = new THREE.Mesh(glyph, brillo(c, { roughness: .25, emissive: c, emissiveIntensity: c === '#ffffff' ? .05 : .35 }));
      m.position.set(dx, dy, front + .1 + dz); grp.add(m);
    });
  } else if (MARCAS[nombre]) {
    const mc = MARCAS[nombre];
    const body = new THREE.ExtrudeGeometry(roundedSquare(1, .48), bodyOpts); body.translate(0, 0, -.21);
    grp.add(new THREE.Mesh(body, brillo(mc.body, { roughness: .14 })));
    const glyph = await svgGeo(`logos/${nombre}.svg`, mc.ancho, .08, .03);
    const m = new THREE.Mesh(glyph, brillo(mc.glyph, { roughness: .25, emissive: mc.glyph, emissiveIntensity: mc.emi || .05 })); m.position.z = front + .1; grp.add(m);
  } else {
    const geo = await svgGeo('logos/youtube.svg', 2.3, .42, .13);
    const bb = geo.boundingBox; geo.translate(0, -(bb.max.y + bb.min.y) / 2, -(bb.max.z + bb.min.z) / 2);
    grp.add(new THREE.Mesh(geo, brillo('#ff1414', { roughness: .15 })));
    const s = 2.3 / 24, P = ([x, y]) => new THREE.Vector2((x - 12) * s, -(y - 12) * s);
    const tri = new THREE.Shape([[9.545, 15.568], [9.545, 8.432], [15.818, 12]].map(P));
    const tg = new THREE.ExtrudeGeometry(tri, { depth: .3, bevelEnabled: true, bevelThickness: .04, bevelSize: .03, bevelSegments: 4 });
    tg.translate(0, 0, -.2);
    grp.add(new THREE.Mesh(tg, brillo('#ffffff', { roughness: .3 })));
  }
  return grp;
}
function buildLogoImagen(img) {
  // imagen de Higgsfield sobre fondo negro: plano con mezcla aditiva (el negro desaparece)
  // recorte cuadrado al centro, con el punto negro bajado para que el fondo desaparezca del todo
  const cw = .78, side = Math.round(img.width * cw), cv = document.createElement('canvas'); cv.width = cv.height = side;
  const x = cv.getContext('2d'); x.drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, side, side);
  const d = x.getImageData(0, 0, side, side), p = d.data;
  for (let i = 0; i < p.length; i += 4) for (let c = 0; c < 3; c++) p[i + c] = Math.max(0, (p[i + c] - 18) * 255 / 237);
  x.putImageData(d, 0, 0);
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace;
  const mk = document.createElement('canvas'); mk.width = mk.height = 256; const y = mk.getContext('2d');
  const gr = y.createRadialGradient(128, 128, 70, 128, 128, 128); gr.addColorStop(0, '#fff'); gr.addColorStop(1, '#000');
  y.fillStyle = gr; y.fillRect(0, 0, 256, 256);
  const m = new THREE.Mesh(new THREE.PlaneGeometry(2.9, 2.9), new THREE.MeshBasicMaterial({ map: t, alphaMap: new THREE.CanvasTexture(mk), blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, toneMapped: false }));
  const grp = new THREE.Group(); grp.add(m); return grp;
}
function setupLogoLights() {
  const s = LG.scene;
  const key = new THREE.DirectionalLight('#ffffff', 2.2); key.position.set(-3, 4, 6); s.add(key);
  const p1 = new THREE.PointLight('#ff3d8b', 30, 12); p1.position.set(3, 1, -2); s.add(p1);
  const p2 = new THREE.PointLight('#3de1ff', 24, 12); p2.position.set(-3, -1.5, -1.5); s.add(p2);
  s.add(new THREE.AmbientLight('#ffffff', .25));
}
// ranuras: dónde queda cada logo según cuántos llegaron después
const SLOTS = [[0, 1.05, 0, .74], [-1.05, 2.7, -2.6, .6], [1.3, 3.75, -5.2, .5]];
function renderLogos(s, t) {
  const Tin = s.tins, items = s.items;
  LG.items.forEach(o => { o.visible = false; });
  items.forEach((o, i) => {
    const te = t - (Tin[i] - .08);
    o.visible = te > 0;
    if (!o.visible) return;
    const ent = eOut4(clamp(te / .6));
    const after = Tin.filter((x, j) => j > i && t > x - .08).length;
    const k = after === 0 ? 0 : eInOut(clamp((t - (Tin[i + after] - .08)) / .55));
    const A = SLOTS[Math.max(0, after - 1)], B = SLOTS[after];
    const slot = after === 0 ? SLOTS[0] : A.map((v, n) => lerp(v, B[n], k));
    const from = [i % 2 ? -2.4 : 2.4, -1.4, -9];
    o.position.set(lerp(from[0], slot[0], ent), lerp(from[1], slot[1], ent) + Math.sin(t * 1.3 + i) * .06, lerp(from[2], slot[2], ent));
    const spin = MODO === 'hf' ? .9 : Math.PI * 2.1;
    o.rotation.y = (1 - ent) * spin + Math.sin(t * .9 + i * 2) * (MODO === 'hf' ? .22 : .38);
    o.rotation.x = (1 - ent) * .5 + Math.sin(t * .7 + i) * .1;
    o.rotation.z = (1 - ent) * (i % 2 ? .4 : -.4) + Math.sin(t * .5 + i) * .04;
    o.scale.setScalar(slot[3] * lerp(.6, 1, ent));
    o.userData.foco = after === 0;
  });
  const lt0 = t - s.grupoIni;
  const c = LG.cam; c.position.set(Math.sin(t * .4) * .25, .5 + Math.sin(t * .3) * .12, 9.2 - lt0 * .25); c.lookAt(0, .8, -1);
  // halo y fondo
  const gr = g.createRadialGradient(W / 2, H * .42, 0, W / 2, H * .42, H * .55);
  gr.addColorStop(0, '#2a2a2e'); gr.addColorStop(.5, '#0d0d0f'); gr.addColorStop(1, '#030303');
  g.fillStyle = gr; g.fillRect(0, 0, W, H);
  // luz rasante del piso
  g.save(); g.globalCompositeOperation = 'screen'; g.filter = 'blur(18px)'; g.globalAlpha = .35;
  g.fillStyle = '#cfcfcf'; g.fillRect(-50, H * .845 + Math.sin(t) * 6, W + 100, 5); g.restore();
  // dos pasadas: fondo desenfocado y logo en foco nítido
  for (const foco of [false, true]) {
    items.forEach(o => { o.userData.vis = o.visible; if (o.visible) o.visible = o.userData.foco === foco; });
    R3.setClearColor(0, 0); R3.render(LG.scene, LG.cam);
    g.save(); if (!foco) { g.filter = 'blur(9px)'; g.globalAlpha = .7; }
    g.drawImage(c3, 0, 0); g.restore();
    items.forEach(o => { o.visible = o.userData.vis; });
  }
  if (s.notif !== false && s.logo) burbujaNotif(t);
  if (s.link) linkVolando(s, t);
}
function linkVolando(s, t) {
  const k = eOut(prog(t, s.link - .05, s.link + .35)); if (k <= 0) return;
  const tv = s.tins[0], v = eInOut(prog(t, tv - .05, tv + .45));
  if (v >= 1) return;
  const x = lerp((ZS.lado + ZS.derecha) / 2, W / 2, v), y = lerp(H * .52, H * .36, v), sc = lerp(.95, .05, v) * lerp(.7, 1, k);
  g.save(); g.translate(x, y); g.scale(sc, sc); g.globalAlpha = k * (1 - v * .3);
  g.filter = `blur(${((1 - k) * 10 + v * 6).toFixed(1)}px)`;
  g.shadowColor = 'rgba(255,255,255,.35)'; g.shadowBlur = 40;
  g.fillStyle = '#f4f4f4'; g.beginPath(); g.roundRect(-400, -62, 800, 124, 62); g.fill(); g.shadowColor = 'transparent';
  g.strokeStyle = '#222'; g.lineWidth = 7; g.lineCap = 'round';
  g.save(); g.translate(-322, 0); g.rotate(-Math.PI / 4);
  g.beginPath(); g.roundRect(-30, -13, 36, 26, 13); g.stroke(); g.beginPath(); g.roundRect(-6, -13, 36, 26, 13); g.stroke(); g.restore();
  g.fillStyle = '#1b1b1b'; g.font = `500 40px ${FONT}`; g.textBaseline = 'middle'; g.fillText('instagram.com/reel/DPx9…', -265, 2);
  const ok = eOut(prog(t, s.link + .25, s.link + .5));
  if (ok > 0) { g.globalAlpha = k * ok; g.fillStyle = '#e9e9e9'; g.font = `600 34px ${FONT}`; g.fillText('Copiado ✓', -110, -110); }
  g.restore();
  if (v > .85) { g.save(); g.globalCompositeOperation = 'screen'; const gr = g.createRadialGradient(W / 2, H * .36, 0, W / 2, H * .36, 500);
    gr.addColorStop(0, `rgba(255,170,120,${(1 - v) * 4})`); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gr; g.fillRect(0, 0, W, H); g.restore(); }
}
function burbujaNotif(t) {
  // globo rojo de notificaciones… en cero (nadie te ve)
  const k = eOut(prog(t, 2.95, 3.35)); if (k <= 0) return;
  const x = W * .66, y = H * .2 + Math.sin(t * 1.4) * 8, w = 300, h = 86;
  g.save(); g.globalAlpha = k * .92; g.translate(x, y); g.scale(lerp(.6, 1, k), lerp(.6, 1, k));
  g.filter = `blur(${(1 - k) * 8 + 1.2}px)`;
  g.fillStyle = '#e8262f'; g.beginPath(); g.roundRect(-w / 2, -h / 2, w, h, 22); g.fill();
  g.beginPath(); g.moveTo(-14, h / 2 - 1); g.lineTo(0, h / 2 + 22); g.lineTo(14, h / 2 - 1); g.fill();
  g.fillStyle = '#fff'; g.font = `700 40px ${FONT}`; g.textBaseline = 'middle';
  const ico = [(cx) => { g.beginPath(); g.moveTo(cx, 12); g.bezierCurveTo(cx - 30, -8, cx - 14, -26, cx, -12); g.bezierCurveTo(cx + 14, -26, cx + 30, -8, cx, 12); g.fill(); },
    (cx) => { g.beginPath(); g.arc(cx, -8, 9, 0, 7); g.fill(); g.beginPath(); g.ellipse(cx, 14, 16, 10, 0, Math.PI, 0); g.fill(); },
    (cx) => { g.beginPath(); g.roundRect(cx - 15, -14, 30, 22, 6); g.fill(); g.beginPath(); g.moveTo(cx - 8, 7); g.lineTo(cx - 12, 16); g.lineTo(cx + 2, 7); g.fill(); }];
  ico.forEach((f, i) => { const cx = -w / 2 + 40 + i * 92; f(cx); g.fillText('0', cx + 24, 2); });
  g.restore();
}

// =====================================================================
// ESCENA SILUETA (y nadie te ve)
// =====================================================================
function personaPath(cx, top, h) {
  const R = [[0, 22], [28, 26], [48, 42], [57, 70], [57, 100], [52, 124], [43, 146], [38, 162], [42, 180], [70, 192], [112, 204], [138, 222], [150, 256],
    [156, 310], [160, 380], [162, 450], [163, 520], [158, 570], [148, 590], [136, 586], [130, 560], [124, 600], [118, 640], [114, 700], [110, 800],
    [106, 900], [104, 950], [112, 975], [108, 992], [56, 994], [48, 976], [46, 950], [38, 820], [26, 690], [12, 650], [0, 645]];
  const pts = [...R, ...R.slice(1, -1).reverse().map(([x, y]) => [-x, y])];
  const s = h / 1000, P = pts.map(([x, y]) => [cx + x * s, top + y * s]);
  const p = new Path2D(), n = P.length;
  p.moveTo(...P[0]);
  for (let i = 0; i < n; i++) { // Catmull-Rom cerrado
    const p0 = P[(i - 1 + n) % n], p1 = P[i], p2 = P[(i + 1) % n], p3 = P[(i + 2) % n];
    p.bezierCurveTo(p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6, p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6, p2[0], p2[1]);
  }
  p.closePath();
  return { p, P };
}
function niebla(t, alpha, color = '200,200,200') {
  g.save(); g.globalCompositeOperation = 'screen';
  for (let i = 0; i < 9; i++) {
    const x = (hash(i) * 1.4 - .2) * W + Math.sin(t * .3 + i) * 80 + t * 30 * (hash(i + 9) - .5);
    const y = H * (.35 + hash(i + 3) * .55), r = 260 + hash(i + 5) * 320;
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, `rgba(${color},${alpha * (.25 + hash(i + 7) * .3)})`); gr.addColorStop(1, `rgba(${color},0)`);
    g.fillStyle = gr; g.fillRect(x - r, y - r, r * 2, r * 2);
  }
  g.restore();
}
function renderSilueta(s, t, lt) {
  const dur = s.fin - s.ini;
  const dis = eInOut(prog(lt, dur - .55, dur));  // se disuelve al final
  if (MODO === 'hf') {
    drawCover(IMG[s.hf], 1.06 + lt * .06, .5, .46, 0, 1 - dis * .85);
    niebla(t, .55);
  } else {
    g.fillStyle = '#040404'; g.fillRect(0, 0, W, H);
    const gr = g.createRadialGradient(W / 2, H * .43, 0, W / 2, H * .45, H * .5);
    gr.addColorStop(0, 'rgba(120,120,120,.55)'); gr.addColorStop(.4, 'rgba(40,40,40,.4)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr; g.fillRect(0, 0, W, H);
    // rayos de luz
    g.save(); g.globalCompositeOperation = 'screen'; g.filter = 'blur(30px)';
    for (let i = 0; i < 5; i++) { g.fillStyle = `rgba(255,255,255,${.05 + hash(i) * .05})`; g.fillRect(W * (.15 + i * .17) + Math.sin(t + i) * 20, H * .3 + i * 40, 60 + hash(i + 2) * 90, 26); }
    g.restore();
    niebla(t, .45);
    const h = H * .66, top = H * .19 + lt * 4;
    const { p, P } = personaPath(W / 2, top, h);
    const a = 1 - dis;
    g.save(); g.globalAlpha = a; g.fillStyle = '#060606'; g.fill(p);
    g.shadowColor = 'rgba(255,255,255,.9)'; g.shadowBlur = 28; g.strokeStyle = '#f2f2f2'; g.lineWidth = 3.2;
    g.stroke(p); g.shadowBlur = 0; g.lineWidth = 1.4; g.stroke(p); g.restore();
    // partículas que salen del contorno
    if (dis > 0) {
      g.save(); g.globalCompositeOperation = 'screen';
      for (let i = 0; i < 420; i++) {
        const k = i / 420 * (P.length - 1), j = Math.floor(k), f = k - j, q = P[Math.min(j + 1, P.length - 1)];
        const x0 = lerp(P[j][0], q[0], f), y0 = lerp(P[j][1], q[1], f);
        const d = clamp(dis * 1.3 - hash(i) * .3);
        const x = x0 + (hash(i + 1) - .5) * 260 * d + Math.sin(i + t * 3) * 10 * d, y = y0 - 220 * d * hash(i + 2) - 40 * d;
        g.fillStyle = `rgba(240,240,240,${(1 - d) * .9})`; g.fillRect(x, y, 2.4, 2.4);
      }
      g.restore();
    }
  }
}

// =====================================================================
// ESCENA OJO (No es el algoritmo)
// =====================================================================
const OJ = { scene: new THREE.Scene(), cam: new THREE.PerspectiveCamera(30, W / H, .1, 100) };
function buildOjo() {
  const cv = document.createElement('canvas'); cv.width = 2048; cv.height = 1024; const x = cv.getContext('2d');
  x.fillStyle = '#e4e1dc'; x.fillRect(0, 0, 2048, 1024);
  for (let i = 0; i < 70; i++) { // venas
    x.strokeStyle = `rgba(90,80,80,${.08 + hash(i) * .18})`; x.lineWidth = .8 + hash(i + 1) * 2.2;
    let px = (512 + 1024 * (hash(i + 2) > .5 ? 1 : -1) * (.25 + hash(i + 3) * .2) + 2048) % 2048, py = 120 + hash(i + 4) * 780;
    x.beginPath(); x.moveTo(px, py);
    for (let k = 0; k < 9; k++) { px += (512 - px) * .07 + (hash(i * 9 + k) - .5) * 60; py += (512 - py) * .05 + (hash(i * 7 + k) - .5) * 50; x.lineTo(px, py); }
    x.stroke();
  }
  const cx = 512, cy = 512, R = 205;
  const ir = x.createRadialGradient(cx, cy, 40, cx, cy, R);
  ir.addColorStop(0, '#2a2a2a'); ir.addColorStop(.35, '#7d7d7d'); ir.addColorStop(.75, '#5a5a5a'); ir.addColorStop(.93, '#2b2b2b'); ir.addColorStop(1, '#1a1a1a');
  x.fillStyle = ir; x.beginPath(); x.arc(cx, cy, R, 0, 7); x.fill();
  for (let i = 0; i < 520; i++) { // fibras del iris
    const a = hash(i) * Math.PI * 2, r0 = 70 + hash(i + 1) * 30, r1 = R * (.75 + hash(i + 2) * .23);
    x.strokeStyle = `rgba(${hash(i + 3) > .5 ? '230,230,230' : '20,20,20'},${.12 + hash(i + 4) * .25})`; x.lineWidth = .6 + hash(i + 5) * 1.6;
    x.beginPath(); x.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0);
    x.quadraticCurveTo(cx + Math.cos(a + .08) * (r0 + r1) / 2, cy + Math.sin(a + .08) * (r0 + r1) / 2, cx + Math.cos(a) * r1, cy + Math.sin(a) * r1); x.stroke();
  }
  x.fillStyle = '#050505'; x.beginPath(); x.arc(cx, cy, 78, 0, 7); x.fill();
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  const eye = new THREE.Mesh(new THREE.SphereGeometry(1, 128, 96),
    new THREE.MeshPhysicalMaterial({ map: t, roughness: .3, clearcoat: 1, clearcoatRoughness: .03, envMapIntensity: 1.3 }));
  OJ.eye = eye; OJ.scene.add(eye); OJ.scene.environment = ENV;
  const key = new THREE.DirectionalLight('#ffffff', 2.4); key.position.set(-4, 5, 5); OJ.scene.add(key);
  OJ.scene.add(new THREE.AmbientLight('#ffffff', .15));
}
const CARD = { x: 420, y: 880, w: 460, h: 600 };
function renderOjo(s, t, lt) {
  papel(t);
  lineasVerticales(t, lt);
  const k = eOut(clamp(lt / .5));
  const cx = CARD.x + CARD.w / 2, cy = CARD.y + CARD.h / 2;
  g.save(); g.translate(cx, cy + (1 - k) * 60); g.scale(lerp(.92, 1, k), lerp(.92, 1, k)); g.translate(-cx, -cy);
  g.shadowColor = 'rgba(0,0,0,.35)'; g.shadowBlur = 40; g.shadowOffsetY = 18;
  g.fillStyle = '#060606'; g.fillRect(CARD.x, CARD.y, CARD.w, CARD.h); g.shadowColor = 'transparent';
  if (MODO === 'hf') {
    drawCoverRect(IMG[s.hf], CARD.x, CARD.y, CARD.w, CARD.h, 1.35 + lt * .12, .5 + Math.sin(lt * 2.2) * .02, .52);
  } else {
    // mirada: izquierda, derecha, y se fija en la cámara en "algoritmo"
    const keys = [[0, -.5, .12], [.32, -.5, .12], [.42, .55, -.08], [.78, .55, -.08], [.9, .02, .02], [9, .02, .02]];
    const lk = lt % 1.9, i = Math.max(0, keys.findLastIndex(k => lk >= k[0])), A = keys[i], B = keys[Math.min(i + 1, keys.length - 1)];
    const q = eInOut(prog(lk, A[0], B[0]));
    const yaw = lerp(A[1], B[1], q), pit = lerp(A[2], B[2], q);
    OJ.eye.rotation.set(pit + Math.sin(t * 9) * .006, yaw + Math.sin(t * 7) * .008, 0);
    OJ.cam.position.set(0, 0, 15.5 - lt * .8); OJ.cam.lookAt(0, 0, 0);
    R3.setClearColor(0, 0); R3.render(OJ.scene, OJ.cam);
    g.save(); g.beginPath(); g.rect(CARD.x, CARD.y, CARD.w, CARD.h); g.clip();
    g.drawImage(c3, cx - W / 2, cy - H / 2); g.restore();
  }
  g.restore();
}

// =====================================================================
// ESCENA TELÉFONOS (igual que otros mil → lo distinto detiene el dedo)
// =====================================================================
const TF = { scene: new THREE.Scene(), cam: new THREE.PerspectiveCamera(40, W / H, .05, 300) };
function miniatura(w, h, dorado = false) {
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h; const x = cv.getContext('2d');
  x.fillStyle = '#1c1c1c'; x.fillRect(0, 0, w, h);
  const gr = x.createLinearGradient(0, h * .12, 0, h * .62);
  if (dorado) { gr.addColorStop(0, '#ffd36b'); gr.addColorStop(.6, '#f08a24'); gr.addColorStop(1, '#5a2a0a'); }
  else { gr.addColorStop(0, '#8a8a8a'); gr.addColorStop(1, '#3a3a3a'); }
  x.fillStyle = gr; x.fillRect(w * .06, h * .12, w * .88, h * .5);
  x.fillStyle = dorado ? 'rgba(40,20,0,.55)' : 'rgba(30,30,30,.6)';
  x.beginPath(); x.moveTo(w * .06, h * .62); x.lineTo(w * .35, h * .4); x.lineTo(w * .55, h * .52); x.lineTo(w * .75, h * .33); x.lineTo(w * .94, h * .5); x.lineTo(w * .94, h * .62); x.fill();
  x.fillStyle = 'rgba(255,255,255,.9)'; x.beginPath(); x.arc(w / 2, h * .37, w * .1, 0, 7); x.fill();
  x.fillStyle = dorado ? '#f08a24' : '#555'; x.beginPath(); x.moveTo(w * .47, h * .33); x.lineTo(w * .47, h * .41); x.lineTo(w * .55, h * .37); x.fill();
  x.fillStyle = '#4a4a4a'; [.7, .76, .82].forEach((y, i) => x.fillRect(w * .08, h * y, w * (.8 - i * .2), h * .025));
  x.fillStyle = '#333'; x.fillRect(w * .08, h * .05, w * .3, h * .02);
  return cv;
}
const FEED = { cv: document.createElement('canvas') };
function buildTelefonos() {
  const s = TF.scene; s.environment = ENV;
  const N = 41, SX = .84, SY = 1.52, C = Math.floor(N / 2);
  const body = new RoundedBoxGeometry(.64, 1.3, .07, 3, .07);
  const thumbTex = new THREE.CanvasTexture(miniatura(256, 540)); thumbTex.colorSpace = THREE.SRGBColorSpace;
  const bodies = new THREE.InstancedMesh(body, new THREE.MeshStandardMaterial({ color: '#191919', roughness: .35, metalness: .4, envMapIntensity: .6 }), N * N);
  const screenMat = new THREE.MeshBasicMaterial({ map: thumbTex, toneMapped: false });
  const screens = new THREE.InstancedMesh(new THREE.PlaneGeometry(.58, 1.22), screenMat, N * N);
  const m = new THREE.Matrix4(); let i = 0;
  for (let r = 0; r < N; r++) for (let c = 0; c < N; c++, i++) {
    const hero = r === C && c === C, sc = hero ? 0 : 1;
    const x = (c - C) * SX, y = (r - C) * SY;
    m.compose(new THREE.Vector3(x, y, .035), new THREE.Quaternion(), new THREE.Vector3(sc, sc, sc)); bodies.setMatrixAt(i, m);
    m.compose(new THREE.Vector3(x, y, .0712), new THREE.Quaternion(), new THREE.Vector3(sc, sc, sc)); screens.setMatrixAt(i, m);
  }
  bodies.castShadow = true; s.add(bodies, screens);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(80, 80), new THREE.ShadowMaterial({ opacity: .22 })); floor.receiveShadow = true; s.add(floor);
  const sun = new THREE.DirectionalLight('#ffffff', 1.6); sun.position.set(-6, 9, 14); sun.castShadow = true;
  sun.shadow.mapSize.set(4096, 4096); Object.assign(sun.shadow.camera, { left: -22, right: 22, top: 22, bottom: -22, near: 1, far: 60 }); sun.shadow.radius = 6;
  s.add(sun); const amb = new THREE.AmbientLight('#ffffff', .6); s.add(amb);
  // teléfono protagonista
  FEED.cv.width = 512; FEED.cv.height = 1076; FEED.x = FEED.cv.getContext('2d');
  FEED.tex = new THREE.CanvasTexture(FEED.cv); FEED.tex.colorSpace = THREE.SRGBColorSpace;
  const hero = new THREE.Group();
  hero.add(new THREE.Mesh(body, new THREE.MeshStandardMaterial({ color: '#141414', roughness: .3, metalness: .6 })));
  const hs = new THREE.Mesh(new THREE.PlaneGeometry(.58, 1.22), new THREE.MeshBasicMaterial({ map: FEED.tex, toneMapped: false })); hs.position.z = .0365; hero.add(hs);
  const halo = new THREE.Mesh(new THREE.PlaneGeometry(3, 4), new THREE.MeshBasicMaterial({ map: haloTex(), blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, toneMapped: false, opacity: 0 }));
  halo.position.z = -.02; hero.add(halo);
  hero.position.z = .035; s.add(hero);
  Object.assign(TF, { bodies, screens, screenMat, sun, amb, hero, halo, thumbs: [miniatura(512, 300), miniatura(512, 300, true)] });
}
function haloTex() {
  const cv = document.createElement('canvas'); cv.width = 256; cv.height = 340; const x = cv.getContext('2d');
  const gr = x.createRadialGradient(128, 170, 10, 128, 170, 170); gr.addColorStop(0, 'rgba(255,190,90,.9)'); gr.addColorStop(.35, 'rgba(255,150,40,.35)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
  x.fillStyle = gr; x.fillRect(0, 0, 256, 340); const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; return t;
}
function dibujaFeed(off, vel, tap) {
  const x = FEED.x, w = 512, h = 1076, P = 330, ORO = 9;
  x.fillStyle = '#0d0d0d'; x.fillRect(0, 0, w, h);
  x.save(); x.filter = vel > 1 ? `blur(${Math.min(14, vel * .6)}px)` : 'none';
  for (let i = 0; i < 16; i++) {
    const y = 70 + i * P - off; if (y < -P || y > h) continue;
    const oro = i === ORO;
    x.fillStyle = '#2a2a2a'; x.beginPath(); x.arc(40, y + 18, 14, 0, 7); x.fill(); x.fillRect(64, y + 10, 120, 12);
    x.drawImage(TF.thumbs[oro ? 1 : 0], 16, y + 40, w - 32, 220);
    if (oro) { x.strokeStyle = '#ffc24a'; x.lineWidth = 6; x.strokeRect(16, y + 40, w - 32, 220); }
    x.fillStyle = '#333'; x.fillRect(24, y + 274, 200, 10);
  }
  x.restore();
  x.fillStyle = '#0d0d0d'; x.fillRect(0, 0, w, 54); x.fillStyle = '#e6e6e6'; x.font = `700 26px ${FONT}`; x.fillText('Para ti', 20, 38);
  if (tap > 0 && tap < 1) { x.strokeStyle = `rgba(255,255,255,${1 - tap})`; x.lineWidth = 5; x.beginPath(); x.arc(w * .6, h * .5, 20 + tap * 140, 0, 7); x.stroke(); }
  FEED.tex.needsUpdate = true;
}
function renderTelefonos(s, t, lt) {
  const parte = s.parte || 0;
  if (MODO === 'hf') {
    if (parte === 0) { papel(t); lineasVerticales(t, lt); const k = eSine(clamp(lt / (s.fin - s.ini))); drawCover(IMG[s.hf], Math.pow(3.4, 1 - k), .5, .5, lerp(-.06, .03, k)); }
    else {
      const img = IMG[s.hf]; drawCover(img, 1.04 + lt * .05, .52, .48);
      const tap = prog(t, E.marca.tap, E.marca.tap + .5);
      g.save(); g.globalCompositeOperation = 'screen';
      const pul = .5 + .5 * Math.sin(lt * 6), gx = W * .47, gy = H * .48;
      const gr = g.createRadialGradient(gx, gy, 0, gx, gy, 520); gr.addColorStop(0, `rgba(255,180,60,${.25 + .2 * pul + (tap > 0 ? .3 * (1 - tap) : 0)})`); gr.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = gr; g.fillRect(0, 0, W, H);
      if (tap > 0 && tap < 1) { g.strokeStyle = `rgba(255,255,255,${1 - tap})`; g.lineWidth = 6; g.beginPath(); g.arc(W * .61, H * .44, 30 + tap * 260, 0, 7); g.stroke(); }
      g.restore();
    }
    return;
  }
  // ---- código ----
  const T6 = E.escenas.find(e => e.visual === 'telefonos' && !e.parte), t0 = T6.ini, tDrop = T6.fin;
  const a = t - t0;
  const c = TF.cam;
  let z, cx = 0, cy = 0, roll, look = [0, 0, 0];
  if (t < tDrop) {
    const res = s.resaltar, k = eSine(clamp(a / ((res || tDrop) - t0)));
    z = 2.05 * Math.pow(res ? 9 : 13, k); roll = lerp(-.12, .08, k); cx = Math.sin(a) * .05 * z * .05; cy = -.05 * z * .05;
    const hl = res ? eOut(prog(t, res, res + .7)) : 0;
    if (res && t > res) z = lerp(z, 5.2, eInOut(prog(t, res, res + 1.1)));
    c.position.set(cx, cy, z); c.up.set(Math.sin(roll), Math.cos(roll), 0); c.lookAt(cx * .9, cy * .9, 0);
    TF.screenMat.color.setScalar(1); TF.amb.intensity = .6; TF.sun.intensity = 1.6; TF.halo.material.opacity = 0;
    TF.hero.position.set(0, 0, .035 + hl * .9); TF.hero.rotation.set(hl * .1, Math.sin(t * .9) * .06 * hl, 0);
    TF.halo.material.opacity = hl * .8;
    dibujaFeedEstatico(hl > .05);
    papel(t); lineasVerticales(t, a);
  } else {
    const b = t - tDrop, k = eInOut(clamp(b / 1.25));
    g.fillStyle = '#030303'; g.fillRect(0, 0, W, H);
    TF.screenMat.color.setScalar(lerp(.55, .12, clamp(b / .4)));
    TF.amb.intensity = lerp(.25, .02, clamp(b / .3)); TF.sun.intensity = lerp(.5, .08, clamp(b / .3));
    const rise = eOut(clamp((b - .1) / 1.1));
    TF.hero.position.set(0, 0, .035 + rise * 1.4); TF.hero.rotation.set(rise * .12 + Math.sin(t * 1.3) * .03, Math.sin(t * .9) * .08, rise * -.05);
    TF.halo.material.opacity = clamp(b / .5) * (.75 + .15 * Math.sin(t * 5));
    const zEnd = 3.05 - clamp((b - 1.25) / 2) * .35;
    z = Math.exp(lerp(Math.log(26.6), Math.log(zEnd), k));
    c.position.set(0, lerp(0, -1.05, k), z); c.up.set(0, 1, 0); c.lookAt(0, 0, lerp(0, 1.4, k));
    // feed: corre rápido, frena y se detiene en el post dorado justo en "dedo"
    const tStop = E.marca.tap, s0 = tDrop + .35;
    const q = clamp((t - s0) / (tStop - s0)), fin = 9 * 330 - 330;
    const off = fin * eOut4(q), vel = (fin * (eOut4(clamp(q + .01)) - eOut4(q))) / (tStop - s0) / 100 * 30;
    const tap = prog(t, tStop, tStop + .45);
    dibujaFeed(off, q < 1 ? vel : 0, tap);
    if (tap > 0 && tap < 1) TF.hero.position.z -= Math.sin(tap * Math.PI) * .06;
  }
  R3.setClearColor(0, 0); R3.render(TF.scene, TF.cam);
  g.save(); if (t < tDrop) g.filter = `blur(${(lt < .15 ? 0 : 1.6 + clamp(a / 3) * 1.8).toFixed(1)}px)`; g.drawImage(c3, 0, 0); g.restore();
}
function dibujaFeedEstatico(oro) {
  const x = FEED.x; x.fillStyle = '#1c1c1c'; x.fillRect(0, 0, 512, 1076); x.drawImage(miniaturaGrande(oro), 0, 0); FEED.tex.needsUpdate = true;
}
const _mg = {}; const miniaturaGrande = oro => _mg[!!oro] || (_mg[!!oro] = miniatura(512, 1076, !!oro));

// =====================================================================
// ESCENA MONEDA (… vende)
// =====================================================================
const MN = { scene: new THREE.Scene(), cam: new THREE.PerspectiveCamera(30, W / H, .1, 100) };
function buildMoneda() {
  const s = MN.scene; s.environment = ENV;
  const cv = document.createElement('canvas'); cv.width = cv.height = 1024; const x = cv.getContext('2d');
  const bump = document.createElement('canvas'); bump.width = bump.height = 1024; const b = bump.getContext('2d');
  const gr = x.createRadialGradient(420, 380, 50, 512, 512, 520); gr.addColorStop(0, '#ffe7a3'); gr.addColorStop(.6, '#e0ac45'); gr.addColorStop(1, '#a8741f');
  x.fillStyle = gr; x.fillRect(0, 0, 1024, 1024);
  b.fillStyle = '#808080'; b.fillRect(0, 0, 1024, 1024);
  for (const [ctx, col] of [[x, 'rgba(120,80,10,.55)'], [b, '#ffffff']]) {
    ctx.strokeStyle = col; ctx.lineWidth = 14; ctx.beginPath(); ctx.arc(512, 512, 470, 0, 7); ctx.stroke();
    ctx.lineWidth = 6; ctx.beginPath(); ctx.arc(512, 512, 420, 0, 7); ctx.stroke();
    ctx.fillStyle = col; ctx.font = `700 560px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('$', 512, 540);
    for (let i = 0; i < 24; i++) { const a = i / 24 * Math.PI * 2; ctx.beginPath(); ctx.arc(512 + Math.cos(a) * 445, 512 + Math.sin(a) * 445, 8, 0, 7); ctx.fill(); }
  }
  const map = new THREE.CanvasTexture(cv); map.colorSpace = THREE.SRGBColorSpace;
  const bm = new THREE.CanvasTexture(bump);
  const face = new THREE.MeshStandardMaterial({ map, bumpMap: bm, bumpScale: 3, metalness: 1, roughness: .28, envMapIntensity: 1.4 });
  const ridges = document.createElement('canvas'); ridges.width = 1024; ridges.height = 8; const r = ridges.getContext('2d');
  for (let i = 0; i < 1024; i += 8) { r.fillStyle = '#fff'; r.fillRect(i, 0, 4, 8); r.fillStyle = '#000'; r.fillRect(i + 4, 0, 4, 8); }
  const rb = new THREE.CanvasTexture(ridges); rb.wrapS = THREE.RepeatWrapping; rb.repeat.set(2, 1);
  const side = new THREE.MeshStandardMaterial({ color: '#d9a443', bumpMap: rb, bumpScale: 2, metalness: 1, roughness: .32, envMapIntensity: 1.4 });
  const coin = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, .14, 160, 1), [side, face, face]);
  coin.rotation.x = Math.PI / 2;
  const pivot = new THREE.Group(); pivot.add(coin); pivot.position.y = 1; s.add(pivot);
  const spot = new THREE.SpotLight('#fff1d6', 160, 20, .5, .6, 1.2); spot.position.set(.5, 7, 3); spot.target = pivot; s.add(spot);
  s.add(new THREE.AmbientLight('#ffffff', .1));
  Object.assign(MN, { pivot, coin });
}
function renderMoneda(s, t, lt) {
  const tV = E.marca.impacto, dv = tV - s.ini;
  g.fillStyle = '#020202'; g.fillRect(0, 0, W, H);
  // haz de luz y polvo
  g.save(); g.globalCompositeOperation = 'screen'; g.filter = 'blur(26px)';
  const hz = g.createLinearGradient(0, 0, 0, H * .72); hz.addColorStop(0, 'rgba(255,214,140,.16)'); hz.addColorStop(1, 'rgba(255,214,140,.03)');
  g.fillStyle = hz; g.beginPath(); g.moveTo(W * .4, -20); g.lineTo(W * .6, -20); g.lineTo(W * .78, H * .74); g.lineTo(W * .22, H * .74); g.fill(); g.restore();
  g.save(); g.globalCompositeOperation = 'screen';
  for (let i = 0; i < 70; i++) { const x = W * (.25 + hash(i) * .5) + Math.sin(t * .6 + i) * 18, y = (H * hash(i + 1) * .75 + t * 25 * (.3 + hash(i + 2))) % (H * .75);
    g.fillStyle = `rgba(255,225,170,${.15 + hash(i + 3) * .35})`; g.beginPath(); g.arc(x, y, 1 + hash(i + 4) * 2, 0, 7); g.fill(); }
  g.restore();
  let floorY = H * .7;
  if (MODO === 'hf') {
    drawCover(IMG[s.hf], 1.0 + lt * .04 + (lt > dv ? eOut(clamp((lt - dv) / .4)) * .06 : 0), .5, .55);
  } else {
    // giro que frena hasta quedar de frente en "vende"
    let ang = 0; const w0 = 24, kd = 1.1;
    const tt = Math.min(lt, dv);
    ang = (w0 / kd) * (1 - Math.exp(-kd * tt)) + 1.2 * tt;
    const angV = (w0 / kd) * (1 - Math.exp(-kd * dv)) + 1.2 * dv, target = Math.ceil(angV / (Math.PI * 2)) * Math.PI * 2;
    if (lt > dv) ang = lerp(angV, target, eOut(clamp((lt - dv) / .22))) + Math.sin((lt - dv) * 1.5) * .12;
    MN.pivot.rotation.y = ang;
    MN.pivot.rotation.z = Math.sin(ang * .5) * .06 * clamp(1 - lt / dv);
    const push = lt > dv ? eOut(clamp((lt - dv) / .5)) : 0;
    MN.cam.position.set(Math.sin(t * .5) * .15, 1.05, 10 - lt * .45 - push * 1.4); MN.cam.lookAt(0, 1, 0);
    R3.setClearColor(0, 0); R3.render(MN.scene, MN.cam);
    const v = new THREE.Vector3(0, 0, 0).project(MN.cam); floorY = (1 - (v.y * .5 + .5)) * H;
    g.drawImage(c3, 0, 0);
    // reflejo en el piso
    g.save(); g.globalAlpha = .28; g.filter = 'blur(5px)';
    g.translate(0, floorY * 2); g.scale(1, -1); g.drawImage(c3, 0, floorY, W, H - floorY, 0, floorY, W, H - floorY); g.restore();
    const fade = g.createLinearGradient(0, floorY, 0, floorY + 420); fade.addColorStop(0, 'rgba(2,2,2,0)'); fade.addColorStop(1, 'rgba(2,2,2,1)');
    g.fillStyle = fade; g.fillRect(0, floorY, W, H - floorY);
  }
  // destello en "vende"
  const fl = prog(t, tV, tV + .6);
  if (fl > 0 && fl < 1) {
    g.save(); g.globalCompositeOperation = 'screen'; const cx = W / 2, cy = MODO === 'hf' ? H * .53 : H * .5;
    const gr = g.createRadialGradient(cx, cy, 0, cx, cy, 700); gr.addColorStop(0, `rgba(255,220,140,${(1 - fl) * .8})`); gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr; g.fillRect(0, 0, W, H);
    g.fillStyle = `rgba(255,240,200,${(1 - fl) * .9})`; g.fillRect(0, cy - 2, W, 4 * (1 - fl) + 1); g.restore();
  }
}

// =====================================================================
// CAPAS COMUNES
// =====================================================================
function papel(t) {
  const gr = g.createRadialGradient(W * .5, H * .45, 0, W * .5, H * .5, H * .7);
  gr.addColorStop(0, '#f1eee7'); gr.addColorStop(.6, '#e3dfd5'); gr.addColorStop(1, '#c9c4b8');
  g.fillStyle = gr; g.fillRect(0, 0, W, H);
}
function lineasVerticales(t, lt) {
  g.save();
  const k = eOut(clamp(lt / .4));
  g.fillStyle = '#1b1b1b'; g.fillRect(W * .81, 0, 6, H * .14 * k + 40);
  g.fillStyle = 'rgba(30,30,30,.55)'; g.fillRect(W * .07, H * (1 - .12 * k), 4, H * .2);
  g.translate(W * .055, H * .78); g.rotate(-Math.PI / 2); g.fillStyle = 'rgba(40,40,40,.65)'; g.font = `500 30px ${FONT}`;
  g.fillText(E.handle || '', 0, 0);
  g.restore();
}
function pelicula(t) {
  g.save();
  const wv = Math.sin(t * 11) * 3;
  g.fillStyle = 'rgba(0,0,0,.85)'; g.fillRect(0, 0, 58, H);
  g.translate(38, 0); g.rotate(-Math.PI / 2);
  g.font = `600 22px ${FONT}`; g.letterSpacing = '4px';
  for (let i = 0; i < 6; i++) {
    const y = -H + i * 380 + ((t * 30) % 380) + wv;
    g.fillStyle = '#d8cfc2'; g.fillText('KODAK  PORTRA 400', y, 0);
    g.fillStyle = '#e04b3a'; g.fillText(String(41 + i), y + 290, 0);
    g.fillStyle = '#d8cfc2'; g.fillText('▶', y + 340, 0);
  }
  g.restore();
  // borde derecho de cuadro claro (como el cuadro siguiente)
  const gr = g.createLinearGradient(W - 70, 0, W, 0); gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(1, 'rgba(235,235,235,.85)');
  g.fillStyle = gr; g.fillRect(W - 70, 0, 70, H);
}
function motas(t, tema) {
  const f = Math.floor(t * 30);
  g.save();
  for (let i = 0; i < 7; i++) {
    const r = hash(f * 13 + i); if (r > .6) continue;
    g.fillStyle = tema === 'claro' ? 'rgba(20,20,20,.55)' : 'rgba(230,230,230,.45)';
    g.beginPath(); g.arc(hash(f + i * 7) * W, hash(f * 3 + i) * H, .8 + hash(f + i) * 2.4, 0, 7); g.fill();
  }
  if (hash(f * 7) < .12) { // pelito
    g.strokeStyle = tema === 'claro' ? 'rgba(20,20,20,.45)' : 'rgba(230,230,230,.35)'; g.lineWidth = 1.2;
    const x = hash(f) * W, y = hash(f + 1) * H; g.beginPath(); g.moveTo(x, y); g.bezierCurveTo(x + 20, y + 30, x - 10, y + 60, x + 8, y + 90); g.stroke();
  }
  g.restore();
}

// ---------- texto palabra por palabra ----------
const EST = {
  chico: { peso: 500, tam: 64, esp: -2 },
  grande: { peso: 700, tam: 178, esp: -8 },
  resalte: { peso: 700, tam: 112, esp: -4 },
  contorno: { peso: 300, tam: 300, esp: -10 },
};
function layout() {
  for (const s of E.escenas) for (const gp of s.grupos) {
    gp.estrecho = gp.y * H > ZS.botonesDesde - 120;
    const LIM = gp.lim ?? (gp.estrecho ? ZS.derecha - ZS.lado - 40 : 940);
    let y = 0, maxw = 0;
    for (const ln of gp.lineas) {
      const st = EST[ln.estilo];
      let tam = st.tam * TS;
      const mide = sz => { g.font = `${st.peso} ${sz}px ${FONT}`; g.letterSpacing = `${st.esp * sz / st.tam}px`; return g.measureText(ln.palabras.map(p => p.txt).join(' ')).width; };
      if (gp.detras && ln.estilo === 'grande') tam *= 1.2;
      let w = mide(tam); if (w > LIM) { tam *= LIM / w; w = mide(tam); }
      ln.tam = tam; ln.w = w; maxw = Math.max(maxw, w);
      y += tam * (ln.estilo === 'chico' ? 1.0 : .9); ln.base = y; y += tam * .1;
      let x = 0; g.font = `${st.peso} ${tam}px ${FONT}`; g.letterSpacing = `${st.esp * tam / st.tam}px`;
      const sp = g.measureText(' ').width;
      for (const p of ln.palabras) { p.x = x; p.w = g.measureText(p.txt).width; x += p.w + sp; }
    }
    gp.alto = y; gp.ancho = maxw;
  }
  g.letterSpacing = '0px';
}
function dibujaGrupo(gp, t, tema) {
  if (t < gp.ini - .1 || t > gp.fin + .02) return;
  const salida = clamp((t - (gp.fin - .16)) / .16), vida = t - gp.ini;
  const cx = gp.x != null ? gp.x * W : gp.estrecho ? (ZS.lado + ZS.derecha) / 2 : W / 2;
  const ox = Math.max(ZS.lado + 10, cx - gp.ancho / 2);
  const oy = clamp(H * gp.y - gp.alto / 2, ZS.arriba, ZS.abajo - gp.alto) - salida * 50;
  const zoom = 1 + vida * .022;
  g.save(); g.translate(cx, H * gp.y); g.scale(zoom, zoom); g.translate(-cx, -H * gp.y);
  const color = tema === 'claro' ? '#262626' : '#e9e9e9';
  if (gp.velo) {
    const a = clamp((t - gp.ini + .1) / .3) * (1 - salida), cy = oy + gp.alto / 2;
    g.save(); g.globalAlpha = a; g.filter = 'blur(40px)'; g.fillStyle = 'rgba(236,232,224,.88)';
    g.beginPath(); g.ellipse(W / 2, cy, gp.ancho * .62 + 60, gp.alto * .7 + 60, 0, 0, 7); g.fill(); g.restore();
  }
  for (const ln of gp.lineas) {
    const st = EST[ln.estilo];
    g.font = `${st.peso} ${ln.tam}px ${FONT}`; g.letterSpacing = `${st.esp * ln.tam / st.tam}px`; g.textBaseline = 'alphabetic';
    if (ln.estilo === 'resalte') { // marcatextos: una sola barra por línea, se dibuja de izquierda a derecha
      const kk = eOut(clamp((t - (ln.palabras[0].a - .05)) / .3));
      if (kk > 0) { g.save(); g.globalAlpha = 1 - salida; g.fillStyle = '#f3e300'; g.fillRect(ox - 16, oy + ln.base - ln.tam * .86, (ln.w + 32) * kk, ln.tam * 1.06); g.restore(); }
    }
    for (const p of ln.palabras) {
      const k = eOut(clamp((t - (p.a - .07)) / .22));
      if (k <= 0) continue;
      const a = k * (1 - salida), blur = (1 - k) * 16 + salida * 22 + (ln.estilo === 'chico' ? .4 : 0);
      const x = ox + p.x, y = oy + ln.base + (1 - k) * 42;
      g.save(); g.globalAlpha = a;
      for (let r = 3; r >= 0; r--) { // estela de movimiento
        if (r > 0 && k > .97) continue;
        g.globalAlpha = a * (r === 0 ? 1 : .18 * (1 - k));
        g.filter = `blur(${(blur + r * 3).toFixed(1)}px)`;
        if (ln.estilo === 'contorno') {
          g.strokeStyle = '#f0c35a'; g.lineWidth = 3; g.shadowColor = 'rgba(255,190,80,.8)'; g.shadowBlur = 24; g.strokeText(p.txt, x, y + r * 10);
        } else {
          g.fillStyle = ln.estilo === 'resalte' ? '#111' : color;
          if (gp.sombra) { g.shadowColor = tema === 'claro' ? 'rgba(236,232,224,.9)' : 'rgba(0,0,0,.85)'; g.shadowBlur = 34; }
          else if (tema !== 'claro') { g.shadowColor = 'rgba(255,255,255,.25)'; g.shadowBlur = 18; }
          g.fillText(p.txt, x, y + r * 10);
        }
      }
      g.restore();
    }
  }
  g.restore();
  g.letterSpacing = '0px';
}

// ---------- efectos de transición ----------
function efectos(t, tema) {
  const f = { rgb: 2.2, glitch: 0, zoomBlur: 0, dx: 0, dy: 0, flash: 0, dark: 0, zoom: 1.025 + Math.sin(t * .6) * .008, px: Math.sin(t * .37) * .003, py: Math.cos(t * .29) * .003, leak: 0 };
  f.grain = tema === 'claro' ? .055 : .075; f.vig = tema === 'claro' ? .55 : .45;
  for (const s of E.escenas) {
    if (!s.trans) continue;
    const d = t - s.ini;
    if (Math.abs(d) > .6) continue;
    const b1 = bump(d, .07), b2 = bump(d, .12);
    switch (s.trans) {
      case 'whip': f.dy += b1 * 140; f.rgb += b1 * 10; break;
      case 'glitch': if (Math.abs(d) < .16) { f.glitch = Math.max(f.glitch, 1 - Math.abs(d) / .16); f.rgb += 34 * (1 - Math.abs(d) / .16); } break;
      case 'flash': f.flash = Math.max(f.flash, d < 0 ? eInOut(prog(d, -.14, 0)) : 1 - eOut(prog(d, 0, .4))); f.zoomBlur += b2 * .6; f.leak = Math.max(f.leak, bump(d, .25)); break;
      case 'zoom': f.zoomBlur += b2 * 1.4; f.flash = Math.max(f.flash, b1 * .25); f.rgb += b1 * 12; break;
      case 'drop':
        if (d >= 0 && d < .07) f.dark = 1;
        if (Math.abs(d) < .2) { f.glitch = Math.max(f.glitch, .7 * (1 - Math.abs(d) / .2)); f.rgb += 40 * (1 - Math.abs(d) / .2); }
        if (d > .07 && d < .5) { const s2 = (1 - (d - .07) / .43) * .012; f.px += (hash(t * 97) - .5) * s2; f.py += (hash(t * 89) - .5) * s2; }
        break;
      case 'pan': f.dx += b1 * 220; f.rgb += b1 * 14; break;
    }
  }
  for (const c of E.cortes || []) {
    if (E.escenas.some(s => Math.abs(s.ini - c) < .25)) continue;
    const d = t - c; if (Math.abs(d) > .3) continue;
    f.zoomBlur += bump(d, .05) * .9; f.rgb += bump(d, .05) * 14;
  }
  for (const s of E.escenas) if (s.golpe != null) {
    const d = t - s.golpe; if (d > -.02 && d < .35) { const k = 1 - clamp(d / .35); f.glitch = Math.max(f.glitch, k * .6); f.rgb += k * 26; f.zoom += k * .06; }
  }
  for (const s of E.escenas) if (s.desintegrar) {
    const d = t - s.desintegrar; if (d > -.05 && d < .4) { const k = 1 - clamp(d / .4); f.glitch = Math.max(f.glitch, k * .8); f.rgb += k * 30; }
  }
  const di = t - E.marca.impacto;
  if (di > -.02 && di < .5) { const k = 1 - clamp(di / .45); f.flash = Math.max(f.flash, k * .55); f.rgb += k * 22; const s2 = k * .01; f.px += (hash(t * 71) - .5) * s2; f.py += (hash(t * 53) - .5) * s2; f.zoom += k * .04; }
  const dt = t - E.marca.tap;
  if (dt > 0 && dt < .3) { const k = 1 - dt / .3; f.rgb += k * 10; f.zoom += k * .02; }
  return f;
}


// =====================================================================
// PERSONA (video real recortado con la máscara de Vision)
// =====================================================================
const FR = new Map();
function cuadroImg(dir, n) {
  const k = dir + n;
  if (!FR.has(k)) FR.set(k, loadImg(`${dir}/${String(n).padStart(5, '0')}.jpg`));
  return FR.get(k);
}
async function personaCuadro(t) {
  const P = E.persona, n = Math.min(P.n, Math.max(1, Math.round(t * E.fps) + 1));
  const res = await Promise.all([cuadroImg(P.cuadros, n), cuadroImg(P.mascaras, n)]);
  for (const d of [1, 2]) if (n + d <= P.n) { cuadroImg(P.cuadros, n + d); cuadroImg(P.mascaras, n + d); }
  for (const k of [...FR.keys()]) { const m = +k.slice(-5) || +k.match(/(\d+)$/)[1]; if (m < n - 2) FR.delete(k); }
  return res;
}
const MK = document.createElement('canvas'), mk = MK.getContext('2d', { willReadFrequently: true });
function mascaraAlfa(img) { // la máscara viene en gris: el blanco pasa a ser opaco y el negro transparente
  if (MK.width !== img.width) { MK.width = img.width; MK.height = img.height; }
  mk.clearRect(0, 0, MK.width, MK.height); mk.drawImage(img, 0, 0);
  const d = mk.getImageData(0, 0, MK.width, MK.height), p = d.data;
  for (let i = 0; i < p.length; i += 4) { p[i + 3] = p[i]; p[i] = p[i + 1] = p[i + 2] = 255; }
  mk.putImageData(d, 0, 0); return MK;
}
function zoomCorte(t) {
  const cs = E.cortes, k = cs.filter(c => t >= c).length, desde = Math.max(k ? cs[k - 1] : 0, E._escena ? E._escena.ini : 0);
  return (k % 2 ? E.persona.zoomAlt : 1.0) * (1 + Math.min(.05, (t - desde) * .012));  // empuje lento desde el último corte o inicio de escena, con tope
}
async function renderPersona(s, t, lt) {
  if ((s.fondo || E.persona.fondo) === 'real') return renderPersonaReal(s, t, lt);
  if (s.tema === 'claro') { papel(t); lineasVerticales(t, lt); }
  else {
    const gr = g.createRadialGradient(W / 2, H * .38, 0, W / 2, H * .45, H * .6);
    gr.addColorStop(0, '#2b2b2e'); gr.addColorStop(.55, '#0c0c0d'); gr.addColorStop(1, '#030303');
    g.fillStyle = gr; g.fillRect(0, 0, W, H); niebla(t, .3);
  }
  if (s.ventanas) ventanas(s, t);
  for (const gp of s.grupos) if (gp.detras) dibujaGrupo(gp, t, s.tema);
  const [f, m] = await personaCuadro(t);
  gt.setTransform(1, 0, 0, 1, 0, 0); gt.globalCompositeOperation = 'source-over'; gt.clearRect(0, 0, W, H);
  gt.filter = 'blur(1.2px)'; gt.drawImage(mascaraAlfa(m), 0, 0, W, H); gt.filter = 'none';
  gt.globalCompositeOperation = 'source-in';
  gt.filter = s.tema === 'claro' ? 'saturate(.62) contrast(1.06) brightness(1.03)' : 'saturate(.5) contrast(1.15) brightness(.96)';
  gt.drawImage(f, 0, 0, W, H); gt.filter = 'none';
  gt.globalCompositeOperation = 'destination-out'; // se desvanece donde estaba la mesa
  const fd = gt.createLinearGradient(0, H * .8, 0, H * .95); fd.addColorStop(0, 'rgba(0,0,0,0)'); fd.addColorStop(1, 'rgba(0,0,0,1)');
  gt.fillStyle = fd; gt.fillRect(0, H * .8, W, H * .2);
  for (const [x0, x1] of [[0, W * .07], [W, W * .93]]) { const lg = gt.createLinearGradient(x0, 0, x1, 0); lg.addColorStop(0, 'rgba(0,0,0,1)'); lg.addColorStop(1, 'rgba(0,0,0,0)'); gt.fillStyle = lg; gt.fillRect(Math.min(x0, x1), 0, W * .07, H); }
  gt.globalCompositeOperation = 'source-over';
  // tamaño base (te deja aire arriba para el texto de atrás) + zoom alterno en cada corte, centrado en la cara
  const B = .8, by = H * .97, z = zoomCorte(t), ax = W * .5, ay = by - (by - H * .3) * B;
  g.save(); g.translate(ax, ay); g.scale(z, z); g.translate(-ax, -ay);
  g.translate(W / 2, by); g.scale(B, B); g.translate(-W / 2, -by);
  if (s.tema === 'claro') { g.shadowColor = 'rgba(0,0,0,.28)'; g.shadowBlur = 60; g.shadowOffsetY = 24; }
  else { g.shadowColor = 'rgba(255,255,255,.42)'; g.shadowBlur = 36; }
  g.drawImage(tmp, 0, 0); g.restore();
  if (s.cta) comentario(s, t);
}

// con fondo real (pared clara) el texto va oscuro con halo claro
const temaTexto = s => s.textoTema ? s.textoTema : s.visual === 'persona' && (s.fondo || (E.persona && E.persona.fondo)) === 'real' ? 'claro' : s.tema;
// Fondo real: se ve tu cuarto; el recorte solo sirve para meter el texto gigante entre el fondo y tú.
async function renderPersonaReal(s, t, lt) {
  const [f, m] = await personaCuadro(t);
  const emp = s.empuje ? 1 + s.empuje.z * eInOut(clamp((t - s.empuje.en) / (s.empuje.fin - s.empuje.en))) : 1;
  const baj = E.persona.bajar, z = (s.sinZoom ? 1 : zoomCorte(t)) * emp, ax = W * .5, ay = H * .3 + baj;  // "bajar": te recorre hacia abajo para dejar aire arriba (tarjeta fija)
  const cam = () => { g.translate(ax, ay); g.scale(z, z); g.translate(-ax, -ay); };
  const bn = s.bn != null ? clamp((t - s.bn) / .5) : 0, filtroBN = bn > 0 ? `grayscale(${bn.toFixed(2)}) contrast(${(1 + bn * .12).toFixed(2)})` : 'none';
  if (E.persona.fondoImg && IMG.fondoPersona) {  // fondo nuevo: estudio → textos/ventana detrás → tú recortado
    g.save(); cam(); const bi = IMG.fondoPersona, sc = Math.max(W / bi.width, H / bi.height) * (1.02 + Math.sin(t * .15) * .01);
    g.drawImage(bi, (W - bi.width * sc) / 2, (H - bi.height * sc) / 2, bi.width * sc, bi.height * sc); g.restore();
    for (const gp of s.grupos) if (gp.detras) dibujaGrupo(gp, t, 'oscuro');
    ventanaTop5(t, true);
    gt.setTransform(1, 0, 0, 1, 0, 0); gt.globalCompositeOperation = 'source-over'; gt.clearRect(0, 0, W, H);
    gt.drawImage(mascaraAlfa(m), 0, baj, W, H); gt.globalCompositeOperation = 'source-in'; gt.drawImage(f, 0, baj, W, H); gt.globalCompositeOperation = 'source-over';
    g.save(); cam(); g.filter = filtroBN; g.drawImage(tmp, 0, 0); g.restore();
    if (s.cta) comentario(s, t); if (s.dm) mensajeDirecto(s, t);
    return;
  }
  g.save(); cam(); g.filter = filtroBN;
  if (baj) { g.save(); g.filter = 'blur(30px)'; g.drawImage(f, 0, 0, W, H * .2, -40, -60, W + 80, baj + 140); g.restore(); }  // relleno del hueco de arriba
  g.drawImage(f, 0, baj, W, H); g.restore();
  if (s.fondos || s.clones) capasPersona(s, t, f, m, cam);
  if (s.antesDespues) { // la toma cruda de un lado, la editada del otro
    const crudo = await cuadroImg(E.persona.crudos, Math.min(E.persona.n, Math.max(1, Math.round(t * E.fps) + 1)));
    const xd = lerp(W * .92, W * .5, eInOut(clamp(lt / 1.4)));
    g.save(); g.beginPath(); g.rect(0, 0, xd, H); g.clip(); cam(); g.filter = 'saturate(.85) contrast(.92) brightness(.97)'; g.drawImage(crudo, 0, 0, W, H); g.restore();
    g.fillStyle = '#ffffff'; g.fillRect(xd - 3, 0, 6, H);
    g.save(); g.shadowColor = 'rgba(0,0,0,.4)'; g.shadowBlur = 20; g.fillStyle = '#fff'; g.beginPath(); g.arc(xd, 900, 34, 0, 7); g.fill(); g.restore();
    g.fillStyle = '#111'; g.font = `700 30px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('⇆', xd, 902); g.textAlign = 'left';
    if (xd > 300) etiqueta('ANTES', Math.min(xd - 130, 260), ZS.arriba + 60, true);
    etiqueta('DESPUÉS', Math.max(xd + 150, Math.min(ZS.derecha - 130, xd + 150)), ZS.arriba + 60, false);
  }
  if (s.ventanas) ventanas(s, t);
  const hayDetras = s.grupos.some(gp => gp.detras && t >= gp.ini - .1 && t <= gp.fin + .02), rej = !!top5Activa(t);
  const extra = (s.rejilla && t <= s.rejilla[1] + .5) || (s.lluvia && t >= s.lluvia.en && t <= s.lluvia.fin + .6);
  if (s.ventanas || hayDetras || rej || extra) {
    if (rej) rejillaTop5(t);
    if (s.rejilla) rejillaVentana(t, s.rejilla[0], s.rejilla[1]);
    if (s.lluvia) lluviaLogos(s, t);
    for (const gp of s.grupos) if (gp.detras) dibujaGrupo(gp, t, temaTexto(s));
    gt.setTransform(1, 0, 0, 1, 0, 0); gt.globalCompositeOperation = 'source-over'; gt.clearRect(0, 0, W, H);
    gt.filter = 'blur(1px)'; gt.drawImage(mascaraAlfa(m), 0, baj, W, H); gt.filter = 'none';
    gt.globalCompositeOperation = 'source-in'; gt.drawImage(f, 0, baj, W, H); gt.globalCompositeOperation = 'source-over';
    g.save(); cam(); g.filter = filtroBN; g.drawImage(tmp, 0, 0); g.restore();
  }
  if (s.cta) comentario(s, t);
  if (s.visor) visorCamara(t, lt);
  if (s.dm) mensajeDirecto(s, t);
}
const VENT = ['Instalando skill…', 'Error: falta dependencia', 'npm install editor-pro', '¿Permitir acceso al disco?', 'plugin_video_v2.3.pkg', 'Actualización requerida', 'Reinicia para continuar', 'Licencia expirada'];
function ventanas(s, t) {
  for (let i = 0; i < 9; i++) {
    const t0 = s.ini + i * .22 - .1, k = eOut(prog(t, t0, t0 + .3)); if (k <= 0) continue;
    const x = W * (.04 + hash(i + 11) * .55), y = H * (.06 + hash(i + 5) * .62) + Math.sin(t * .8 + i) * 10 - (t - t0) * 12;
    const w = 380 + hash(i + 3) * 160, h = 200 + hash(i + 8) * 70, prof = hash(i + 21);
    const gl = hash(Math.floor(t * 24) * 7 + i) < .06 ? (hash(i + t) - .5) * 60 : 0;
    g.save(); g.globalAlpha = k * (s.tema === 'claro' ? .9 : .78); g.translate(x + gl, y); g.scale(lerp(.85, 1, k), lerp(.85, 1, k));
    g.filter = `blur(${(1.5 + prof * 4 + (1 - k) * 10).toFixed(1)}px)`;
    g.fillStyle = '#e6e6e6'; g.beginPath(); g.roundRect(0, 0, w, h, 16); g.fill();
    g.fillStyle = '#cfcfcf'; g.beginPath(); g.roundRect(0, 0, w, 44, [16, 16, 0, 0]); g.fill();
    ['#ff5f57', '#febc2e', '#28c840'].forEach((c, j) => { g.fillStyle = c; g.beginPath(); g.arc(26 + j * 26, 22, 8, 0, 7); g.fill(); });
    g.fillStyle = '#222'; g.font = `600 30px ${FONT}`; g.textBaseline = 'middle'; g.fillText(VENT[i % VENT.length], 24, 92);
    if (i % 3 === 0) { g.fillStyle = '#bdbdbd'; g.fillRect(24, 140, w - 48, 16); g.fillStyle = '#3d7bf5'; g.fillRect(24, 140, (w - 48) * ((t * .3 + hash(i)) % 1), 16); }
    else if (i % 3 === 1) { g.fillStyle = '#e8a31a'; g.beginPath(); g.moveTo(44, 130); g.lineTo(64, 166); g.lineTo(24, 166); g.fill(); g.fillStyle = '#555'; g.fillRect(84, 140, w * .5, 14); }
    else { g.fillStyle = '#9a9a9a'; g.fillRect(24, 132, w * .6, 12); g.fillRect(24, 156, w * .4, 12); }
    g.restore();
  }
}

const PROMPT = 'Analiza este video de Instagram y dime exactamente cómo está editado: ritmo de cortes, tipografía, transiciones, efectos, música y color. Guarda ese estilo como plantilla y, cuando te mande uno de mis videos, edítalo exactamente igual sin que tenga que instalar nada.';
function renderPrompt(s, t, lt) {
  papel(t); lineasVerticales(t, lt);
  const k = eOut(clamp(lt / .45)), dur = s.fin - s.ini;
  const x = ZS.lado + 10, w = ZS.derecha - ZS.lado - 20, y = 560 + (1 - k) * 120, h = 900;
  g.save(); g.globalAlpha = k;
  g.shadowColor = 'rgba(0,0,0,.35)'; g.shadowBlur = 60; g.shadowOffsetY = 26;
  g.fillStyle = '#121212'; g.beginPath(); g.roundRect(x, y, w, h, 34); g.fill(); g.shadowColor = 'transparent';
  g.fillStyle = '#d97757'; g.beginPath(); g.arc(x + 70, y + 72, 24, 0, 7); g.fill();
  g.fillStyle = '#f2f2f2'; g.font = `700 40px ${FONT}`; g.textBaseline = 'middle'; g.fillText('Claude', x + 112, y + 74);
  g.fillStyle = '#2a2a2a'; g.fillRect(x + 40, y + 128, w - 80, 2);
  const n = Math.floor(PROMPT.length * clamp((lt - .25) / (dur - .3)) ** .9), visibles = 78;
  g.font = `500 37px Menlo, monospace`; g.textBaseline = 'alphabetic';
  let linea = '', ly = y + 196, cuenta = 0;
  const pinta = (txt, yy, desde) => { // primeras letras nítidas, el resto borroso (el prompt completo se pide por DM)
    g.filter = desde >= visibles ? 'blur(7px)' : 'none'; g.fillStyle = '#ececec'; g.fillText(txt, x + 44, yy);
  };
  for (const pal of PROMPT.slice(0, n).split(' ')) {
    if (g.measureText(linea + pal).width > w - 88) { pinta(linea, ly, cuenta - linea.length); ly += 54; linea = ''; }
    linea += pal + ' '; cuenta += pal.length + 1;
  }
  pinta(linea, ly, cuenta - linea.length);
  g.filter = 'none';
  if (Math.floor(lt * 3) % 2 === 0) { g.fillStyle = '#d97757'; g.fillRect(x + 44 + g.measureText(linea).width, ly - 32, 18, 40); }
  const lk = eOut(prog(lt, dur * .55, dur * .55 + .3));
  if (lk > 0) { g.globalAlpha = k * lk; g.fillStyle = '#f3e300'; g.beginPath(); g.roundRect(x + w / 2 - 230, y + h - 110, 460, 76, 38); g.fill();
    g.fillStyle = '#111'; g.font = `700 36px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('🔒 Comenta VIDEO', x + w / 2, y + h - 71); g.textAlign = 'left'; }
  g.restore();
}

function comentario(s, t) {
  const c = s.cta, k = eOut(prog(t, c.en - .1, c.en + .35)); if (k <= 0) return;
  const h = 120, y = ZS.abajo - h / 2 - 20 + (1 - k) * 160, x = ZS.lado + 10, w = ZS.derecha - ZS.lado - 20;
  g.save(); g.globalAlpha = k;
  g.shadowColor = 'rgba(0,0,0,.3)'; g.shadowBlur = 40; g.shadowOffsetY = 14;
  g.fillStyle = '#ffffff'; g.beginPath(); g.roundRect(x, y - h / 2, w, h, 60); g.fill(); g.shadowColor = 'transparent';
  const av = g.createLinearGradient(x + 30, y - 34, x + 98, y + 34); av.addColorStop(0, '#feda75'); av.addColorStop(.5, '#d62976'); av.addColorStop(1, '#4f5bd5');
  g.fillStyle = av; g.beginPath(); g.arc(x + 64, y, 34, 0, 7); g.fill();
  const n = Math.floor(c.texto.length * clamp((t - c.en - .2) / .5));
  g.fillStyle = '#111'; g.font = `700 50px ${FONT}`; g.textBaseline = 'middle'; g.fillText(c.texto.slice(0, n) || 'Agrega un comentario…', x + 124, y + 2);
  if (!n) { g.fillStyle = '#9a9a9a'; g.fillText('Agrega un comentario…', x + 124, y + 2); }
  const env = eOut(prog(t, c.en + .8, c.en + 1.1));
  g.fillStyle = env > 0 ? '#0095f6' : '#9cc9f2'; g.font = `700 40px ${FONT}`; g.textAlign = 'right'; g.fillText('Publicar', x + w - 40, y + 2); g.textAlign = 'left';
  g.restore();
}

// =====================================================================
// CÁMARA EN TRIPIÉ ("todo el contenido que tú grabas")
// =====================================================================
const TP = { scene: new THREE.Scene(), cam: new THREE.PerspectiveCamera(30, W / H, .1, 100) };
function buildTripie() {
  const s = TP.scene; s.environment = ENV;
  const negro = new THREE.MeshPhysicalMaterial({ color: '#19191b', roughness: .42, metalness: .35, clearcoat: .5, clearcoatRoughness: .3, envMapIntensity: .8 });
  const goma = new THREE.MeshStandardMaterial({ color: '#0c0c0c', roughness: .85, envMapIntensity: .3 });
  const metal = new THREE.MeshStandardMaterial({ color: '#9a9aa0', roughness: .28, metalness: 1, envMapIntensity: 1.1 });
  const cam = new THREE.Group();
  cam.add(new THREE.Mesh(new RoundedBoxGeometry(1.5, 1.0, .85, 4, .1), negro));
  const grip = new THREE.Mesh(new RoundedBoxGeometry(.36, .96, .92, 4, .15), goma); grip.position.set(.72, -.02, .06); cam.add(grip);
  const joroba = new THREE.Mesh(new RoundedBoxGeometry(.62, .34, .62, 3, .09), negro); joroba.position.set(-.12, .6, 0); cam.add(joroba);
  const lente = new THREE.Group();
  [[.43, .43, .36, .2, negro], [.47, .47, .46, .6, goma], [.45, .43, .2, .93, negro]].forEach(([r1, r2, h, z, m]) => {
    const c = new THREE.Mesh(new THREE.CylinderGeometry(r1, r2, h, 64), m); c.rotation.x = Math.PI / 2; c.position.z = z; lente.add(c);
  });
  const vidrio = new THREE.Mesh(new THREE.CircleGeometry(.37, 64), new THREE.MeshPhysicalMaterial({ color: '#0b1222', roughness: .04, metalness: .3, clearcoat: 1, iridescence: .7, envMapIntensity: 2.2 }));
  vidrio.position.z = 1.035; lente.add(vidrio);
  lente.position.set(-.1, 0, .42); cam.add(lente);
  const rec = new THREE.Mesh(new THREE.SphereGeometry(.05, 24, 16), new THREE.MeshBasicMaterial({ color: '#ff2a2a', toneMapped: false })); rec.position.set(.42, .4, .43); cam.add(rec);
  const tri = new THREE.Group();
  const cab = new THREE.Mesh(new THREE.CylinderGeometry(.22, .28, .3, 32), negro); cab.position.y = -.66; tri.add(cab);
  const col = new THREE.Mesh(new THREE.CylinderGeometry(.07, .07, 1.2, 24), metal); col.position.y = -1.35; tri.add(col);
  const nudo = new THREE.Mesh(new THREE.CylinderGeometry(.21, .21, .2, 24), negro); nudo.position.y = -1.9; tri.add(nudo);
  for (let i = 0; i < 3; i++) {
    const a = i / 3 * Math.PI * 2 + .6, th = .42, L = 3.3;
    const pata = new THREE.Group();
    const tubo = new THREE.Mesh(new THREE.CylinderGeometry(.055, .035, L, 16), metal); tubo.position.y = -L / 2; pata.add(tubo);
    const pie = new THREE.Mesh(new THREE.SphereGeometry(.075, 16, 12), goma); pie.position.y = -L; pata.add(pie);
    pata.position.set(Math.cos(a) * .17, -1.9, Math.sin(a) * .17);
    pata.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), new THREE.Vector3(Math.cos(a) * Math.sin(th), -Math.cos(th), Math.sin(a) * Math.sin(th)));
    tri.add(pata);
  }
  const todo = new THREE.Group(); todo.add(cam, tri); s.add(todo);
  const key = new THREE.SpotLight('#fff4e6', 140, 30, .6, .7, 1.2); key.position.set(4, 7, 7); key.target = todo; s.add(key);
  const rim = new THREE.DirectionalLight('#9fc4ff', 2.2); rim.position.set(-5, 3, -6); s.add(rim);
  s.add(new THREE.AmbientLight('#ffffff', .12));
  Object.assign(TP, { todo, rec });
}
function renderTripie(s, t, lt) {
  const gr = g.createRadialGradient(W / 2, H * .36, 0, W / 2, H * .45, H * .62);
  gr.addColorStop(0, '#26262a'); gr.addColorStop(.6, '#0b0b0c'); gr.addColorStop(1, '#030303');
  g.fillStyle = gr; g.fillRect(0, 0, W, H);
  g.save(); g.globalCompositeOperation = 'screen'; g.filter = 'blur(30px)'; g.globalAlpha = .5;
  g.fillStyle = '#d8d8d8'; g.beginPath(); g.ellipse(W / 2, H * .72, 330, 34, 0, 0, 7); g.fill(); g.restore();
  const k = eOut4(clamp(lt / .6));
  TP.todo.rotation.y = lerp(-.9, -.15, k) + lt * .12;
  TP.todo.position.y = lerp(-1.2, 0, k);
  TP.rec.material.color.set(Math.floor(t * 2.6) % 2 ? '#3a0606' : '#ff2a2a');
  const c = TP.cam; c.position.set(Math.sin(.5 + lt * .1) * 16, -.6, Math.cos(.5 + lt * .1) * 16 - lt * .5); c.lookAt(0, -2.15, 0);
  R3.setClearColor(0, 0); R3.render(TP.scene, c); g.drawImage(c3, 0, 0);
  // visor de cámara: esquinas, REC y tiempo
  g.save(); g.strokeStyle = 'rgba(240,240,240,.85)'; g.lineWidth = 5;
  const m = 70, top = ZS.arriba + 10, bot = H * .7, L = 70;
  [[m, top, 1, 1], [W - m, top, -1, 1], [m, bot, 1, -1], [W - m, bot, -1, -1]].forEach(([x, y, sx, sy]) => { g.beginPath(); g.moveTo(x, y + L * sy); g.lineTo(x, y); g.lineTo(x + L * sx, y); g.stroke(); });
  g.font = `600 40px ${FONT}`; g.textBaseline = 'middle';
  if (Math.floor(t * 2.6) % 2 === 0) { g.fillStyle = '#ff2a2a'; g.beginPath(); g.arc(m + 34, top + 64, 14, 0, 7); g.fill(); }
  g.fillStyle = '#f0f0f0'; g.fillText('REC', m + 60, top + 66);
  const f = Math.floor(lt * 24), tc = `00:00:${String(Math.floor(lt) + 12).padStart(2, '0')}:${String(f % 24).padStart(2, '0')}`;
  g.font = `500 34px Menlo, monospace`; g.textAlign = 'right'; g.fillText(tc, W - m - 30, top + 66); g.textAlign = 'left';
  g.fillStyle = 'rgba(240,240,240,.8)'; g.font = `500 28px Menlo, monospace`; g.fillText('4K  23.98  ISO 800', m + 30, bot - 40);
  g.restore();
}

// =====================================================================
// LAPTOP ("puede quedar listo para publicar en menos de un día")
// =====================================================================
const LP = { scene: new THREE.Scene(), cam: new THREE.PerspectiveCamera(32, W / H, .1, 100), cv: document.createElement('canvas') };
function buildLaptop() {
  const s = LP.scene; s.environment = ENV;
  const alu = new THREE.MeshPhysicalMaterial({ color: '#c8cacf', metalness: 1, roughness: .3, envMapIntensity: 1.15 });
  const base = new THREE.Mesh(new RoundedBoxGeometry(3.4, .12, 2.3, 4, .05), alu); base.position.y = .06; base.castShadow = true; s.add(base);
  const kb = document.createElement('canvas'); kb.width = 1024; kb.height = 420; const x = kb.getContext('2d');
  x.fillStyle = '#9fa2a8'; x.fillRect(0, 0, 1024, 420);
  for (let r = 0; r < 5; r++) for (let c = 0; c < 14; c++) { x.fillStyle = '#1d1d1f'; x.beginPath(); x.roundRect(14 + c * 71.5, 14 + r * 80, 62, 70, 8); x.fill(); }
  const kt = new THREE.CanvasTexture(kb); kt.colorSpace = THREE.SRGBColorSpace;
  const teclado = new THREE.Mesh(new THREE.PlaneGeometry(3.0, 1.23), new THREE.MeshStandardMaterial({ map: kt, roughness: .6, metalness: .2 }));
  teclado.rotation.x = -Math.PI / 2; teclado.position.set(0, .121, -.32); s.add(teclado);
  const pad = new THREE.Mesh(new THREE.PlaneGeometry(1.2, .72), new THREE.MeshPhysicalMaterial({ color: '#b9bcc2', metalness: .6, roughness: .25 }));
  pad.rotation.x = -Math.PI / 2; pad.position.set(0, .1215, .66); s.add(pad);
  LP.cv.width = 1024; LP.cv.height = 640; LP.x = LP.cv.getContext('2d');
  LP.tex = new THREE.CanvasTexture(LP.cv); LP.tex.colorSpace = THREE.SRGBColorSpace;
  const tapa = new THREE.Group(); tapa.position.set(0, .12, -1.13); tapa.rotation.x = -.24;
  const caja = new THREE.Mesh(new RoundedBoxGeometry(3.4, 2.25, .07, 4, .03), alu); caja.position.y = 1.125; caja.castShadow = true; tapa.add(caja);
  const bisel = new THREE.Mesh(new THREE.PlaneGeometry(3.32, 2.17), new THREE.MeshBasicMaterial({ color: '#050505' })); bisel.position.set(0, 1.125, .0362); tapa.add(bisel);
  const pantalla = new THREE.Mesh(new THREE.PlaneGeometry(3.12, 1.95), new THREE.MeshBasicMaterial({ map: LP.tex, toneMapped: false })); pantalla.position.set(0, 1.15, .0365); tapa.add(pantalla);
  const marca = new THREE.Object3D(); marca.position.set(0, 2.25, 0); tapa.add(marca);
  s.add(tapa);
  const piso = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), new THREE.ShadowMaterial({ opacity: .25 })); piso.rotation.x = -Math.PI / 2; piso.receiveShadow = true; s.add(piso);
  const sol = new THREE.DirectionalLight('#ffffff', 1.8); sol.position.set(-4, 9, 6); sol.castShadow = true; sol.shadow.mapSize.set(2048, 2048);
  Object.assign(sol.shadow.camera, { left: -6, right: 6, top: 6, bottom: -6, near: 1, far: 30 }); sol.shadow.radius = 8; s.add(sol);
  s.add(new THREE.AmbientLight('#ffffff', .55));
  Object.assign(LP, { tapa, marca });
}
function pantallaExport(p) {
  const x = LP.x, w = 1024, h = 640;
  x.fillStyle = '#121214'; x.fillRect(0, 0, w, h);
  x.fillStyle = '#1e1e21'; x.fillRect(0, 0, w, 54);
  ['#ff5f57', '#febc2e', '#28c840'].forEach((c, i) => { x.fillStyle = c; x.beginPath(); x.arc(30 + i * 26, 27, 8, 0, 7); x.fill(); });
  x.fillStyle = '#bbb'; x.font = `600 24px ${FONT}`; x.fillText('Editor · reel_final.mp4', 120, 35);
  const gr = x.createLinearGradient(0, 90, 0, 380); gr.addColorStop(0, '#5a6270'); gr.addColorStop(1, '#2a2d33');
  x.fillStyle = gr; x.fillRect(332, 80, 360, 300);
  x.fillStyle = 'rgba(255,255,255,.85)'; x.beginPath(); x.arc(512, 230, 34, 0, 7); x.fill();
  x.fillStyle = '#3a3e46'; x.beginPath(); x.moveTo(500, 212); x.lineTo(500, 248); x.lineTo(530, 230); x.fill();
  const cols = ['#d97757', '#3d7bf5', '#22c55e', '#a855f7', '#f59e0b'];
  for (let i = 0; i < 7; i++) { x.fillStyle = cols[i % 5]; x.globalAlpha = .75; x.fillRect(40 + i * 136, 420, 128, 38); x.fillRect(40 + i * 136 + 30, 466, 90, 22); }
  x.globalAlpha = 1;
  x.fillStyle = '#2a2a2e'; x.beginPath(); x.roundRect(40, 540, w - 80, 30, 15); x.fill();
  x.fillStyle = p < 1 ? '#3d7bf5' : '#22c55e'; x.beginPath(); x.roundRect(40, 540, (w - 80) * Math.max(.03, p), 30, 15); x.fill();
  x.fillStyle = '#eee'; x.font = `600 26px ${FONT}`;
  x.fillText(p < 1 ? `Exportando video… ${Math.round(p * 100)}%` : '✓ Listo para publicar', 40, 610);
  LP.tex.needsUpdate = true;
}
function pantallaTimeline(p, t) {
  const x = LP.x, w = 1024, h = 640;
  x.fillStyle = '#121214'; x.fillRect(0, 0, w, h);
  x.fillStyle = '#1e1e21'; x.fillRect(0, 0, w, 54);
  ['#ff5f57', '#febc2e', '#28c840'].forEach((c, i) => { x.fillStyle = c; x.beginPath(); x.arc(30 + i * 26, 27, 8, 0, 7); x.fill(); });
  x.fillStyle = '#d97757'; x.beginPath(); x.roundRect(120, 14, 230, 28, 14); x.fill();
  x.fillStyle = '#fff'; x.font = `700 18px ${FONT}`; x.fillText('✦ Auto-edición con IA', 136, 34);
  const gr = x.createLinearGradient(0, 80, 0, 330); gr.addColorStop(0, '#6a7280'); gr.addColorStop(1, '#2a2d33');
  x.fillStyle = gr; x.fillRect(362, 74, 300, 260);
  x.fillStyle = '#f3e300'; x.font = `800 30px ${FONT}`; x.fillText('MAL', 470, 230);
  const cols = ['#d97757', '#3d7bf5', '#22c55e', '#a855f7', '#f59e0b', '#ec4899', '#14b8a6', '#ef4444'];
  for (let r = 0; r < 3; r++) { x.fillStyle = '#1b1b1e'; x.fillRect(30, 370 + r * 70, w - 60, 56); }
  for (let i = 0; i < 8; i++) { // clips que vuelan a su lugar
    const q = eOut4(clamp(p * 9 - i * .9)), r = i % 3, cw = 100 + (i * 37) % 60, cx = 40 + (i * 118) % 860;
    const yy = lerp(-120, 376 + r * 70, q), xx = lerp(cx + (i % 2 ? 300 : -300), cx, q);
    x.globalAlpha = clamp(q * 2); x.fillStyle = cols[i]; x.beginPath(); x.roundRect(xx, yy, cw, 44, 8); x.fill();
  }
  x.globalAlpha = 1; const ph = 40 + (w - 80) * ((t * .35) % 1);
  x.fillStyle = '#fff'; x.fillRect(ph, 360, 3, 220);
  LP.tex.needsUpdate = true;
}
function pildoraListo(x, y, n, k) {
  const s = .4 + .6 * (1 + 2.2 * Math.pow(k - 1, 3) + 1.2 * Math.pow(k - 1, 2)); // rebote suave
  g.save(); g.translate(x, y + (1 - k) * 40); g.scale(s, s); g.globalAlpha = clamp(k * 1.6);
  g.shadowColor = 'rgba(0,0,0,.3)'; g.shadowBlur = 30; g.shadowOffsetY = 10;
  g.fillStyle = '#ffffff'; g.beginPath(); g.roundRect(-150, -46, 300, 92, 46); g.fill(); g.shadowColor = 'transparent';
  g.fillStyle = '#22c55e'; g.beginPath(); g.arc(-102, 0, 28, 0, 7); g.fill();
  g.strokeStyle = '#fff'; g.lineWidth = 7; g.lineCap = 'round'; g.lineJoin = 'round';
  g.beginPath(); g.moveTo(-115, 1); g.lineTo(-105, 12); g.lineTo(-88, -10); g.stroke();
  g.fillStyle = '#151515'; g.font = `700 40px ${FONT}`; g.textBaseline = 'middle'; g.fillText(`Video ${n}`, -60, 2);
  g.restore();
}
// dibuja una imagen deformada sobre un cuadrilátero (malla de triángulos afines)
function cuadrilatero(src, q, n = 10) {
  const [a, b, c, d] = q, sw = src.width, sh = src.height;
  const P = (u, v) => [lerp(lerp(a[0], b[0], u), lerp(d[0], c[0], u), v), lerp(lerp(a[1], b[1], u), lerp(d[1], c[1], u), v)];
  const tri = (s0, s1, s2, d0, d1, d2) => {
    g.save(); g.beginPath(); g.moveTo(...d0); g.lineTo(...d1); g.lineTo(...d2); g.closePath(); g.clip();
    const [x0, y0] = s0, [x1, y1] = s1, [x2, y2] = s2, den = x0 * (y2 - y1) - x1 * y2 + x2 * y1 + (x1 - x2) * y0;
    const m11 = -(y0 * (d2[0] - d1[0]) - y1 * d2[0] + y2 * d1[0] + (y1 - y2) * d0[0]) / den, m12 = (y1 * d2[1] + y0 * (d1[1] - d2[1]) - y2 * d1[1] + (y2 - y1) * d0[1]) / den;
    const m21 = (x0 * (d2[0] - d1[0]) - x1 * d2[0] + x2 * d1[0] + (x1 - x2) * d0[0]) / den, m22 = -(x1 * d2[1] + x0 * (d1[1] - d2[1]) - x2 * d1[1] + (x2 - x1) * d0[1]) / den;
    const dx = (x0 * (y2 * d1[0] - y1 * d2[0]) + y0 * (x1 * d2[0] - x2 * d1[0]) + (x2 * y1 - x1 * y2) * d0[0]) / den;
    const dy = (x0 * (y2 * d1[1] - y1 * d2[1]) + y0 * (x1 * d2[1] - x2 * d1[1]) + (x2 * y1 - x1 * y2) * d0[1]) / den;
    g.transform(m11, m12, m21, m22, dx, dy); g.drawImage(src, 0, 0); g.restore();
  };
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    const u0 = i / n, u1 = (i + 1) / n, v0 = j / n, v1 = (j + 1) / n;
    const S = (u, v) => [u * sw, v * sh];
    tri(S(u0, v0), S(u1, v0), S(u1, v1), P(u0, v0), P(u1, v0), P(u1, v1));
    tri(S(u0, v0), S(u1, v1), S(u0, v1), P(u0, v0), P(u1, v1), P(u0, v1));
  }
}
function renderLaptopFoto(s, t, lt) {
  const img = IMG[s.img], checks = s.checks || [];
  const zoom = 1.0 + lt * .03, fx = .46, fy = .6, sc = Math.max(W / img.width, H / img.height) * zoom;
  const map = ([x, y]) => [W / 2 + (x - img.width * fx) * sc, H / 2 + (y - img.height * fy) * sc];
  drawCover(img, zoom, fx, fy);
  if (s.modoPantalla === 'timeline') pantallaTimeline(clamp((t - s.ini) / (s.fin - s.ini)), t);
  else pantallaExport(eInOut(clamp((t - s.ini - .2) / ((checks[0] || s.fin) - s.ini - .25))));
  const q = s.pantalla.map(map);
  cuadrilatero(LP.cv, q);
  // reflejo del vidrio de la foto encima de la animación
  g.save(); g.beginPath(); g.moveTo(...q[0]); q.slice(1).forEach(p => g.lineTo(...p)); g.closePath(); g.clip();
  g.globalCompositeOperation = 'screen'; g.globalAlpha = .55; drawCover(img, zoom, fx, fy); g.restore();
  const sy = Math.min(q[0][1], q[1][1]) - 95, cx = (q[0][0] + q[1][0]) / 2;
  checks.forEach((tc, i) => { const kk = clamp((t - tc + .04) / .3); if (kk > 0) pildoraListo(cx + (i - 1) * 320, sy, i + 1, kk); });
}
function renderLaptop(s, t, lt) {
  if (s.img && IMG[s.img]) return renderLaptopFoto(s, t, lt);
  papel(t); lineasVerticales(t, lt);
  const checks = s.checks || [], dur = s.fin - s.ini;
  const k = eOut4(clamp(lt / .55));
  LP.tapa.rotation.x = lerp(-1.45, -.24, eOut(clamp(lt / .7)));
  const c = LP.cam, a = .55 - lt * .05;
  c.position.set(Math.sin(a) * 13.2, lerp(8.8, 7.4, k) - lt * .1, Math.cos(a) * 13.2 - lt * .3); c.lookAt(0, 1.0, -.45);
  pantallaExport(eInOut(clamp((t - s.ini - .2) / ((checks[0] || s.fin) - s.ini - .25))));
  R3.setClearColor(0, 0); R3.render(LP.scene, c); g.drawImage(c3, 0, 0);
  const v = new THREE.Vector3(); LP.marca.getWorldPosition(v); v.project(c);
  const sy = (1 - (v.y * .5 + .5)) * H - 80;
  checks.forEach((tc, i) => { const kk = clamp((t - tc + .04) / .3); if (kk > 0) pildoraListo(W / 2 + (i - 1) * 320, sy, i + 1, kk); });
}

// =====================================================================
// PROGRAMAS CENSURADOS (iconos con el logo pixelado)
// =====================================================================
const CZ = { scene: new THREE.Scene(), cam: new THREE.PerspectiveCamera(32, W / H, .1, 100), iconos: [] };
const CZ_COL = [['#ff5a36', '#fff'], ['#3d7bf5', '#fff'], ['#22c55e', '#fff'], ['#a855f7', '#fff'], ['#f59e0b', '#1a1a1a'], ['#ec4899', '#fff'],
  ['#0ea5e9', '#fff'], ['#141414', '#e8e8e8'], ['#f1f1f3', '#3d7bf5'], ['#ef4444', '#fff'], ['#14b8a6', '#fff'], ['#6366f1', '#fff'], ['#fde047', '#111'], ['#262626', '#ff5a36']];
const CZ_POS = [[-1.55, 2.5, .4], [1.45, 2.85, -.6], [-.2, 3.6, -2.4], [1.9, 1.45, .8], [-2.1, 1.35, -1.2], [.55, 1.6, -3.5],
  [-1.7, -1.6, .6], [1.6, -1.9, -.3], [-.3, -2.9, .9], [2.3, -3.3, -2.2], [-2.4, -3.4, -2.6], [.9, -1.3, -4.5], [-.9, .1, -6.5], [1.2, .3, -7.5]];
function mosaico(base, acento, sem) {
  const cv = document.createElement('canvas'); cv.width = cv.height = 256; const x = cv.getContext('2d');
  const gr = x.createLinearGradient(0, 0, 256, 256); gr.addColorStop(0, base); gr.addColorStop(1, base);
  x.fillStyle = gr; x.fillRect(0, 0, 256, 256);
  x.fillStyle = 'rgba(255,255,255,.12)'; x.fillRect(0, 0, 256, 120);
  const n = 8, cs = 18, o = 128 - n * cs / 2;
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    const r = hash(sem * 97 + i * 13 + j * 7), d = Math.hypot(i - 3.5, j - 3.5);
    if (d > 3.9 || r < .3) continue;
    x.globalAlpha = .55 + hash(sem + i * 31 + j) * .45;
    x.fillStyle = r > .8 ? base : acento; x.fillRect(o + i * cs, o + j * cs, cs, cs);
  }
  x.globalAlpha = 1;
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.magFilter = THREE.NearestFilter; t.repeat.set(.5, .5); t.offset.set(.5, .5);
  return t;
}
function buildCensurados() {
  const s = CZ.scene; s.environment = ENV;
  const geo = new THREE.ExtrudeGeometry(roundedSquare(1, .46), { depth: .38, bevelEnabled: true, bevelThickness: .12, bevelSize: .1, bevelSegments: 8, curveSegments: 32 });
  geo.translate(0, 0, -.19);
  CZ_POS.forEach((p, i) => {
    const [base, acento] = CZ_COL[i % CZ_COL.length];
    const m = new THREE.Mesh(geo, [brillo('#ffffff', { map: mosaico(base, acento, i + 1) }), brillo(base)]);
    m.position.set(...p); m.scale.setScalar(.55); m.userData = { p, col: base };
    s.add(m); CZ.iconos.push(m);
  });
  const key = new THREE.DirectionalLight('#ffffff', 2.2); key.position.set(-3, 4, 6); s.add(key);
  const p1 = new THREE.PointLight('#7c5cff', 26, 14); p1.position.set(3, 2, -2); s.add(p1);
  const p2 = new THREE.PointLight('#22d3ee', 20, 14); p2.position.set(-3, -2, -1.5); s.add(p2);
  s.add(new THREE.AmbientLight('#ffffff', .2));
}
function renderCensurados(s, t, lt) {
  const gr = g.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, H * .62);
  gr.addColorStop(0, '#16161c'); gr.addColorStop(.6, '#09090b'); gr.addColorStop(1, '#020202');
  g.fillStyle = gr; g.fillRect(0, 0, W, H);
  g.save(); g.fillStyle = 'rgba(160,170,255,.10)'; // retícula de puntos (tecnológico)
  const off = (t * 18) % 60;
  for (let y = -60 + off; y < H; y += 60) for (let x = 30; x < W; x += 60) g.fillRect(x, y, 3, 3);
  g.restore();
  const tO = s.desintegrar ?? 1e9;
  const c = CZ.cam; c.position.set(Math.sin(t * .35) * .4, Math.cos(t * .3) * .25, 12.5 - lt * .35); c.lookAt(0, 0, -1);
  const proy = [];
  CZ.iconos.forEach((m, i) => {
    const [x, y, z] = m.userData.p;
    const ent = eOut4(clamp((lt - i * .06) / .5));
    const d = clamp((t - (tO + i * .025)) / .35);
    const sc = .55 * ent * (1 - eInOut(d));
    m.visible = sc > .005;
    m.position.set(x + Math.sin(t * .8 + i) * .12 + (d > 0 ? (hash(i + Math.floor(t * 24)) - .5) * .25 : 0), y + Math.cos(t * .7 + i * 2) * .14 - (1 - ent) * 1.5, z);
    m.rotation.set(Math.sin(t * .6 + i) * .25, (1 - ent) * 3 + Math.sin(t * .5 + i * 1.7) * .45, Math.sin(t * .4 + i) * .12);
    m.scale.setScalar(Math.max(sc, .0001));
    if (d > 0 && d < 1) { const v = m.position.clone().project(c); proy.push([(v.x * .5 + .5) * W, (1 - (v.y * .5 + .5)) * H, d, m.userData.col, i, z]); }
  });
  for (const lejos of [true, false]) {
    CZ.iconos.forEach(m => { m.userData.vis = m.visible; if (m.visible) m.visible = (m.userData.p[2] < -1.8) === lejos; });
    R3.setClearColor(0, 0); R3.render(CZ.scene, c);
    g.save(); if (lejos) { g.filter = 'blur(7px)'; g.globalAlpha = .75; } g.drawImage(c3, 0, 0); g.restore();
    CZ.iconos.forEach(m => { m.visible = m.userData.vis; });
  }
  // pixeles que salen volando al desintegrarse
  for (const [px, py, d, col, i, z] of proy) {
    const tam = 150 * (z > -1.8 ? 1 : .55);
    g.save(); g.globalAlpha = 1 - d;
    for (let k = 0; k < 40; k++) {
      const ang = hash(i * 50 + k) * Math.PI * 2, vel = 60 + hash(i * 70 + k) * 260;
      const x = px + (hash(i * 30 + k) - .5) * tam + Math.cos(ang) * vel * d, y = py + (hash(i * 40 + k) - .5) * tam + Math.sin(ang) * vel * d - 80 * d;
      g.fillStyle = k % 3 ? col : '#ffffff'; const q = 6 + hash(k) * 10; g.fillRect(x, y, q, q);
    }
    g.restore();
  }
  // banda oscura detrás del texto central para que se lea
  const bd = g.createLinearGradient(0, H * .36, 0, H * .64);
  bd.addColorStop(0, 'rgba(5,5,7,0)'); bd.addColorStop(.5, 'rgba(5,5,7,.55)'); bd.addColorStop(1, 'rgba(5,5,7,0)');
  g.fillStyle = bd; g.fillRect(0, H * .36, W, H * .28);
}

// =====================================================================
// HOJA DE GUION ESCRITA POR IA + sello ✗
// =====================================================================
const GUION_TXT = ['GANCHO: "¿Sabías que el 97 % de las personas…"', 'DESARROLLO: En este video te voy a enseñar', 'los 5 secretos que nadie te cuenta para', 'crecer en redes sociales de forma rápida.', 'Primero, debes entender que el algoritmo…', 'Segundo, la constancia es la clave del éxito…', 'Tercero, aporta valor a tu audiencia y…', 'CIERRE: Sígueme para más contenido como este 🚀'];
function renderGuion(s, t, lt) {
  papel(t); lineasVerticales(t, lt);
  const k = eOut(clamp(lt / .4)), dur = s.fin - s.ini;
  const x = ZS.lado + 40, w = ZS.derecha - ZS.lado - 80, y = 520 + (1 - k) * 140, h = 820;
  g.save(); g.globalAlpha = k; g.translate(W / 2, y + h / 2); g.rotate(-.025 + Math.sin(t) * .006); g.translate(-W / 2, -(y + h / 2));
  g.shadowColor = 'rgba(0,0,0,.25)'; g.shadowBlur = 50; g.shadowOffsetY = 20;
  g.fillStyle = '#fbfaf7'; g.beginPath(); g.roundRect(x, y, w, h, 18); g.fill(); g.shadowColor = 'transparent';
  g.fillStyle = '#ececec'; g.fillRect(x, y, w, 70);
  g.fillStyle = '#222'; g.font = `700 32px ${FONT}`; g.textBaseline = 'middle'; g.fillText('guion_reel_FINAL.docx', x + 30, y + 36);
  g.fillStyle = '#10a37f'; g.beginPath(); g.arc(x + w - 46, y + 36, 20, 0, 7); g.fill();
  g.fillStyle = '#fff'; g.font = `700 22px ${FONT}`; g.textAlign = 'center'; g.fillText('IA', x + w - 46, y + 37); g.textAlign = 'left';
  // texto que se escribe solo, muy rápido
  const total = GUION_TXT.join('\n'), n = Math.floor(total.length * clamp((lt - .2) / Math.max(.5, dur - .9)));
  g.fillStyle = '#2a2a2a'; g.font = `500 30px Menlo, monospace`; g.textBaseline = 'alphabetic';
  let c = 0, ly = y + 130;
  for (const linea of GUION_TXT) {
    const vis = linea.slice(0, Math.max(0, n - c)); c += linea.length + 1;
    if (vis) g.fillText(vis.length > 34 ? vis.slice(0, 34) + (vis.length > 34 ? '…' : '') : vis, x + 34, ly);
    ly += 80; if (c > n) break;
  }
  if (Math.floor(lt * 4) % 2 === 0) { g.fillStyle = '#10a37f'; g.fillRect(x + 34, ly - 108, 4, 40); }
  g.restore();
  // sello ✗ en la palabra clave
  if (s.sello) {
    const q = clamp((t - s.sello) / .22); if (q > 0) {
      const sc = lerp(2.4, 1, eOut4(q)), cx = (ZS.lado + ZS.derecha) / 2, cy = 930;
      g.save(); g.translate(cx, cy); g.rotate(-.18); g.scale(sc, sc); g.globalAlpha = clamp(q * 2) * .92;
      g.strokeStyle = '#e1251b'; g.lineWidth = 16; g.beginPath(); g.roundRect(-250, -150, 500, 300, 26); g.stroke();
      g.lineCap = 'round'; g.lineWidth = 34; g.beginPath(); g.moveTo(-110, -95); g.lineTo(110, 95); g.moveTo(110, -95); g.lineTo(-110, 95); g.stroke();
      g.restore();
    }
  }
}

// =====================================================================
// CLIP DE OTRA PERSONA (tarjeta + fondo desenfocado + credencial)
// =====================================================================
async function renderClip(s, t, lt) {
  const C = s.clip, n = Math.min(C.n, Math.max(1, Math.round(lt * E.fps) + 1));
  const f = await cuadroImg(C.dir, n);
  drawCover(f, 1.25 + lt * .02, .5, .45);
  g.save(); g.filter = 'blur(28px) brightness(.55) saturate(.8)'; g.globalCompositeOperation = 'source-over'; drawCover(f, 1.3, .5, .45); g.restore();
  const k = eOut4(clamp(lt / .45)), w = ZS.derecha - ZS.lado - 20, h = w * f.height / f.width, x = ZS.lado + 10, y = (C.centroY ?? 900) - h / 2 + (1 - k) * 80;
  g.save(); g.globalAlpha = k; g.translate(x + w / 2, y + h / 2); g.scale(lerp(.9, 1, k), lerp(.9, 1, k)); g.translate(-(x + w / 2), -(y + h / 2));
  g.shadowColor = 'rgba(0,0,0,.55)'; g.shadowBlur = 60; g.shadowOffsetY = 24;
  g.beginPath(); g.roundRect(x, y, w, h, 28); g.fillStyle = '#000'; g.fill(); g.shadowColor = 'transparent';
  g.clip(); g.drawImage(f, x, y, w, h); g.restore();
  // credencial
  const kc = eOut4(clamp((lt - .25) / .4)); if (kc > 0) {
    const cy = Math.min(ZS.abajo - 80, (C.centroY ?? 900) + h / 2 + 110), cx0 = ZS.lado + 10;
    g.save(); g.globalAlpha = kc; g.translate(-(1 - kc) * 120, 0);
    g.fillStyle = 'rgba(12,12,14,.82)'; g.beginPath(); g.roundRect(cx0, cy - 70, 700, 140, 26); g.fill();
    g.fillStyle = '#ffffff'; g.font = `700 46px ${FONT}`; g.textBaseline = 'middle'; g.fillText(C.nombre, cx0 + 120, cy - 24);
    g.fillStyle = '#d9d9d9'; g.font = `500 30px ${FONT}`; g.fillText(C.cargo, cx0 + 120, cy + 22);
    g.fillStyle = '#9a9a9a'; g.font = `500 22px ${FONT}`; g.fillText(C.fuente, cx0 + 120, cy + 54);
    const gx = cx0 + 62; ['#4285F4', '#EA4335', '#FBBC05', '#34A853'].forEach((c, i) => { g.fillStyle = c; g.beginPath(); g.arc(gx, cy, 34, i * Math.PI / 2 - Math.PI / 4, (i + 1) * Math.PI / 2 - Math.PI / 4); g.lineTo(gx, cy); g.fill(); });
    g.fillStyle = '#fff'; g.font = `800 40px ${FONT}`; g.textAlign = 'center'; g.fillText('G', gx, cy + 2); g.textAlign = 'left';
    g.restore();
  }
}

// =====================================================================
// CONTADOR 0 → 100 %
// =====================================================================
let _claudeP = null;
async function renderContador(s, t, lt) {
  const gr = g.createRadialGradient(W / 2, H * .42, 0, W / 2, H * .45, H * .6);
  gr.addColorStop(0, '#2a1d17'); gr.addColorStop(.55, '#0d0a09'); gr.addColorStop(1, '#030303');
  g.fillStyle = gr; g.fillRect(0, 0, W, H);
  const p = eOut(clamp((t - s.ini - .1) / Math.max(.4, (s.lleno ?? s.fin) - s.ini - .1)));
  const cx = (ZS.lado + ZS.derecha) / 2, cy = 800, R = 300;
  g.save(); g.lineCap = 'round';
  g.strokeStyle = 'rgba(255,255,255,.08)'; g.lineWidth = 34; g.beginPath(); g.arc(cx, cy, R, 0, 7); g.stroke();
  g.shadowColor = 'rgba(217,119,87,.8)'; g.shadowBlur = 40; g.strokeStyle = '#d97757';
  g.beginPath(); g.arc(cx, cy, R, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * p); g.stroke(); g.shadowColor = 'transparent';
  g.fillStyle = '#f4f4f4'; g.font = `700 220px ${FONT}`; g.letterSpacing = '-10px'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(`${Math.round(p * 100)}%`, cx, cy + 6); g.letterSpacing = '0px';
  // logo de Claude
  if (!_claudeP) { const txt = await (await fetch('logos/claude.svg')).text(); _claudeP = new Path2D(txt.match(/ d="([^"]+)"/)[1]); }
  g.save(); g.translate(cx - 36, cy - R - 130); g.scale(3, 3); g.fillStyle = '#d97757'; g.fill(_claudeP); g.restore();
  if (p >= 1) { const q = clamp((t - (s.lleno ?? s.fin)) / .5); g.globalAlpha = 1 - q; g.strokeStyle = '#d97757'; g.lineWidth = 6; g.beginPath(); g.arc(cx, cy, R + q * 160, 0, 7); g.stroke(); }
  g.restore(); g.textAlign = 'left';
}

// =====================================================================
// CAPAS SOBRE LA PERSONA: visor REC, antes/después, mensaje directo
// =====================================================================
function visorCamara(t, lt) {
  g.save(); g.strokeStyle = 'rgba(245,245,245,.9)'; g.lineWidth = 5;
  const m = 70, top = ZS.arriba + 10, bot = ZS.abajo - 40, L = 70, k = eOut(clamp(lt / .3)), e = (1 - k) * 60;
  [[m - e, top - e, 1, 1], [W - m + e, top - e, -1, 1], [m - e, bot + e, 1, -1], [W - m + e, bot + e, -1, -1]].forEach(([x, y, sx, sy]) => { g.beginPath(); g.moveTo(x, y + L * sy); g.lineTo(x, y); g.lineTo(x + L * sx, y); g.stroke(); });
  g.font = `600 40px ${FONT}`; g.textBaseline = 'middle'; g.shadowColor = 'rgba(0,0,0,.5)'; g.shadowBlur = 10;
  if (Math.floor(t * 2.6) % 2 === 0) { g.fillStyle = '#ff2a2a'; g.beginPath(); g.arc(m + 34, top + 64, 14, 0, 7); g.fill(); }
  g.fillStyle = '#f0f0f0'; g.fillText('REC', m + 60, top + 66);
  const f = Math.floor(lt * 24), tc = `00:00:${String(Math.floor(lt) + 3).padStart(2, '0')}:${String(f % 24).padStart(2, '0')}`;
  g.font = `500 34px Menlo, monospace`; g.textAlign = 'right'; g.fillText(tc, ZS.derecha - 20, top + 66); g.textAlign = 'left';
  g.restore();
}
function etiqueta(txt, x, y, oscura) {
  g.save(); g.font = `700 34px ${FONT}`; const w = g.measureText(txt).width + 48;
  g.fillStyle = oscura ? 'rgba(15,15,15,.8)' : 'rgba(255,255,255,.92)'; g.beginPath(); g.roundRect(x - w / 2, y - 32, w, 64, 32); g.fill();
  g.fillStyle = oscura ? '#fff' : '#111'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(txt, x, y + 1); g.restore();
}
function mensajeDirecto(s, t) {
  const d = s.dm, k = eOut4(clamp((t - d.en) / .45)); if (k <= 0) return;
  const x = d.x ?? ZS.lado + 10, w = d.w ?? ZS.derecha - ZS.lado - 20, y = (d.y ?? ZS.arriba + 20) - (1 - k) * 220, h = 150;
  g.save(); g.globalAlpha = clamp(k * 1.5);
  g.shadowColor = 'rgba(0,0,0,.35)'; g.shadowBlur = 40; g.shadowOffsetY = 14;
  g.fillStyle = 'rgba(28,28,30,.9)'; g.beginPath(); g.roundRect(x, y, w, h, 36); g.fill(); g.shadowColor = 'transparent';
  const gx = x + 80, gy = y + h / 2, ig = g.createLinearGradient(gx - 40, gy + 40, gx + 40, gy - 40);
  ig.addColorStop(0, '#feda75'); ig.addColorStop(.35, '#fa7e1e'); ig.addColorStop(.6, '#d62976'); ig.addColorStop(1, '#4f5bd5');
  g.fillStyle = ig; g.beginPath(); g.roundRect(gx - 44, gy - 44, 88, 88, 24); g.fill();
  g.strokeStyle = '#fff'; g.lineWidth = 6; g.beginPath(); g.roundRect(gx - 24, gy - 24, 48, 48, 14); g.stroke(); g.beginPath(); g.arc(gx, gy, 11, 0, 7); g.stroke();
  g.fillStyle = '#fff'; g.font = `700 36px ${FONT}`; g.textBaseline = 'middle'; g.fillText(E.handle.replace('@', ''), x + 150, y + 52);
  g.fillStyle = '#d6d6d6'; g.font = `500 32px ${FONT}`; g.fillText(d.texto, x + 150, y + 100);
  g.fillStyle = '#8e8e8e'; g.font = `500 26px ${FONT}`; g.textAlign = 'right'; g.fillText('ahora', x + w - 34, y + 52); g.textAlign = 'left';
  // archivo del prompt (bloqueado) que llega después
  const k2 = eOut4(clamp((t - (d.archivo ?? 1e9)) / .4));
  if (k2 > 0) {
    const y2 = y + h + 20; g.globalAlpha = k2;
    g.fillStyle = 'rgba(28,28,30,.9)'; g.beginPath(); g.roundRect(x + 120, y2, w - 120, 110, 30); g.fill();
    g.fillStyle = '#d97757'; g.beginPath(); g.roundRect(x + 150, y2 + 22, 66, 66, 14); g.fill();
    g.fillStyle = '#fff'; g.font = `700 30px ${FONT}`; g.fillText('prompt_edicion.txt', x + 240, y2 + 42);
    g.fillStyle = '#bdbdbd'; g.font = `500 26px ${FONT}`; g.fillText('🔒 Solo por DM', x + 240, y2 + 80);
  }
  g.restore();
}

// =====================================================================
// TRES TARJETAS QUE SE ENCIENDEN (p. ej. guiones / videos / publica)
// =====================================================================
function check(x, y, r, k) {
  g.save(); g.translate(x, y); const s = .4 + .6 * eOut4(k); g.scale(s, s); g.globalAlpha *= clamp(k * 2);
  g.fillStyle = '#22c55e'; g.beginPath(); g.arc(0, 0, r, 0, 7); g.fill();
  g.strokeStyle = '#fff'; g.lineWidth = r * .22; g.lineCap = 'round'; g.lineJoin = 'round';
  g.beginPath(); g.moveTo(-r * .42, 0); g.lineTo(-r * .1, r * .32); g.lineTo(r * .45, -r * .35); g.stroke(); g.restore();
}
function renderTarjetas(s, t, lt) {
  papel(t); lineasVerticales(t, lt);
  const T = s.tarjetas, x = ZS.lado + 10, w = ZS.derecha - ZS.lado - 20, h = 250, y0 = 590, gap = 34;
  T.forEach((c, i) => { // siluetas apagadas desde el inicio de la escena
    const kp = eOut4(clamp((lt - i * .12) / .45)) * (1 - eOut4(clamp((t - c.en + .05) / .4)));
    if (kp <= 0) return;
    const y = y0 + i * (h + gap) + (1 - kp) * 60;
    g.save(); g.globalAlpha = kp * .9; g.setLineDash([18, 14]); g.strokeStyle = 'rgba(30,30,30,.35)'; g.lineWidth = 4;
    g.beginPath(); g.roundRect(x, y, w, h, 30); g.stroke(); g.setLineDash([]);
    g.fillStyle = 'rgba(30,30,30,.35)'; g.font = `700 54px ${FONT}`; g.textBaseline = 'middle'; g.fillText(c.icono + '  ' + c.titulo, x + 40, y + 62);
    g.restore();
  });
  T.forEach((c, i) => {
    const k = eOut4(clamp((t - c.en + .05) / .4)); if (k <= 0) return;
    const y = y0 + i * (h + gap) + (1 - k) * 30, lk = t - c.en;
    g.save(); g.globalAlpha = k;
    g.shadowColor = 'rgba(0,0,0,.22)'; g.shadowBlur = 40; g.shadowOffsetY = 16;
    g.fillStyle = '#141416'; g.beginPath(); g.roundRect(x, y, w, h, 30); g.fill(); g.shadowColor = 'transparent';
    g.font = `700 54px ${FONT}`; g.textBaseline = 'middle'; g.fillStyle = '#f2f2f2'; g.fillText(c.icono + '  ' + c.titulo, x + 40, y + 62);
    const ax = x + 40, ay = y + 115, aw = w - 190, ah = 105; // mini animación
    if (c.tipo === 'guion') {
      g.fillStyle = '#26262a'; g.beginPath(); g.roundRect(ax, ay, aw, ah, 14); g.fill();
      const n = clamp(lk / .9);
      [0, 1, 2].forEach(r => { const ww = (aw - 40) * [1, .8, .55][r] * clamp(n * 3 - r); g.fillStyle = '#8b8b92'; g.fillRect(ax + 20, ay + 20 + r * 28, ww, 12); });
    } else if (c.tipo === 'video') {
      g.fillStyle = '#26262a'; g.beginPath(); g.roundRect(ax, ay, aw, ah, 14); g.fill();
      const cols = ['#d97757', '#3d7bf5', '#22c55e', '#a855f7', '#f59e0b'];
      cols.forEach((col, j) => { const q = eOut4(clamp(lk * 3 - j * .35)); g.globalAlpha = k * q; g.fillStyle = col; g.beginPath(); g.roundRect(ax + 16 + j * (aw - 32) / 5 + (1 - q) * 60, ay + 22 + (j % 2) * 34, (aw - 32) / 5 - 10, 26, 6); g.fill(); });
      g.globalAlpha = k; g.fillStyle = '#fff'; g.fillRect(ax + 16 + (aw - 32) * ((lk * .5) % 1), ay + 10, 3, ah - 20);
    } else {
      g.fillStyle = '#26262a'; g.beginPath(); g.roundRect(ax, ay, aw, ah, 14); g.fill();
      const p = clamp(lk / .8), ig = g.createLinearGradient(ax + 20, ay + 80, ax + 80, ay + 20);
      ig.addColorStop(0, '#feda75'); ig.addColorStop(.5, '#d62976'); ig.addColorStop(1, '#4f5bd5');
      g.fillStyle = ig; g.beginPath(); g.roundRect(ax + 20, ay + 18, 70, 70, 18); g.fill();
      g.fillStyle = '#3a3a40'; g.beginPath(); g.roundRect(ax + 110, ay + 46, aw - 140, 16, 8); g.fill();
      g.fillStyle = p < 1 ? '#3d7bf5' : '#22c55e'; g.beginPath(); g.roundRect(ax + 110, ay + 46, (aw - 140) * Math.max(.05, p), 16, 8); g.fill();
      g.fillStyle = '#d0d0d0'; g.font = `600 26px ${FONT}`; g.fillText(p < 1 ? 'Publicando…' : 'Publicado ✓', ax + 110, ay + 84);
    }
    g.restore();
    const kc = clamp((t - (c.listo ?? c.en + .55)) / .3); if (kc > 0) check(x + w - 80, y + h / 2, 46, kc);
  });
}

// =====================================================================
// CHAT CON LA IA: prompt genérico → "no puedo"
// =====================================================================
function burbuja(txt, x, y, maxw, derecha, color, colorTxt, k) {
  g.font = `600 54px ${FONT}`;
  const pal = txt.split(' '), lines = []; let l = '';
  for (const p of pal) { if (g.measureText(l + p).width > maxw - 60) { lines.push(l.trim()); l = ''; } l += p + ' '; }
  lines.push(l.trim());
  const w = Math.min(maxw, Math.max(...lines.map(q => g.measureText(q).width)) + 70), h = lines.length * 68 + 48;
  const bx = derecha ? x + maxw - w : x;
  g.save(); g.globalAlpha = k; g.translate(bx + w / 2, y + h / 2); g.scale(lerp(.8, 1, eOut4(k)), lerp(.8, 1, eOut4(k))); g.translate(-(bx + w / 2), -(y + h / 2));
  g.fillStyle = color; g.beginPath(); g.roundRect(bx, y, w, h, 30); g.fill();
  g.fillStyle = colorTxt; g.textBaseline = 'top'; lines.forEach((q, i) => g.fillText(q, bx + 35, y + 26 + i * 68));
  g.restore();
  return h;
}
function renderChat(s, t, lt) {
  const gr = g.createRadialGradient(W / 2, H * .45, 0, W / 2, H * .5, H * .62);
  gr.addColorStop(0, '#1d1d22'); gr.addColorStop(.6, '#0b0b0d'); gr.addColorStop(1, '#030303');
  g.fillStyle = gr; g.fillRect(0, 0, W, H);
  const C = s.chat, x = ZS.lado + 10, w = ZS.derecha - ZS.lado - 20, y = 600, h = 820;
  const err = C.no != null ? clamp((t - C.no) / .5) : 0, sh = err > 0 && err < 1 ? Math.sin(err * 40) * 18 * (1 - err) : 0;
  g.save(); g.translate(sh, 0);
  g.fillStyle = '#18181b'; g.beginPath(); g.roundRect(x, y, w, h, 36); g.fill();
  g.strokeStyle = err > 0 ? `rgba(239,68,68,${.9 * (1 - err * .5)})` : 'rgba(255,255,255,.08)'; g.lineWidth = 4; g.stroke();
  g.fillStyle = '#26262b'; g.beginPath(); g.roundRect(x, y, w, 100, [36, 36, 0, 0]); g.fill();
  g.fillStyle = '#a78bfa'; g.beginPath(); g.arc(x + 60, y + 50, 26, 0, 7); g.fill();
  g.fillStyle = '#fff'; g.font = `700 30px ${FONT}`; g.textBaseline = 'middle'; g.fillText('✦', x + 49, y + 52);
  g.font = `700 36px ${FONT}`; g.fillText('Asistente IA', x + 104, y + 50);
  let cy = y + 140;
  const ku = clamp((t - C.usuario) / .35);
  if (ku > 0) {
    const n = Math.floor(C.texto.length * clamp((t - C.usuario) / .9));
    const hh = burbuja(C.texto.slice(0, Math.max(1, n)), x + 30, cy, w - 60, true, '#3d7bf5', '#fff', ku);
    const kg = clamp((t - C.generico) / .3);
    if (kg > 0) { g.save(); g.globalAlpha = kg; g.translate(x + w - 240, cy + hh + 6); g.rotate(-.06); g.scale(lerp(1.6, 1, eOut4(kg)), lerp(1.6, 1, eOut4(kg)));
      g.fillStyle = '#f3e300'; g.beginPath(); g.roundRect(-150, -26, 360, 56, 12); g.fill(); g.fillStyle = '#111'; g.font = `800 30px ${FONT}`; g.textBaseline = 'middle'; g.fillText('⚠ PROMPT GENÉRICO', -128, 3); g.restore(); }
    cy += hh + 90;
  }
  if (t > C.escribiendo && (C.no == null || t < C.no)) {
    g.fillStyle = '#2c2c31'; g.beginPath(); g.roundRect(x + 30, cy, 190, 96, 48); g.fill();
    [0, 1, 2].forEach(i => { g.fillStyle = `rgba(255,255,255,${.35 + .65 * Math.max(0, Math.sin(t * 8 - i * .9))})`; g.beginPath(); g.arc(x + 80 + i * 45, cy + 48, 12, 0, 7); g.fill(); });
  }
  if (C.no != null && t >= C.no) burbuja(C.respuesta, x + 30, cy, w - 60, false, '#2c2c31', '#fff', clamp((t - C.no) / .3));
  g.restore();
  if (err > 0 && err < 1) { g.save(); g.fillStyle = `rgba(239,68,68,${.25 * (1 - err)})`; g.fillRect(0, 0, W, H); g.restore(); }
}

// =====================================================================
// =====================================================================
// TARJETA DE PERFIL FIJA ARRIBA: la bio de IG se va llenando renglón por renglón
// cfg.bio = { entra, sale, brillo?, cuenta, nombre, stats:[[n,etiqueta]x3], lineas:[{texto, en, fila, hasta?, link?}] }
// En "texto", lo que va entre {llaves} sale en azul (p. ej. "Soy {@tucuenta}").
// =====================================================================
const BIO = { x: 100, y: 280, w: 880, h: 432 };
function verificado(x, y, r) {
  g.save(); g.fillStyle = '#0095f6'; g.beginPath();
  for (let i = 0; i < 16; i++) { const a = i / 16 * Math.PI * 2, rr = i % 2 ? r * .86 : r; g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr); }
  g.fill(); g.strokeStyle = '#fff'; g.lineWidth = r * .24; g.lineCap = 'round'; g.lineJoin = 'round';
  g.beginPath(); g.moveTo(x - r * .4, y + r * .02); g.lineTo(x - r * .1, y + r * .32); g.lineTo(x + r * .42, y - r * .3); g.stroke(); g.restore();
}
function lineaBio(L, x, y, maxw, t) {
  const k = eOut(clamp((t - L.en) / .45)), kf = L.hasta != null ? 1 - eOut(clamp((t - L.hasta) / .25)) : 1;
  if (k <= 0 || kf <= 0) return;
  let tam = 27; g.font = `400 ${tam}px ${FONT}`;
  const plano = L.texto.replace(/[{}]/g, ''), w0 = g.measureText(plano).width;
  if (w0 > maxw) { tam *= maxw / w0; g.font = `400 ${tam}px ${FONT}`; }
  const ancho = g.measureText(plano).width;
  // marcatextos breve sobre el renglón nuevo (se dibuja y luego se desvanece)
  const kh = eOut(clamp((t - L.en - .1) / .35)) * (1 - clamp((t - L.en - 1.6) / .5)) * kf;
  if (kh > 0) { g.save(); g.globalAlpha = .55 * clamp(kh * 3); g.fillStyle = '#f3e300'; g.fillRect(x - 6, y - tam * .82, (ancho + 12) * kh, tam * 1.12); g.restore(); }
  g.save(); g.globalAlpha = kf; g.filter = k < 1 ? `blur(${((1 - k) * 3).toFixed(1)}px)` : 'none'; g.textBaseline = 'alphabetic';
  const gris = Math.round(lerp(215, 38, k));
  let cx = x;
  for (const [i, parte] of L.texto.split(/[{}]/).entries()) {
    if (!parte) continue;
    const azul = i % 2 === 1;
    g.fillStyle = L.link ? `rgba(150,140,230,${.25 + .75 * k})` : azul ? `rgba(79,91,213,${.25 + .75 * k})` : `rgb(${gris},${gris},${gris + 2})`;
    g.fillText(parte, cx, y); cx += g.measureText(parte).width;
  }
  g.restore();
}
function tarjetaBio(t) {
  const B = E.bio; if (!B || t < B.entra - .05 || t > B.sale + .6) return;
  const kIn = eOut4(clamp((t - B.entra) / .45)), kOut = eInOut(clamp((t - B.sale) / .45));
  const { x, w, h } = BIO, y = BIO.y - kOut * 140, base = kIn * (1 - kOut);
  if (base <= 0) return;
  const el = d => eOut(clamp((t - B.entra - d) / .4));
  g.save(); g.globalAlpha = base;
  const sc = lerp(.94, 1, kIn) * (1 - kOut * .04); g.translate(x + w / 2, y + h / 2); g.scale(sc, sc); g.translate(-(x + w / 2), -(y + h / 2));
  g.save(); g.shadowColor = 'rgba(0,0,0,.24)'; g.shadowBlur = 50; g.shadowOffsetY = 16;
  g.fillStyle = '#fbfbfd'; g.beginPath(); g.roundRect(x, y, w, h, 40); g.fill(); g.restore();
  if (B.brillo != null) { // clímax: la tarjeta brilla en dorado
    const d = t - B.brillo, kb = d < 0 ? 0 : d < .25 ? eOut(d / .25) : 1 - eInOut(clamp((d - .25) / 1.4));
    if (kb > 0) { g.save(); g.globalAlpha = base * kb; g.strokeStyle = '#f0c35a'; g.lineWidth = 6; g.shadowColor = 'rgba(255,190,80,.95)'; g.shadowBlur = 40; g.beginPath(); g.roundRect(x, y, w, h, 40); g.stroke(); g.restore(); }
  }
  // encabezado: cuenta + verificado
  g.globalAlpha = base * el(.12); g.fillStyle = '#262626'; g.font = `700 46px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'alphabetic';
  const cw = g.measureText(B.cuenta).width; g.fillText(B.cuenta, x + w / 2 - 14, y + 74); g.textAlign = 'left';
  verificado(x + w / 2 - 14 + cw / 2 + 24, y + 58, 15);
  // avatar vacío
  g.globalAlpha = base * el(.22);
  const ax = x + 130, ay = y + 172, r = 70;
  g.save(); g.beginPath(); g.arc(ax, ay, r, 0, 7); g.fillStyle = '#d9d9de'; g.fill(); g.clip();
  g.fillStyle = '#f4f4f6'; g.beginPath(); g.arc(ax, ay - 14, r * .36, 0, 7); g.fill();
  g.beginPath(); g.ellipse(ax, ay + r * .78, r * .66, r * .46, 0, 0, 7); g.fill(); g.restore();
  g.strokeStyle = '#e4e4e8'; g.lineWidth = 3; g.beginPath(); g.arc(ax, ay, r, 0, 7); g.stroke();
  // nombre y números
  g.globalAlpha = base * el(.3); g.fillStyle = '#262626';
  g.font = `600 30px ${FONT}`; g.fillText(B.nombre, x + 250, y + 130);
  const cols = [x + 250, x + 470, x + 680];
  B.stats.forEach(([n, lab], i) => {
    g.font = `600 33px ${FONT}`; g.fillText(n, cols[i], y + 182);
    g.font = `400 28px ${FONT}`; g.fillText(lab, cols[i], y + 218);
  });
  // bio
  g.globalAlpha = base;
  const LY = y + 274, LH = 34;
  for (const L of B.lineas) lineaBio(L, x + 52, LY + L.fila * LH + (L.link ? 10 : 0), w - 104, t);
  g.restore();
}

// =====================================================================
// "¡FELICIDADES!" + ANILLO CON PORCENTAJE (panel abajo, sobre el pecho)
// cfg.anillos = [{ en, estas, num, cre, fin, de, pct, oro? }]  (tiempos de la voz)
// =====================================================================
function anillos(t) {
  for (const A of E.anillos) {
    if (t < A.en - .1 || t > A.fin + .1) continue;
    const kIn = eOut4(clamp((t - A.en + .08) / .4)), kOut = eInOut(clamp((t - A.fin + .2) / .28)), base = kIn * (1 - kOut);
    if (base <= 0) continue;
    const oro = !!A.oro, px = 70, pw = 820, ph = 220, py = 1296 + (1 - kIn) * 70 + kOut * 50;
    g.save(); g.globalAlpha = base;
    g.save(); g.shadowColor = oro ? 'rgba(240,180,60,.75)' : 'rgba(0,0,0,.25)'; g.shadowBlur = oro ? 60 : 44; g.shadowOffsetY = oro ? 0 : 14;
    g.fillStyle = 'rgba(251,251,253,.94)'; g.beginPath(); g.roundRect(px, py, pw, ph, 44); g.fill(); g.restore();
    if (oro) { g.strokeStyle = '#f0c35a'; g.lineWidth = 5; g.beginPath(); g.roundRect(px, py, pw, ph, 44); g.stroke(); }
    // anillo que se dibuja
    const cx = px + 130, cy = py + ph / 2, r = 80, kr = eInOut(clamp((t - A.en - .05) / .6));
    g.lineCap = 'round';
    g.strokeStyle = oro ? 'rgba(240,195,90,.25)' : 'rgba(0,0,0,.08)'; g.lineWidth = 12; g.beginPath(); g.arc(cx, cy, r, 0, 7); g.stroke();
    g.save(); g.strokeStyle = oro ? '#e8b23c' : '#111'; g.lineWidth = 12; g.shadowColor = oro ? 'rgba(255,190,80,.9)' : 'transparent'; g.shadowBlur = 24;
    g.beginPath(); g.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * kr); g.stroke(); g.restore();
    // número que baja del porcentaje anterior al nuevo
    const kn = eOut(clamp((t - A.num + .3) / .55)), n = Math.round(lerp(A.de, A.pct, kn));
    g.fillStyle = oro ? '#c98a12' : '#111'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = `700 58px ${FONT}`; g.letterSpacing = '-2px'; g.fillText(`${n}%`, cx + 2, cy + 3); g.letterSpacing = '0px';
    // textos
    g.textAlign = 'left'; g.textBaseline = 'alphabetic';
    const tx = px + 260, kf = eOut(clamp((t - A.en + .05) / .3));
    g.font = `700 66px ${FONT}`; g.letterSpacing = '-2px'; const fw = g.measureText('¡Felicidades!').width;
    const kh = eOut(clamp((t - A.en) / .35));
    g.fillStyle = oro ? '#f0c35a' : '#f3e300'; g.fillRect(tx - 10, py + 38, (fw + 20) * kh, 74);
    g.globalAlpha = base * kf; g.fillStyle = '#111'; g.fillText('¡Felicidades!', tx, py + 98); g.letterSpacing = '0px';
    g.font = `500 38px ${FONT}`; g.fillStyle = '#3a3a3a';
    g.globalAlpha = base * eOut(clamp((t - A.estas + .05) / .3)); g.fillText('estás dentro del', tx, py + 150);
    g.globalAlpha = base * eOut(clamp((t - A.cre + .05) / .3)); g.fillText('de los creadores', tx, py + 194);
    g.restore();
  }
}

// =====================================================================
// TITULAR ARRIBA DE LA LAPTOP ("100% IA / HECHO POR ✳Claude") — se va cuando arranca el video
// cfg.titular = { lineas:[...], sale, y?, logo? }
// =====================================================================
function logoClaude(x, y, s, rot = 0) {
  if (!_claudeP) return;
  g.save(); g.translate(x, y); g.rotate(rot); g.scale(s / 24, s / 24); g.translate(-12, -12);
  g.fillStyle = '#d97757'; g.fill(_claudeP); g.restore();
}
function titular(t) {
  const T = E.titular; if (!T || t > T.sale + .4) return;
  const kIn = eOut4(clamp((t - (T.entra ?? 0) + .05) / .45)), kOut = eInOut(clamp((t - T.sale) / .3)), a = kIn * (1 - kOut);
  if (a <= 0) return;
  const tam = 92, y0 = T.y ?? 880;
  g.font = `800 ${tam}px ${FONT}`; const wT = Math.max(...T.lineas.map(l => g.measureText(l).width)) + tam * 1.3;
  const cx = Math.min(W / 2, ZS.derecha - wT / 2);
  g.save(); g.globalAlpha = a; g.textAlign = 'center'; g.textBaseline = 'alphabetic';
  g.translate(cx, y0); const sc = lerp(1.12, 1, kIn) * (1 + kOut * .08); g.scale(sc, sc); g.translate(-cx, -y0);
  g.filter = kIn < 1 || kOut > 0 ? `blur(${((1 - kIn) * 10 + kOut * 12).toFixed(1)}px)` : 'none';
  g.shadowColor = 'rgba(0,0,0,.6)'; g.shadowBlur = 26; g.shadowOffsetY = 4;
  g.fillStyle = '#fff'; g.font = `800 ${tam}px ${FONT}`; g.letterSpacing = '-2px';
  g.fillText(T.lineas[0], cx, y0);
  const w2 = g.measureText(T.lineas[1]).width, x2 = cx - tam * .55;
  g.fillText(T.lineas[1], x2, y0 + tam * 1.02); g.letterSpacing = '0px'; g.shadowColor = 'transparent';
  logoClaude(x2 + w2 / 2 + tam * .62, y0 + tam * .66, tam * 1.15, t * .6);
  g.restore();
}

// =====================================================================
// LETRERO PIXELEADO "CLAUDE CODE" (como el banner de la terminal)
// escena.pixel = { en, fin, lineas:["CLAUDE","CODE"], y? }
// =====================================================================
const PX = document.createElement('canvas'), px = PX.getContext('2d');
function letreroPixel(s, t) {
  const P = s.pixel; if (!P || t < P.en - .05 || t > P.fin + .3) return;
  const kIn = eOut4(clamp((t - P.en) / .35)), kOut = eInOut(clamp((t - P.fin) / .25)), a = kIn * (1 - kOut);
  if (a <= 0) return;
  // se dibuja chiquito y se escala sin suavizado → pixeles
  const esc = 8, pw = 96, ph = 46; PX.width = pw; PX.height = ph;
  px.clearRect(0, 0, pw, ph); px.font = `900 20px Menlo, monospace`; px.textBaseline = 'top'; px.textAlign = 'left';
  P.lineas.forEach((l, i) => { px.fillStyle = '#7a3b22'; px.fillText(l, 3, 3 + i * 21); px.fillStyle = '#e07a52'; px.fillText(l, 2, 2 + i * 21); });
  // revelado letra por letra (barrido)
  const rev = clamp((t - P.en) / .45);
  const w = pw * esc, h = ph * esc, x = Math.min(W / 2, ZS.derecha - w / 2 - 34) - w / 2, y = (P.y ?? 1180) - h / 2 + (1 - kIn) * 40;
  g.save(); g.globalAlpha = a;
  g.shadowColor = 'rgba(0,0,0,.45)'; g.shadowBlur = 40; g.shadowOffsetY = 12;
  g.fillStyle = 'rgba(14,14,14,.92)'; g.beginPath(); g.roundRect(x - 34, y - 30, w + 68, h + 50, 28); g.fill(); g.shadowColor = 'transparent';
  g.beginPath(); g.rect(x - 34, y - 30, (w + 68) * rev, h + 60); g.clip();
  g.imageSmoothingEnabled = false; g.drawImage(PX, x, y, w, h); g.imageSmoothingEnabled = true;
  // cursor parpadeante
  if (Math.floor(t * 2.4) % 2 === 0) { g.fillStyle = '#e07a52'; g.fillRect(x + w - 30, y + h - 60, 26, 44); }
  g.restore();
}

// =====================================================================
// CHIPS CON PALOMITA (uno por palabra: efectos, imágenes, música…), se juntan al final
// escena.chips = { items:[{en, icono, texto}], junta, fin, y? }
// =====================================================================
function chipsLista(s, t) {
  const C = s.chips; if (!C || t > C.fin + .3) return;
  const n = C.items.length, y0 = (C.y ?? 900 / 1920) * (C.y != null ? H : 1920), paso = C.paso ?? 112, cx = C.x != null ? C.x * W : (ZS.lado + ZS.derecha) / 2;
  const kj = eInOut(clamp((t - C.junta) / .45)), kOut = eInOut(clamp((t - C.fin) / .25));
  C.items.forEach((it, i) => {
    const k = eOut4(clamp((t - it.en + .05) / .35)); if (k <= 0) return;
    g.save(); g.font = `600 46px ${FONT}`;
    const tw = g.measureText(it.texto).width, w = tw + 200, h = 92;
    const lado = i % 2 ? 1 : -1, xb = C.alterna === false ? cx - w / 2 : cx + lado * 120 - w / 2;
    const yy = y0 + i * paso, xj = lerp(xb, cx - w / 2, kj), yj = lerp(yy, y0 + (n - 1) * paso / 2, kj);
    const x = xj + (1 - k) * lado * 160, y = yj;
    g.globalAlpha = clamp(k * 1.4) * (1 - kj * .85) * (1 - kOut);
    g.translate(x + w / 2, y + h / 2); const sc = lerp(.7, 1, k) * (1 - kj * .5); g.scale(sc, sc); g.translate(-(x + w / 2), -(y + h / 2));
    g.shadowColor = 'rgba(0,0,0,.28)'; g.shadowBlur = 34; g.shadowOffsetY = 10;
    g.fillStyle = 'rgba(251,251,253,.95)'; g.beginPath(); g.roundRect(x, y, w, h, 46); g.fill(); g.shadowColor = 'transparent';
    g.font = `400 46px "Apple Color Emoji", ${FONT}`; g.textBaseline = 'middle'; g.fillText(it.icono, x + 30, y + h / 2 + 2);
    g.fillStyle = '#111'; g.font = `600 46px ${FONT}`; g.fillText(it.texto, x + 96, y + h / 2 + 2);
    check(x + w - 48, y + h / 2, 24, clamp((t - it.en - .15) / .3));
    g.restore();
  });
}

// =====================================================================
// CRONÓMETRO "< 1 hora" (panel blanco abajo)
// escena.crono = { en, fin, texto }
// =====================================================================
function cronometro(s, t) {
  const C = s.crono; if (!C || t < C.en - .1 || t > C.fin + .3) return;
  const kIn = eOut4(clamp((t - C.en + .05) / .4)), kOut = eInOut(clamp((t - C.fin) / .28)), base = kIn * (1 - kOut);
  if (base <= 0) return;
  const pw = 760, ph = 200, px0 = (ZS.lado + ZS.derecha) / 2 - pw / 2, py = (C.y ?? 1300) + (1 - kIn) * 70;
  g.save(); g.globalAlpha = base;
  g.save(); g.shadowColor = 'rgba(0,0,0,.25)'; g.shadowBlur = 44; g.shadowOffsetY = 14;
  g.fillStyle = 'rgba(251,251,253,.95)'; g.beginPath(); g.roundRect(px0, py, pw, ph, 44); g.fill(); g.restore();
  const cx = px0 + 112, cy = py + ph / 2, r = 66, kr = eInOut(clamp((t - C.en) / 1.1)) * .97;
  g.lineCap = 'round'; g.strokeStyle = 'rgba(0,0,0,.08)'; g.lineWidth = 12; g.beginPath(); g.arc(cx, cy, r, 0, 7); g.stroke();
  g.strokeStyle = '#111'; g.beginPath(); g.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * kr); g.stroke();
  g.save(); g.translate(cx, cy); g.rotate(Math.PI * 2 * kr); g.strokeStyle = '#d97757'; g.lineWidth = 7; g.beginPath(); g.moveTo(0, 0); g.lineTo(0, -r * .7); g.stroke(); g.restore();
  g.fillStyle = '#111'; g.beginPath(); g.arc(cx, cy, 7, 0, 7); g.fill();
  const seg = Math.floor(kr / .97 * 3540), mm = String(Math.floor(seg / 60)).padStart(2, '0'), ss = String(seg % 60).padStart(2, '0');
  g.textBaseline = 'alphabetic'; g.fillStyle = '#111'; g.font = `700 74px Menlo, monospace`; g.fillText(`${mm}:${ss}`, px0 + 220, py + 98);
  const kt = eOut(clamp((t - C.en - 1.0) / .3));
  g.globalAlpha = base * kt; g.font = `700 46px ${FONT}`; const tw = g.measureText(C.texto).width;
  g.fillStyle = '#f3e300'; g.fillRect(px0 + 212, py + 118, (tw + 18) * kt, 56); g.fillStyle = '#111'; g.fillText(C.texto, px0 + 221, py + 162);
  g.restore();
}

// =====================================================================
// LOGO DE CLAUDE + SELLO ROJO ("SIN TRABAJO")
// escena.sello = { logo, en, fin, texto, x, y }   (x, y en fracción del lienzo)
// =====================================================================
function selloClaude(s, t) {
  const S = s.sello; if (!S || t < S.logo - .05 || t > S.fin + .3) return;
  const kOut = eInOut(clamp((t - S.fin) / .25)), cx = S.x * W, cy = S.y * H;
  const kl = clamp((t - S.logo) / .45), bote = kl < 1 ? 1 + Math.sin(kl * Math.PI) * .18 * (1 - kl) : 1;
  g.save(); g.globalAlpha = (1 - kOut);
  g.save(); g.shadowColor = 'rgba(217,119,87,.55)'; g.shadowBlur = 50;
  logoClaude(cx, cy, 250 * eOut4(kl) * bote, (1 - eOut4(kl)) * -1.2 + t * .25); g.restore();
  const ks = clamp((t - S.en) / .22);
  if (ks > 0) {
    const sc = lerp(2.6, 1, eOut4(ks)); g.translate(cx + 20, cy + 120); g.rotate(-.12); g.scale(sc, sc);
    g.globalAlpha = (1 - kOut) * clamp(ks * 2.5);
    g.font = `900 80px ${FONT}`; g.letterSpacing = '2px'; const tw = g.measureText(S.texto).width;
    g.strokeStyle = '#e0262b'; g.lineWidth = 10; g.beginPath(); g.roundRect(-tw / 2 - 32, -58, tw + 64, 116, 14); g.stroke();
    g.fillStyle = 'rgba(224,38,43,.08)'; g.fill();
    g.fillStyle = '#e0262b'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(S.texto, 0, 4); g.letterSpacing = '0px';
  }
  g.restore();
}

// =====================================================================
// NÚMERO QUE CUENTA (p. ej. 0 → 100%)
// escena.cuenta = { en, dura, fin, de, a, x, y, tam }
// =====================================================================
function cuentaGrande(s, t) {
  const C = s.cuenta; if (!C || t < C.en - .05 || t > C.fin + .3) return;
  const kIn = eOut4(clamp((t - C.en) / .35)), kOut = eInOut(clamp((t - C.fin) / .25)), a = kIn * (1 - kOut);
  if (a <= 0) return;
  const n = Math.round(lerp(C.de, C.a, eOut(clamp((t - C.en) / (C.dura ?? .8))))), tam = C.tam ?? 230;
  const x = C.x * W, y = C.y * H + (1 - kIn) * 50;
  g.save(); g.globalAlpha = a; g.textBaseline = 'alphabetic'; g.textAlign = 'left';
  g.filter = kIn < 1 ? `blur(${((1 - kIn) * 12).toFixed(1)}px)` : 'none';
  g.shadowColor = 'rgba(0,0,0,.55)'; g.shadowBlur = 40;
  g.font = `800 ${tam}px ${FONT}`; g.letterSpacing = `${-tam * .05}px`; const nw = g.measureText(String(n)).width;
  g.font = `300 ${tam * .62}px ${FONT}`; const pw = g.measureText('%').width; const x0 = x - (nw + pw + 10) / 2;
  g.font = `800 ${tam}px ${FONT}`; g.fillStyle = '#fff'; g.fillText(String(n), x0, y);
  g.font = `300 ${tam * .62}px ${FONT}`; g.fillStyle = '#f0c35a'; g.fillText('%', x0 + nw + 10, y);
  g.letterSpacing = '0px'; g.restore();
}

// =====================================================================
// ONDA DE AUDIO (barras que se mueven abajo)  escena.onda = { en, fin }
// =====================================================================
function ondaAudio(s, t) {
  const O = s.onda; if (!O || t < O.en - .05 || t > O.fin + .3) return;
  const k = eOut(clamp((t - O.en) / .3)) * (1 - eInOut(clamp((t - O.fin) / .3)));
  if (k <= 0) return;
  const n = 64, x0 = ZS.lado, x1 = ZS.derecha, bw = (x1 - x0) / n, base = H - 60, alto = 110;
  g.save(); g.globalAlpha = k * .9; g.fillStyle = '#f3e300'; g.shadowColor = 'rgba(243,227,0,.5)'; g.shadowBlur = 14;
  for (let i = 0; i < n; i++) {
    const v = .15 + .85 * Math.abs(Math.sin(t * 9 + i * .7) * Math.sin(t * 3.3 + i * 1.9 + hash(i) * 6)) * (.4 + .6 * hash(i * 3.1));
    const h = alto * v * k; g.beginPath(); g.roundRect(x0 + i * bw + bw * .2, base - h, bw * .6, h, 3); g.fill();
  }
  g.restore();
}

// =====================================================================
// PROGRAMAS DE EDICIÓN PIXELEADOS QUE SE TACHAN Y SE DESINTEGRAN
// escena.apps = { en, tacha, fin, x, y }
// =====================================================================
const APP_COL = [['#2a1a5e', '#9b8cff'], ['#0d2340', '#4fa3ff'], ['#3b1d0b', '#ff9a3c']];
function appsTachadas(s, t) {
  const A = s.apps; if (!A || t < A.en - .05 || t > A.fin + .4) return;
  const tam = 190, gap = 34, n = 3, total = n * tam + (n - 1) * gap, x0 = A.x * W - total / 2, y0 = A.y * H - tam / 2;
  const kd = clamp((t - A.fin + .15) / .5);  // desintegración
  g.save();
  for (let i = 0; i < n; i++) {
    const k = eOut4(clamp((t - A.en - i * .1) / .35)); if (k <= 0) continue;
    const x = x0 + i * (tam + gap), y = y0 + (1 - k) * 60, [b, c] = APP_COL[i], px = 10, cel = tam / px;
    g.globalAlpha = k;
    g.save(); g.beginPath(); g.roundRect(x, y, tam, tam, 32); g.clip();
    const im = A.logos && logo(A.logos[i]); let pix = null;
    if (im) { const pc = document.createElement('canvas'); pc.width = pc.height = px; const pg = pc.getContext('2d', { willReadFrequently: true }); pg.fillStyle = '#fff'; pg.fillRect(0, 0, px, px); pg.drawImage(im, 0, 0, px, px); pix = pg.getImageData(0, 0, px, px).data; }
    for (let a = 0; a < px; a++) for (let bb = 0; bb < px; bb++) {
      const r = hash(i * 100 + a * 10 + bb), q = (bb * px + a) * 4, mezcla = pix ? `rgb(${pix[q]},${pix[q + 1]},${pix[q + 2]})` : (r > .55 ? c : b);
      const drift = kd > 0 ? kd * (60 + r * 140) : 0;
      g.globalAlpha = k * (1 - clamp(kd * (1 + r)));
      g.fillStyle = mezcla; g.fillRect(x + a * cel + drift * (r - .5) * 2, y + bb * cel - drift, cel + .5, cel + .5);
    }
    g.restore();
  }
  // ✕ roja que tacha todo
  const kx = eOut4(clamp((t - A.tacha) / .3));
  if (kx > 0) {
    g.globalAlpha = 1 - clamp(kd * 1.5); g.strokeStyle = '#e0262b'; g.lineWidth = 18; g.lineCap = 'round';
    g.shadowColor = 'rgba(224,38,43,.6)'; g.shadowBlur = 20;
    const m = 20;
    g.beginPath(); g.moveTo(x0 - m, y0 - m); g.lineTo(lerp(x0 - m, x0 + total + m, kx), lerp(y0 - m, y0 + tam + m, kx)); g.stroke();
    const k2 = eOut4(clamp((t - A.tacha - .12) / .3));
    if (k2 > 0) { g.beginPath(); g.moveTo(x0 + total + m, y0 - m); g.lineTo(lerp(x0 + total + m, x0 - m, k2), lerp(y0 - m, y0 + tam + m, k2)); g.stroke(); }
  }
  g.restore();
}

// =====================================================================
// TOP 5 (réplica viral): ventana con candados, presentación de herramienta, demos
// =====================================================================
const NARANJA = '#ff8a1f';
const logo = n => IMG['logo_' + n];
function heygenGema(cx, cy, s) {  // el ícono de HeyGen solo existe chiquito: se dibuja
  const p = [[-1, -1, '#3ee3a6', '#25c2d9'], [1, -1, '#c89bff', '#ff8fd8'], [-1, 1, '#ff9ad5', '#b59bff'], [1, 1, '#3fd2ff', '#3ee3c4']];
  for (const [dx, dy, c1, c2] of p) {
    const gr = g.createLinearGradient(cx + dx * s, cy + dy * s, cx, cy); gr.addColorStop(0, c1); gr.addColorStop(1, c2);
    g.fillStyle = gr; g.beginPath();
    g.moveTo(cx + dx * s * .12, cy + dy * s * .12); g.lineTo(cx + dx * s, cy + dy * s * .22); g.quadraticCurveTo(cx + dx * s, cy + dy * s, cx + dx * s * .22, cy + dy * s);
    g.closePath(); g.fill();
  }
}
function dibujaLogo(n, cx, cy, tam) {
  if (n === 'heygen') return heygenGema(cx, cy, tam * .46);
  const im = logo(n); if (!im) return;
  g.drawImage(im, cx - tam / 2, cy - tam / 2, tam, tam);
}
function candado(cx, cy, s, abre) {
  g.save(); g.strokeStyle = 'rgba(255,255,255,.75)'; g.fillStyle = 'rgba(255,255,255,.75)'; g.lineWidth = s * .13; g.lineCap = 'round';
  g.beginPath(); g.arc(cx, cy - s * .18 - abre * s * .35, s * .26, Math.PI, 0); g.stroke();
  g.beginPath(); g.roundRect(cx - s * .38, cy - s * .18, s * .76, s * .58, s * .1); g.fill(); g.restore();
}
function halo5(x, y, w, h, r, a) {
  g.save(); g.shadowColor = `rgba(255,138,31,${a})`; g.shadowBlur = 50; g.strokeStyle = `rgba(255,160,60,${a})`; g.lineWidth = 3;
  g.beginPath(); g.roundRect(x, y, w, h, r); g.stroke(); g.restore();
}
// cfg.top5 = { veces: [[a, b], ...], slots: [{en, logo}] }
// Como la referencia: rejilla naranja detrás de ti; una barra cae desde arriba, se abre en una ventana naranja brillante,
// el título se escribe y los 5 candados aparecen uno por uno.
const easeBack = k => { const c = 1.9; return 1 + (c + 1) * Math.pow(k - 1, 3) + c * Math.pow(k - 1, 2); };
function top5Activa(t) { const T = E.top5; return T && T.veces.find(([a, b]) => t >= a - .05 && t <= b + .45); }
function rejillaTop5(t) {  // va detrás de ti (entre el fondo real y tu recorte)
  const v = top5Activa(t); if (!v) return;
  const a = clamp((t - v[0]) / .35) * (1 - clamp((t - v[1]) / .4)); if (a <= 0) return;
  g.save();
  const tin = g.createLinearGradient(0, 0, 0, H * .75); tin.addColorStop(0, `rgba(255,120,20,${(.34 * a).toFixed(3)})`); tin.addColorStop(1, 'rgba(255,120,20,0)');
  g.globalCompositeOperation = 'screen'; g.fillStyle = tin; g.fillRect(0, 0, W, H);
  g.globalCompositeOperation = 'source-over';
  const paso = 56, desp = (t * 6) % paso;
  for (let y = -paso + desp; y < H * .8; y += paso) { const al = a * .32 * clamp(1 - y / (H * .8)); g.fillStyle = `rgba(255,150,50,${al.toFixed(3)})`; g.fillRect(0, y, W, 2); }
  for (let x = 0; x < W; x += paso) { const lg = g.createLinearGradient(0, 0, 0, H * .8); lg.addColorStop(0, `rgba(255,150,50,${(a * .3).toFixed(3)})`); lg.addColorStop(1, 'rgba(255,150,50,0)'); g.fillStyle = lg; g.fillRect(x, 0, 2, H * .8); }
  trianguloDorado(W * .1 + Math.sin(t * .7) * 14, H * .58 + Math.cos(t * .5) * 10, 34, .4 + t * .3, a * .85);
  trianguloDorado(W * .86 + Math.cos(t * .6) * 12, H * .4, 22, 2 - t * .4, a * .7);
  trianguloDorado(W * .24, H * .12 + Math.sin(t) * 8, 16, 1 + t * .5, a * .6);
  g.restore();
}
function trianguloDorado(x, y, s, rot, a) {
  if (a <= 0) return;
  g.save(); g.globalAlpha *= a; g.translate(x, y); g.rotate(rot); g.scale(1, .55);
  g.shadowColor = 'rgba(255,200,90,.95)'; g.shadowBlur = s * 1.2;
  const gr = g.createLinearGradient(-s, 0, s, 0); gr.addColorStop(0, '#fff6d8'); gr.addColorStop(1, '#ffb43a');
  g.fillStyle = gr; g.beginPath(); g.moveTo(-s, -s * .8); g.lineTo(s, 0); g.lineTo(-s * .6, s); g.closePath(); g.fill(); g.restore();
}
function candadoBrillo(cx, cy, s, abre, a) {
  g.save(); g.globalAlpha *= a; g.shadowColor = 'rgba(255,255,255,.95)'; g.shadowBlur = 16;
  g.strokeStyle = '#fff'; g.fillStyle = '#fff'; g.lineWidth = s * .13; g.lineCap = 'round';
  g.beginPath(); g.arc(cx, cy - s * .18 - abre * s * .35, s * .26, Math.PI, 0); g.stroke();
  g.beginPath(); g.roundRect(cx - s * .38, cy - s * .18, s * .76, s * .58, s * .1); g.fill();
  g.shadowColor = 'transparent'; g.fillStyle = '#c96a10'; g.beginPath(); g.arc(cx, cy + s * .08, s * .07, 0, 7); g.fill(); g.restore();
}
function ventanaTop5(t, detras = false) {
  const T = E.top5; if (!T || detras) return;
  const v = top5Activa(t); if (!v) return;
  const u = t - v[0], kOut = eInOut(clamp((t - v[1]) / .4)); if (u < 0 || kOut >= 1) return;
  const w = 1010, h = 320, x0 = (W - w) / 2, y0 = 150 - kOut * 140;
  // 1) barra delgada que cae  2) se abre a lo ancho  3) contenido
  const kc = eOut4(clamp(u / .16)), ka = eOut4(clamp((u - .12) / .38));
  const bw = lerp(54, w, ka), bh = lerp(h * 1.25 * kc, h, ka), x = W / 2 - bw / 2, y = y0 - (1 - kc) * 40;
  const r = lerp(18, 34, ka);
  g.save(); g.globalAlpha = 1 - kOut;
  g.shadowColor = 'rgba(255,130,20,.9)'; g.shadowBlur = 70;
  const fondo = g.createLinearGradient(0, y, 0, y + bh); fondo.addColorStop(0, '#ffa338'); fondo.addColorStop(.55, '#f58212'); fondo.addColorStop(1, '#e46a00');
  g.fillStyle = fondo; g.beginPath(); g.roundRect(x, y, bw, bh, r); g.fill(); g.shadowColor = 'transparent';
  const brillo = g.createRadialGradient(W / 2, y, 0, W / 2, y, bw * .6); brillo.addColorStop(0, 'rgba(255,240,200,.45)'); brillo.addColorStop(1, 'rgba(255,240,200,0)');
  g.fillStyle = brillo; g.beginPath(); g.roundRect(x, y, bw, bh, r); g.fill();
  g.shadowColor = 'rgba(255,200,90,1)'; g.shadowBlur = 24; g.strokeStyle = '#ffd27a'; g.lineWidth = 3.5; g.beginPath(); g.roundRect(x, y, bw, bh, r); g.stroke(); g.shadowColor = 'transparent';
  g.save(); g.beginPath(); g.roundRect(x, y, bw, bh, r); g.clip();
  // barra de título (más oscura) + semáforo + título que se escribe
  g.fillStyle = 'rgba(120,45,0,.22)'; g.fillRect(x, y, bw, 70);
  const kl = eOut(clamp((u - .85) / .25));
  [['#ff5f57', 0], ['#febc2e', 1], ['#28c840', 2]].forEach(([c, i]) => { g.globalAlpha = (1 - kOut) * kl; g.fillStyle = c; g.beginPath(); g.arc(x + 40 + i * 30, y + 36, 10, 0, 7); g.fill(); });
  g.globalAlpha = 1 - kOut;
  const tit = escribe('Top 5 Herramientas de IA', t, v[0] + .42, 46);
  g.fillStyle = '#fff'; g.font = `700 34px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.shadowColor = 'rgba(120,40,0,.5)'; g.shadowBlur = 8;
  g.fillText(tit, W / 2, y + 37); g.shadowColor = 'transparent'; g.textAlign = 'left';
  // casillas
  const n = 5, tam = 150, gap = (w - 90 - n * tam) / (n - 1);
  T.slots.forEach((S, i) => {
    const kp = clamp((u - .5 - i * .08) / .32); if (kp <= 0) return;
    const sc = easeBack(kp), tx = x0 + 45 + i * (tam + gap), ty = y + 112, cx = tx + tam / 2, cy = ty + tam / 2;
    const ku = clamp((t - S.en) / .5);
    g.save(); g.translate(cx, cy); g.scale(sc, sc); g.translate(-cx, -cy);
    g.shadowColor = 'rgba(110,40,0,.45)'; g.shadowBlur = 18; g.shadowOffsetY = 6;
    const gr = g.createLinearGradient(tx, ty, tx, ty + tam); gr.addColorStop(0, 'rgba(150,62,0,.55)'); gr.addColorStop(1, 'rgba(95,35,0,.6)');
    g.fillStyle = gr; g.beginPath(); g.roundRect(tx, ty, tam, tam, 30); g.fill(); g.shadowColor = 'transparent'; g.shadowOffsetY = 0;
    g.strokeStyle = 'rgba(255,225,170,.55)'; g.lineWidth = 2; g.beginPath(); g.roundRect(tx, ty, tam, tam, 30); g.stroke();
    const sk = ku > 0 ? eOut(ku) : 0;
    if (sk > 0) { g.save(); g.globalAlpha *= sk; g.beginPath(); g.roundRect(tx + 18, ty + 18, tam - 36, tam - 36, 20); g.clip(); dibujaLogo(S.logo, cx, cy, tam - 36); g.restore(); }
    if (sk < 1) candadoBrillo(cx, cy, 58, sk, 1 - sk);
    g.restore();
  });
  g.restore(); g.restore();
}

// ---------- escena: presentación de una herramienta (fondo oscuro, chispas naranjas, ícono brillando) ----------
// escena.herramienta = { logo, nombre, num }
function chispas(t, lt, n = 90) {
  for (let i = 0; i < n; i++) {
    const r = hash(i * 7.31), r2 = hash(i * 3.17), vel = 60 + r2 * 160;
    const x = (r * W + Math.sin(t * .8 + i) * 30) % W, y = H - ((t * vel + r2 * H * 1.3) % (H * 1.3));
    const tam = 1.5 + hash(i * 1.9) * 3.5, a = (.35 + .65 * hash(i * 5.5)) * clamp(1 - y / H + .3);
    g.fillStyle = `rgba(255,${150 + Math.round(r * 60)},60,${a.toFixed(2)})`; g.beginPath(); g.arc(x, y, tam, 0, 7); g.fill();
  }
  if (lt < .5) {  // estallido al entrar
    const k = lt / .5;
    for (let i = 0; i < 40; i++) {
      const ang = hash(i * 2.2) * 7, d = eOut(k) * (200 + hash(i * 4.4) * 500);
      g.fillStyle = `rgba(255,170,70,${(1 - k).toFixed(2)})`; g.beginPath(); g.arc(W / 2 + Math.cos(ang) * d, 980 + Math.sin(ang) * d, 3, 0, 7); g.fill();
    }
  }
}
function renderHerramienta(s, t, lt) {
  const Hh = s.herramienta;
  g.fillStyle = '#060403'; g.fillRect(0, 0, W, H);
  const rg = g.createRadialGradient(W / 2, H * .95, 50, W / 2, H * .95, 1100); rg.addColorStop(0, 'rgba(255,120,20,.55)'); rg.addColorStop(.5, 'rgba(160,60,10,.18)'); rg.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = rg; g.fillRect(0, 0, W, H);
  chispas(t, lt);
  const k = eOut4(clamp(lt / .55)), sc = lerp(.55, 1, k) * (1 + Math.sin(lt * 2.2) * .015), cy = 980 - (1 - k) * 80;
  const tam = 400, x = W / 2 - tam / 2, y = cy - tam / 2;
  g.save(); g.globalAlpha = clamp(k * 1.4); g.translate(W / 2, cy); g.rotate(Math.sin(lt * 1.3) * .03); g.scale(sc, sc); g.translate(-W / 2, -cy);
  g.filter = k < 1 ? `blur(${((1 - k) * 14).toFixed(1)}px)` : 'none';
  g.save(); g.shadowColor = 'rgba(255,130,30,.95)'; g.shadowBlur = 90 + Math.sin(lt * 3) * 20;
  const gr = g.createLinearGradient(x, y, x + tam, y + tam); gr.addColorStop(0, '#3a2412'); gr.addColorStop(1, '#140c06');
  g.fillStyle = gr; g.beginPath(); g.roundRect(x, y, tam, tam, 90); g.fill(); g.restore();
  halo5(x, y, tam, tam, 90, .85);
  // reflejo de vidrio
  const rf = g.createLinearGradient(x, y, x, y + tam); rf.addColorStop(0, 'rgba(255,255,255,.16)'); rf.addColorStop(.45, 'rgba(255,255,255,0)');
  g.fillStyle = rf; g.beginPath(); g.roundRect(x, y, tam, tam, 90); g.fill();
  const logos = Hh.logo.split('+');
  if (logos.length === 1) { g.save(); g.beginPath(); g.roundRect(x + 70, y + 70, tam - 140, tam - 140, 50); g.clip(); dibujaLogo(logos[0], W / 2, cy, tam - 140); g.restore(); }
  else logos.forEach((l, i) => { g.save(); const cx = W / 2 + (i ? 1 : -1) * 95; g.beginPath(); g.roundRect(cx - 85, cy - 85, 170, 170, 34); g.clip(); dibujaLogo(l, cx, cy, 170); g.restore(); });
  g.filter = 'none'; g.restore();
  // número y nombre
  const kn = eOut(clamp((lt - .15) / .4));
  g.save(); g.globalAlpha = kn; g.textAlign = 'center'; g.textBaseline = 'alphabetic';
  g.font = `300 120px ${FONT}`; g.strokeStyle = '#f0c35a'; g.lineWidth = 3; g.shadowColor = 'rgba(255,190,80,.8)'; g.shadowBlur = 24;
  g.strokeText(`#${Hh.num}`, W / 2, 700 - (1 - kn) * 30);
  g.shadowColor = 'rgba(255,140,40,.7)'; g.shadowBlur = 30; g.fillStyle = '#fff'; g.font = `700 92px ${FONT}`; g.letterSpacing = '-3px';
  g.fillText(Hh.nombre, W / 2, 1300 + (1 - kn) * 30); g.letterSpacing = '0px'; g.restore();
}

// ---------- escena: ícono 3D de la herramienta (como la referencia) ----------
// escena.icono3d = { nombre, logos: [{ n, en }] }  — el bloque sube desde abajo apagado, se enciende en naranja y queda
// girando poquito; el nombre aparece abajo. Fondo oscuro con brillo naranja, motas y triángulos dorados.
const TL = { scene: new THREE.Scene(), cam: new THREE.PerspectiveCamera(30, W / H, .1, 100) };
TL.scene.environment = ENV;
TL.cam.position.set(0, 0, 9); TL.cam.lookAt(0, 0, 0);
{ const k = new THREE.DirectionalLight('#fff4e6', 2.4); k.position.set(-3, 4, 7); TL.scene.add(k);
  const p = new THREE.PointLight('#ff8a1a', 40, 14); p.position.set(0, -3.5, 2.5); TL.scene.add(p);
  TL.scene.add(new THREE.AmbientLight('#ffffff', .3)); }
const GLIFO = { notebooklm: 'claro', higgsfield: 'oscuro', vscode: 'alfa', napkin: 'brillante', elevenlabs: 'oscuro', heygen: 'codigo' };
function glifoBlanco(n, S = 1024) {  // el logo en blanco puro sobre transparente, recortado y centrado
  const cv = document.createElement('canvas'); cv.width = cv.height = S; const x = cv.getContext('2d');
  if (GLIFO[n] === 'codigo' || !logo(n)) {
    const gg = g; const tmpc = document.createElement('canvas'); tmpc.width = tmpc.height = S; const y = tmpc.getContext('2d');
    // HeyGen: cuatro pétalos (mismo trazo que heygenGema) en blanco
    const cx = S / 2, s = S * .42;
    y.fillStyle = '#fff';
    for (const [dx, dy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) { y.beginPath(); y.moveTo(cx + dx * s * .12, cx + dy * s * .12); y.lineTo(cx + dx * s, cx + dy * s * .22); y.quadraticCurveTo(cx + dx * s, cx + dy * s, cx + dx * s * .22, cx + dy * s); y.closePath(); y.fill(); }
    return tmpc;
  }
  const im = logo(n), t = document.createElement('canvas'); t.width = t.height = 512; const y = t.getContext('2d', { willReadFrequently: true });
  y.drawImage(im, 0, 0, 512, 512); const d = y.getImageData(0, 0, 512, 512), p = d.data; let x0 = 512, y0 = 512, x1 = 0, y1 = 0;
  for (let i = 0; i < p.length; i += 4) {
    const r = p[i], gg = p[i + 1], b = p[i + 2], al = p[i + 3] / 255, mx = Math.max(r, gg, b), mn = Math.min(r, gg, b);
    let m = GLIFO[n] === 'claro' ? (255 - mn) / 110 : GLIFO[n] === 'oscuro' ? (170 - mx) / 90 : GLIFO[n] === 'brillante' ? (mx - 75) / 70 : 1;
    m = clamp(m) * al; p[i] = p[i + 1] = p[i + 2] = 255; p[i + 3] = Math.round(m * 255);
    if (m > .3) { const q = i / 4, px = q % 512, py = (q / 512) | 0; x0 = Math.min(x0, px); x1 = Math.max(x1, px); y0 = Math.min(y0, py); y1 = Math.max(y1, py); }
  }
  y.putImageData(d, 0, 0);
  const bw = x1 - x0, bh = y1 - y0, sc = S * .9 / Math.max(bw, bh);
  x.drawImage(t, x0, y0, bw, bh, S / 2 - bw * sc / 2, S / 2 - bh * sc / 2, bw * sc, bh * sc);
  return cv;
}
function buildBloque(n) {
  const S = 1024, cv = document.createElement('canvas'); cv.width = cv.height = S; const x = cv.getContext('2d');
  const gr = x.createLinearGradient(0, 0, S, S); gr.addColorStop(0, '#ffb01a'); gr.addColorStop(.5, '#ff8c00'); gr.addColorStop(1, '#e86200');
  x.fillStyle = gr; x.fillRect(0, 0, S, S);
  const rg = x.createRadialGradient(S * .35, S * .25, 0, S * .35, S * .25, S * .7); rg.addColorStop(0, 'rgba(255,230,150,.45)'); rg.addColorStop(1, 'rgba(255,230,150,0)');
  x.fillStyle = rg; x.fillRect(0, 0, S, S);
  const gl = glifoBlanco(n), L = S * .62;  // el glifo ocupa ~la mitad de la cara
  x.save(); x.globalAlpha = .45; x.filter = 'blur(6px)'; x.globalCompositeOperation = 'multiply';
  const sh = document.createElement('canvas'); sh.width = sh.height = gl.width; const sx = sh.getContext('2d'); sx.drawImage(gl, 0, 0); sx.globalCompositeOperation = 'source-in'; sx.fillStyle = '#a84300'; sx.fillRect(0, 0, sh.width, sh.height);
  x.drawImage(sh, S / 2 - L / 2 + 8, S / 2 - L / 2 + 14, L, L); x.restore();
  x.drawImage(gl, S / 2 - L / 2, S / 2 - L / 2, L, L);
  const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
  const ext = 1.16; tex.repeat.set(1 / (2 * ext), 1 / (2 * ext)); tex.offset.set(.5, .5);
  const geo = new THREE.ExtrudeGeometry(roundedSquare(1, .44), { depth: .5, bevelEnabled: true, bevelThickness: .16, bevelSize: .14, bevelSegments: 10, curveSegments: 40 });
  geo.translate(0, 0, -.25);
  const cara = new THREE.MeshPhysicalMaterial({ map: tex, emissiveMap: tex, emissive: '#ffffff', emissiveIntensity: 0, roughness: .22, clearcoat: 1, clearcoatRoughness: .1, envMapIntensity: 1.2 });
  const lado = new THREE.MeshPhysicalMaterial({ color: '#ff8a1a', emissive: '#ff7a10', emissiveIntensity: 0, roughness: .25, clearcoat: 1, clearcoatRoughness: .12, envMapIntensity: 1.2 });
  const m = new THREE.Mesh(geo, [cara, lado]); const grp = new THREE.Group(); grp.add(m); grp.userData = { cara, lado };
  grp.visible = false; TL.scene.add(grp); return grp;
}
function fondoHerramienta(t, lt) {
  g.fillStyle = '#070504'; g.fillRect(0, 0, W, H);
  const rg = g.createRadialGradient(W / 2, H * 1.08, 40, W / 2, H * 1.08, H * .78);
  rg.addColorStop(0, 'rgba(255,135,25,.85)'); rg.addColorStop(.45, 'rgba(200,80,10,.32)'); rg.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = rg; g.fillRect(0, 0, W, H);
  for (let i = 0; i < 46; i++) {  // motas desenfocadas que suben despacio
    const r = hash(i * 7.31), r2 = hash(i * 3.17), vel = 18 + r2 * 40, tam = 2 + hash(i * 1.9) * 9;
    const x = (r * W + Math.sin(t * .4 + i) * 40 + W) % W, y = H * 1.05 - ((t * vel + r2 * H * 1.2) % (H * 1.2));
    const a = (.25 + .6 * hash(i * 5.5)) * (.6 + .4 * Math.sin(t * 2 + i));
    g.save(); g.shadowColor = 'rgba(255,170,60,.9)'; g.shadowBlur = tam * 3; g.fillStyle = `rgba(255,${170 + Math.round(r * 60)},80,${a.toFixed(2)})`;
    g.beginPath(); g.arc(x, y, tam, 0, 7); g.fill(); g.restore();
  }
  trianguloDorado(W * .2 + Math.sin(t * .5) * 20, H * .86 - lt * 12, 46, -.35 + Math.sin(t * .6) * .15, 1);
  trianguloDorado(W * .9 + Math.cos(t * .4) * 14, H * .66 - lt * 8, 24, 2.6 + t * .2, .8);
  trianguloDorado(W * .12, H * .3 + Math.sin(t * .7) * 10, 16, 1.2 + t * .3, .7);
  trianguloDorado(W * .55, H * .93, 18, .3 - t * .25, .6);
}
function renderIcono3d(s, t, lt) {
  const I = s.icono3d;
  fondoHerramienta(t, lt);
  const n = I.logos.length, base = n > 1 ? .42 : .62, sep = n > 1 ? .66 : 0, cy = .26;
  TL.scene.children.forEach(o => { if (o.userData.cara) o.visible = false; });
  let lit = 0;
  I.logos.forEach((L, i) => {
    const o = L.obj, d = t - L.en; if (d < -.02) return;
    o.visible = true;
    const k = clamp(d / .8), up = easeBack(k), li = eOut(clamp((d - .12) / .55)); lit = Math.max(lit, li);
    const fx = n > 1 ? (i ? sep : -sep) : 0;
    o.position.set(lerp(fx * .6, fx, eOut(k)), lerp(-3.6, cy, up) + Math.sin(d * 1.5) * .04 * k, 0);
    o.rotation.x = (1 - eOut(k)) * 1.1 + .1 + Math.sin(d * 1.2) * .1;
    o.rotation.y = (1 - eOut(k)) * (i ? .9 : -.9) + Math.sin(d * 1.05 + i) * .3;
    o.rotation.z = (1 - eOut(k)) * (i ? -.35 : .35) + Math.sin(d * .8 + i) * .05;
    o.scale.setScalar(base);
    const { cara, lado } = o.userData;
    cara.color.setScalar(lerp(.12, 1, li)); cara.emissiveIntensity = .28 * li;
    lado.color.set('#ff8a1a').multiplyScalar(lerp(.15, 1, li)); lado.emissiveIntensity = .35 * li;
  });
  R3.setClearColor(0, 0); R3.render(TL.scene, TL.cam);
  g.save(); g.globalCompositeOperation = 'screen'; g.filter = 'blur(46px)'; g.globalAlpha = .9 * lit; g.drawImage(c3, 0, 0); g.restore();
  g.drawImage(c3, 0, 0);
  // nombre con brillo metálico
  const kn = eOut(clamp((lt - .35) / .5)); if (kn <= 0) return;
  const yN = H * .5 - cy / 2.41 * H * .5 + 330 + (1 - kn) * 40;
  g.save(); g.globalAlpha = kn; g.textAlign = 'center'; g.textBaseline = 'alphabetic';
  const tam = I.nombre.length > 12 ? 96 : 112;
  g.font = `700 ${tam}px ${FONT}`; g.letterSpacing = '-2px';
  g.filter = kn < 1 ? `blur(${((1 - kn) * 10).toFixed(1)}px)` : 'none';
  g.shadowColor = 'rgba(255,150,50,.55)'; g.shadowBlur = 30;
  const lineas = I.nombre.split('\n');
  lineas.forEach((l, j) => {
    const yy = yN + j * tam * 1.02;
    const mg = g.createLinearGradient(0, yy - tam, 0, yy + 10); mg.addColorStop(0, '#ffffff'); mg.addColorStop(.55, '#d9d4cf'); mg.addColorStop(1, '#8d8580');
    g.fillStyle = mg; g.fillText(l, W / 2, yy);
  });
  g.letterSpacing = '0px'; g.restore();
}
// quemado de luz naranja al entrar a una herramienta (como la referencia)
function quemaduras(t) {
  for (const s of E.escenas) {
    if (s.trans !== 'quemado') continue;
    const d = t - s.ini; if (d < -.3 || d > .4) continue;
    const a = d < 0 ? eInOut(prog(d, -.3, 0)) : 1 - eOut(prog(d, 0, .4));
    g.save(); g.globalCompositeOperation = 'screen'; g.globalAlpha = a;
    const lg = g.createLinearGradient(0, H, W, 0); lg.addColorStop(0, '#ff5a00'); lg.addColorStop(.5, '#ff9a2a'); lg.addColorStop(1, '#ffe08a');
    g.fillStyle = lg; g.fillRect(0, 0, W, H);
    const rg = g.createRadialGradient(W * .7, H * .35, 0, W * .7, H * .35, H * .5); rg.addColorStop(0, 'rgba(255,250,220,.9)'); rg.addColorStop(1, 'rgba(255,250,220,0)');
    g.fillStyle = rg; g.fillRect(0, 0, W, H);
    g.globalCompositeOperation = 'source-over'; g.globalAlpha = a * .5; g.strokeStyle = 'rgba(60,20,0,.6)'; g.lineWidth = 2;
    for (let i = 0; i < 4; i++) { g.beginPath(); const y0 = hash(i + Math.floor(t * 24)) * H; g.moveTo(0, y0); g.bezierCurveTo(W * .3, y0 - 120, W * .6, y0 + 140, W, y0 - 40); g.stroke(); }
    g.restore();
  }
}

// ---------- lista de herramientas (formato "usa estas herramientas gratis") ----------
// escena.lista = { titulo, en, fin, items: [[nombre, logo], ...], paso }  — título amarillo arriba, columna a la derecha
// (nombre + ficha blanca con logo), cada renglón entra con desliz desde la derecha. Respeta la zona segura (x < 890).
function fichaLogo(n, nombre, x, y, s) {
  g.save(); g.shadowColor = 'rgba(0,0,0,.35)'; g.shadowBlur = 14; g.shadowOffsetY = 4;
  g.fillStyle = '#ffffff'; g.beginPath(); g.roundRect(x, y, s, s, s * .24); g.fill(); g.restore();
  g.save(); g.beginPath(); g.roundRect(x, y, s, s, s * .24); g.clip();
  const im = logo(n);
  if (n === 'heygen' && !im) heygenGema(x + s / 2, y + s / 2, s * .36);
  else if (im) { const m = s * .1; g.drawImage(im, x + m, y + m, s - 2 * m, s - 2 * m); }
  else {  // sin logo oficial: iniciales
    const gr = g.createLinearGradient(x, y, x + s, y + s); gr.addColorStop(0, '#2b2d42'); gr.addColorStop(1, '#5a3fd1');
    g.fillStyle = gr; g.fillRect(x, y, s, s); g.fillStyle = '#fff'; g.font = `800 ${Math.round(s * .38)}px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(nombre.replace(/[^A-Z]/g, '').slice(0, 2) || nombre.slice(0, 2), x + s / 2, y + s / 2 + 2); g.textAlign = 'left';
  }
  g.restore();
}
function listaHerramientas(s, t) {
  const L = s.lista; if (!L || t < L.en - .05 || t > L.fin + .35) return;
  const ko = eInOut(clamp((t - L.fin) / .3));
  // título amarillo con contorno oscuro (como la referencia)
  const kt = eOut4(clamp((t - L.en) / .35));
  g.save(); g.globalAlpha = kt * (1 - ko); g.textAlign = 'center'; g.textBaseline = 'alphabetic';
  const ty = (L.y || 330) - (1 - kt) * 60 - ko * 50;
  g.font = `900 ${L.tam || 82}px ${FONT}`; g.letterSpacing = '-2px';
  g.filter = kt < 1 ? `blur(${((1 - kt) * 8).toFixed(1)}px)` : 'none';
  g.lineJoin = 'round'; g.strokeStyle = 'rgba(20,14,0,.9)'; g.lineWidth = 12; g.strokeText(L.titulo, W / 2, ty);
  g.shadowColor = 'rgba(255,200,0,.55)'; g.shadowBlur = 24; g.fillStyle = '#ffe11a'; g.fillText(L.titulo, W / 2, ty);
  g.letterSpacing = '0px'; g.restore();
  // renglones
  // lado 'der' (default): nombre + ficha pegados a x 888; lado 'izq': ficha en x 48 + nombre a su derecha
  const S = 66, izq = L.lado === 'izq', xL = izq ? 48 : 822, y0 = (L.y || 330) + 62, dy = 88, paso = L.paso || .11, sg = izq ? -1 : 1;
  L.items.forEach(([nombre, n], i) => {
    const k = eOut4(clamp((t - L.en - .2 - i * paso) / .28)); if (k <= 0) return;
    const y = y0 + i * dy, dx = sg * ((1 - k) * 90 + ko * (120 + i * 14));
    g.save(); g.globalAlpha = k * (1 - ko);
    fichaLogo(n, nombre, xL + dx, y, S);
    const xt = izq ? xL + S + 16 + dx : xL - 16 + dx;
    g.font = `700 36px ${FONT}`; g.textAlign = izq ? 'left' : 'right'; g.textBaseline = 'middle';
    g.lineJoin = 'round'; g.strokeStyle = 'rgba(0,0,0,.55)'; g.lineWidth = 6; g.strokeText(nombre, xt, y + S / 2 + 1);
    g.shadowColor = 'rgba(0,0,0,.6)'; g.shadowBlur = 10; g.fillStyle = '#fff'; g.fillText(nombre, xt, y + S / 2 + 1);
    g.restore();
  });
}
// escena.pregunta = { en, fin, texto, y } — sticker de "pregunta" de Instagram (barra oscura con ⤵︎ + caja blanca)
function preguntaIG(s, t) {
  const P = s.pregunta; if (!P || t < P.en - .02 || t > P.fin + .35) return;
  const ki = clamp((t - P.en) / .42), ko = eInOut(clamp((t - P.fin) / .3));
  const sc = easeBack(ki) * (1 - ko * .35), a = clamp(ki * 3) * (1 - ko);
  const w = P.w || 860, cx = W / 2, cy = (P.y || 520) - ko * 120;
  g.save(); g.font = `500 50px -apple-system, "SF Pro Display", ${FONT}`;
  // cortar el texto en renglones
  const pal = P.texto.split(' '), lin = []; let l = '';
  for (const p of pal) { const prueba = l ? l + ' ' + p : p; if (g.measureText(prueba).width > w - 110 && l) { lin.push(l); l = p; } else l = prueba; }
  if (l) lin.push(l);
  const hb = 96, hc = 70 + lin.length * 64, h = hb + hc, x = cx - w / 2, y = cy - h / 2;
  g.globalAlpha = a; g.translate(cx, cy); g.scale(sc, sc); g.rotate((1 - ki) * -.06); g.translate(-cx, -cy);
  g.shadowColor = 'rgba(0,0,0,.35)'; g.shadowBlur = 40; g.shadowOffsetY = 14;
  g.fillStyle = '#fff'; g.beginPath(); g.roundRect(x, y, w, h, 30); g.fill(); g.shadowColor = 'transparent';
  g.save(); g.beginPath(); g.roundRect(x, y, w, h, 30); g.clip();
  g.fillStyle = '#1a1f29'; g.fillRect(x, y, w, hb);
  // icono ⤵︎ en cuadrito azul (como el emoji del sticker)
  const ic = 50, ix = cx - ic / 2, iy = y + hb / 2 - ic / 2;
  const gi = g.createLinearGradient(0, iy, 0, iy + ic); gi.addColorStop(0, '#8fb5e8'); gi.addColorStop(1, '#5a86c6');
  g.fillStyle = gi; g.beginPath(); g.roundRect(ix, iy, ic, ic, 10); g.fill();
  g.strokeStyle = '#fff'; g.lineWidth = 6; g.lineCap = 'round'; g.lineJoin = 'round';
  g.beginPath(); g.moveTo(ix + 13, iy + 15); g.lineTo(ix + 30, iy + 15); g.quadraticCurveTo(ix + 34, iy + 15, ix + 34, iy + 20); g.lineTo(ix + 34, iy + 37); g.stroke();
  g.beginPath(); g.moveTo(ix + 26, iy + 30); g.lineTo(ix + 34, iy + 38); g.lineTo(ix + 42, iy + 30); g.stroke();
  g.restore();
  g.fillStyle = '#262626'; g.textAlign = 'center'; g.textBaseline = 'middle';
  lin.forEach((tx, i) => g.fillText(tx, cx, y + hb + 35 + 32 + i * 64));
  g.restore();
}
// escena.tecleo = { en, lineas: ['chica', 'grande'], vel, fin } — frase que se escribe letra por letra (sin voz)
function tecleo(s, t) {
  const K = s.tecleo; if (!K || t < K.en || t > K.fin + .3) return;
  const ko = eInOut(clamp((t - K.fin) / .3)), vel = K.vel || 26;
  const total = K.lineas.join(' '); const vis = escribe(total, t, K.en, vel);
  let resto = vis.length; const y = K.y || 1330;
  g.save(); g.globalAlpha = 1 - ko; g.textAlign = 'center'; g.textBaseline = 'alphabetic';
  // velo oscuro suave detrás del texto para que se lea sobre la pared
  const vg = g.createLinearGradient(0, y - 200, 0, y + 140); vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(.5, 'rgba(0,0,0,.42)'); vg.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = vg; g.fillRect(0, y - 200, W, 340);
  K.lineas.forEach((l, j) => {
    const n = Math.max(0, Math.min(l.length, resto)); resto -= l.length + 1; if (n <= 0 && j > 0) return;
    const txt = l.slice(0, n), grande = j === K.lineas.length - 1;
    g.font = grande ? `800 70px ${FONT}` : `500 44px ${FONT}`; g.letterSpacing = grande ? '-2px' : '0px';
    const yy = grande ? y + 40 : y - 50;
    g.shadowColor = 'rgba(0,0,0,.7)'; g.shadowBlur = 18; g.fillStyle = grande ? '#ffe11a' : '#fff'; g.fillText(txt, W / 2, yy);
    const escribiendo = vis.length < total.length && resto < 0 && n < l.length + 1;
    if (escribiendo && Math.floor(t * 3) % 2 === 0) { const w = g.measureText(txt).width; g.fillStyle = '#fff'; g.fillRect(W / 2 + w / 2 + 6, yy - (grande ? 58 : 38), 5, grande ? 66 : 44); }
  });
  g.letterSpacing = '0px'; g.restore();
}
// escena.lluvia = { en, fin, logos: [...] } — logos que caen detrás de ti
function lluviaLogos(s, t) {
  const R = s.lluvia; if (!R || t < R.en || t > R.fin + .6) return;
  const a = clamp((t - R.en) / .3) * (1 - clamp((t - R.fin) / .5)), ls = R.logos;
  for (let i = 0; i < 44; i++) {
    const n = ls[i % ls.length], r = hash(i * 3.7), vel = 520 + hash(i * 1.3) * 520, tam = 70 + hash(i * 9.1) * 70;
    const t0 = R.en + hash(i * 5.3) * 1.6, d = t - t0; if (d < 0) continue;
    const x = 40 + r * (W - 80), y = -tam + d * vel; if (y > H + 40) continue;
    g.save(); g.globalAlpha = a * .95; g.translate(x, y); g.rotate((hash(i * 2.9) - .5) * 1.2 + d * (hash(i) - .5) * 2);
    fichaLogo(n, n.toUpperCase(), -tam / 2, -tam / 2, tam); g.restore();
  }
}
function rejillaVentana(t, a0, b0) {  // misma rejilla naranja del Top 5, para otros formatos
  const v = [a0, b0], a = clamp((t - v[0]) / .3) * (1 - clamp((t - v[1]) / .5)); if (a <= 0) return;
  const T = E.top5; E.top5 = { veces: [v], slots: [] }; try { rejillaTop5(t); } finally { E.top5 = T; }
}

// ---------- demos sobre la persona ----------
function tarjetaVideo(x, y, w, h, k) {
  g.save(); g.globalAlpha *= k; g.fillStyle = '#151515'; g.beginPath(); g.roundRect(x, y, w, h, 18); g.fill();
  g.fillStyle = '#2b2b2b'; g.beginPath(); g.roundRect(x + 12, y + 12, w - 24, h * .62, 12); g.fill();
  g.fillStyle = '#ff2b2b'; g.beginPath(); g.roundRect(x + w / 2 - 34, y + 12 + h * .31 - 24, 68, 48, 14); g.fill();
  g.fillStyle = '#fff'; g.beginPath(); g.moveTo(x + w / 2 - 10, y + 12 + h * .31 - 13); g.lineTo(x + w / 2 + 14, y + 12 + h * .31); g.lineTo(x + w / 2 - 10, y + 12 + h * .31 + 13); g.fill();
  g.fillStyle = '#3a3a3a'; g.fillRect(x + 16, y + h * .74, w * .7, 12); g.fillRect(x + 16, y + h * .86, w * .45, 10); g.restore();
}
function tarjetaPDF(x, y, w, h, k) {
  g.save(); g.globalAlpha *= k; g.fillStyle = '#f4f4f4'; g.beginPath(); g.roundRect(x, y, w, h, 14); g.fill();
  g.fillStyle = '#e5322d'; g.beginPath(); g.roundRect(x + 14, y + 14, 70, 34, 8); g.fill();
  g.fillStyle = '#fff'; g.font = `800 22px ${FONT}`; g.fillText('PDF', x + 26, y + 39);
  g.fillStyle = '#cfcfcf'; for (let i = 0; i < 6; i++) g.fillRect(x + 14, y + 64 + i * 18, (w - 28) * (i % 3 === 2 ? .6 : .92), 9); g.restore();
}
function panelDemo(x, y, w, h, a) {
  g.save(); g.globalAlpha = a; g.shadowColor = 'rgba(0,0,0,.45)'; g.shadowBlur = 40; g.fillStyle = 'rgba(14,11,9,.9)';
  g.beginPath(); g.roundRect(x, y, w, h, 30); g.fill(); g.restore(); g.save(); g.globalAlpha = a; halo5(x, y, w, h, 30, .55); g.restore();
}
// escena.nb1 = { en, fin, preguntas: [t, t, t] }  → video entra a NotebookLM y salen preguntas
function demoNotebook1(s, t) {
  const D = s.nb1; if (!D || t < D.en - .05 || t > D.fin + .4) return;
  const a = eOut4(clamp((t - D.en) / .4)) * (1 - eInOut(clamp((t - D.fin) / .35)));
  const x = 70, y = 300, w = 820, h = 380; panelDemo(x, y, w, h, a);
  g.save(); g.globalAlpha = a;
  const kv = eOut4(clamp((t - D.en - .1) / .5)); tarjetaVideo(x + 40 - (1 - kv) * 60, y + 80, 240, 210, kv);
  const kf = clamp((t - D.en - .45) / .5); g.strokeStyle = NARANJA; g.lineWidth = 6; g.setLineDash([14, 12]); g.lineDashOffset = -t * 60;
  g.beginPath(); g.moveTo(x + 300, y + 185); g.lineTo(x + 300 + 110 * kf, y + 185); g.stroke(); g.setLineDash([]);
  g.save(); g.beginPath(); g.roundRect(x + 430, y + 115, 140, 140, 30); g.fillStyle = '#fff'; g.fill(); g.clip(); dibujaLogo('notebooklm', x + 500, y + 185, 120); g.restore();
  D.preguntas.forEach((tp, i) => {
    const kq = eOut4(clamp((t - tp) / .35)); if (kq <= 0) return;
    const bx = x + 610, by = y + 60 + i * 95 + (1 - kq) * 30;
    g.globalAlpha = a * kq; g.fillStyle = i % 2 ? '#ff8a1f' : '#f4e9dc'; g.beginPath(); g.roundRect(bx, by, 170, 74, 37); g.fill();
    g.fillStyle = i % 2 ? '#fff' : '#111'; g.font = `800 44px ${FONT}`; g.textAlign = 'center'; g.fillText(['¿?', '¿cómo?', '¿por qué?'][i] || '¿?', bx + 85, by + 52); g.textAlign = 'left';
  });
  g.restore();
}
// escena.nb2 = { en, video, pdf, podcast, fin } → video y PDF entran, sale "Podcast" con onda
function demoNotebook2(s, t) {
  const D = s.nb2; if (!D || t < D.en - .05 || t > D.fin + .4) return;
  const a = eOut4(clamp((t - D.en) / .4)) * (1 - eInOut(clamp((t - D.fin) / .35)));
  const x = 70, y = 300, w = 820, h = 380; panelDemo(x, y, w, h, a);
  g.save(); g.globalAlpha = a;
  const cx = x + w / 2, cy = y + 150;
  g.save(); g.beginPath(); g.roundRect(cx - 70, cy - 70, 140, 140, 30); g.fillStyle = '#fff'; g.fill(); g.clip(); dibujaLogo('notebooklm', cx, cy, 120); g.restore();
  const entra = (t0, x0, dibuja) => { const k = eInOut(clamp((t - t0) / .7)); if (t < t0) return; const xx = lerp(x0, cx - 60, k), sc = lerp(1, .3, k); g.save(); g.globalAlpha = a * (1 - clamp((k - .85) / .15)); g.translate(xx, cy); g.scale(sc, sc); dibuja(); g.restore(); };
  entra(D.video, x + 40, () => tarjetaVideo(-90, -80, 180, 160, 1));
  entra(D.pdf, x + w - 200, () => tarjetaPDF(-70, -90, 140, 180, 1));
  const kp = eOut4(clamp((t - D.podcast) / .45));
  if (kp > 0) {
    const px = x + 110, py = y + 250 + (1 - kp) * 30;
    g.globalAlpha = a * kp; g.fillStyle = '#f4e9dc'; g.beginPath(); g.roundRect(px, py, w - 220, 100, 26); g.fill();
    g.fillStyle = '#111'; g.font = `700 36px ${FONT}`; g.fillText('🎧 Podcast', px + 26, py + 62);
    g.fillStyle = NARANJA; for (let i = 0; i < 26; i++) { const hh = 10 + 34 * Math.abs(Math.sin(t * 7 + i * .9) * Math.sin(t * 2.3 + i * 1.7)); g.fillRect(px + 250 + i * 13, py + 50 - hh / 2, 7, hh); }
  }
  g.restore();
}
// escena.prompt5 = { en, fin, texto } → barra de prompt escribiéndose (arriba)
function barraPrompt(s, t) {
  const P = s.prompt5; if (!P || t < P.en - .05 || t > P.fin + .3) return;
  const a = eOut4(clamp((t - P.en) / .35)) * (1 - eInOut(clamp((t - P.fin) / .3)));
  const x = 70, y = 300, w = 820, h = 110; panelDemo(x, y, w, h, a);
  g.save(); g.globalAlpha = a; g.save(); g.beginPath(); g.roundRect(x + 22, y + 22, 66, 66, 16); g.clip(); dibujaLogo('higgsfield', x + 55, y + 55, 66); g.restore();
  const n = Math.floor(P.texto.length * clamp((t - P.en - .2) / 1.4));
  g.fillStyle = '#f4e9dc'; g.font = `500 34px ${FONT}`; g.fillText(P.texto.slice(0, n) + (Math.floor(t * 3) % 2 ? '|' : ''), x + 110, y + 67); g.restore();
}
// escena.fondos = [{en, tipo}] → tu fondo cambia detrás de ti (recorte con la máscara)
function fondoGenerado(tipo, t) {
  if (tipo === 'playa') {
    const gr = g.createLinearGradient(0, 0, 0, H); gr.addColorStop(0, '#ff7e5f'); gr.addColorStop(.45, '#feb47b'); gr.addColorStop(.55, '#2b6ca3'); gr.addColorStop(1, '#0d2f4f');
    g.fillStyle = gr; g.fillRect(0, 0, W, H); g.fillStyle = '#fff3c4'; g.beginPath(); g.arc(W * .7, H * .42, 120, 0, 7); g.fill();
    g.strokeStyle = 'rgba(255,255,255,.35)'; g.lineWidth = 3; for (let i = 0; i < 14; i++) { const yy = H * .56 + i * 40; g.beginPath(); g.moveTo(0, yy + Math.sin(t * 2 + i) * 6); g.lineTo(W, yy + Math.cos(t * 2 + i) * 6); g.stroke(); }
  } else if (tipo === 'ciudad') {
    const gr = g.createLinearGradient(0, 0, 0, H); gr.addColorStop(0, '#12002b'); gr.addColorStop(.5, '#3a0050'); gr.addColorStop(1, '#090014'); g.fillStyle = gr; g.fillRect(0, 0, W, H);
    for (let i = 0; i < 22; i++) { const bw = 50 + hash(i) * 90, bh = 300 + hash(i * 3) * 700, bx = i * 52 - 40; g.fillStyle = `rgba(${40 + i * 3},10,${90 + i * 4},.95)`; g.fillRect(bx, H * .62 - bh, bw, bh);
      g.fillStyle = 'rgba(255,90,220,.7)'; for (let j = 0; j < 12; j++) if (hash(i * 31 + j) > .55) g.fillRect(bx + 10 + (j % 3) * 14, H * .62 - bh + 20 + Math.floor(j / 3) * 40, 8, 14); }
    g.strokeStyle = 'rgba(0,240,255,.6)'; g.lineWidth = 2; for (let i = 0; i < 16; i++) { const yy = H * .62 + Math.pow(i / 16, 2) * H * .4 + (t * 40 % 30); g.beginPath(); g.moveTo(0, yy); g.lineTo(W, yy); g.stroke(); }
  } else {
    g.fillStyle = '#03030c'; g.fillRect(0, 0, W, H);
    for (let i = 0; i < 260; i++) { g.fillStyle = `rgba(255,255,255,${(.3 + .7 * hash(i * 9.1)) * (.6 + .4 * Math.sin(t * 3 + i))})`; g.fillRect(hash(i * 1.3) * W, hash(i * 2.7) * H, 2, 2); }
    const gr = g.createRadialGradient(W * .3, H * .35, 20, W * .3, H * .35, 260); gr.addColorStop(0, '#ffb36b'); gr.addColorStop(.6, '#b2452a'); gr.addColorStop(1, '#3a0d06'); g.fillStyle = gr; g.beginPath(); g.arc(W * .3, H * .35, 230, 0, 7); g.fill();
  }
}
// escena.clones = { en, fin } → dos copias tuyas a los lados con escaneo "AVATAR IA"
const CL = document.createElement('canvas'), cl = CL.getContext('2d');
function recorte(f, m) {  // tu silueta sola (sin fondo) en un canvas del tamaño del lienzo
  CL.width = W; CL.height = H; cl.clearRect(0, 0, W, H); cl.filter = 'blur(1px)'; cl.drawImage(mascaraAlfa(m), 0, 0, W, H); cl.filter = 'none';
  cl.globalCompositeOperation = 'source-in'; cl.drawImage(f, 0, 0, W, H); cl.globalCompositeOperation = 'source-over'; return CL;
}
function capasPersona(s, t, f, m, cam) {
  const F = s.fondos;
  if (F) {
    const i = F.findLastIndex(x => t >= x.en);
    if (i >= 0 && t < (s.fondosFin ?? 1e9)) {
      const k = eOut(clamp((t - F[i].en) / .25));
      g.save(); cam(); g.globalAlpha = k; fondoGenerado(F[i].tipo, t); g.globalAlpha = 1; g.drawImage(recorte(f, m), 0, E.persona.bajar); g.restore();
      if (k < 1 || t - F[i].en < .15) { g.save(); g.globalAlpha = (1 - k) * .8; g.fillStyle = '#fff'; g.fillRect(0, 0, W, H); g.restore(); }
    }
  }
  const C = s.clones;
  if (C && t >= C.en - .05 && t < C.fin + .3) {
    const a = eOut4(clamp((t - C.en) / .5)) * (1 - eInOut(clamp((t - C.fin) / .3))), R = recorte(f, m);
    for (const lado of [-1, 1]) {
      const sc = .56, dx = lado * 370 * a, x = W / 2 + dx - W * sc / 2, y = H * .27 + E.persona.bajar * .4;
      g.save(); g.globalAlpha = a * .92; g.filter = 'hue-rotate(160deg) saturate(1.6) brightness(1.1)'; g.drawImage(R, x, y, W * sc, H * sc); g.filter = 'none';
      // líneas de escaneo
      g.globalCompositeOperation = 'source-atop'; g.fillStyle = 'rgba(0,240,255,.18)';
      for (let yy = y; yy < y + H * sc; yy += 8) g.fillRect(x, yy, W * sc, 3);
      const sy = y + ((t * 300) % (H * sc)); g.fillStyle = 'rgba(0,255,255,.55)'; g.fillRect(x, sy, W * sc, 6); g.restore();
      g.save(); g.globalAlpha = a; g.fillStyle = 'rgba(0,30,40,.85)'; g.font = `700 30px ${FONT}`; const tw = g.measureText('AVATAR IA').width;
      const lx = W / 2 + dx - tw / 2 - 18, ly = H * .27 + H * sc * .2; g.beginPath(); g.roundRect(lx, ly, tw + 36, 52, 26); g.fill();
      g.strokeStyle = '#00f0ff'; g.lineWidth = 2; g.stroke(); g.fillStyle = '#9ffcff'; g.fillText('AVATAR IA', lx + 18, ly + 36); g.restore();
    }
    g.save(); cam(); g.drawImage(R, 0, E.persona.bajar); g.restore();  // tú adelante de tus clones
  }
}

// ---------- escena: editor de código (VS Code) con Claude Code en la terminal ----------
// escena.vscode = { escribe, banner, pestanas: [t, t] }
const CODIGO = [['import', 'cine'], ['const', 'edit = await claude(video)'], ['//', 'plantilla: Saúl Pro'], ['export', 'function render() {'], ['  ', 'return montaje(cortes, subtitulos)'], ['}', ''], ['', ''], ['const', 'agente = nuevoAgente("ventas")'], ['await', 'agente.responder(cliente)']];
function renderVSCode(s, t, lt) {
  const V = s.vscode; g.fillStyle = '#0b0b0f'; g.fillRect(0, 0, W, H);
  const k = eOut4(clamp(lt / .45)), x = 50, y = 300 + (1 - k) * 80, w = 980, h = 940;
  g.save(); g.globalAlpha = k;
  g.shadowColor = 'rgba(0,120,215,.45)'; g.shadowBlur = 60; g.fillStyle = '#1e1e1e'; g.beginPath(); g.roundRect(x, y, w, h, 22); g.fill(); g.shadowColor = 'transparent';
  g.fillStyle = '#323233'; g.beginPath(); g.roundRect(x, y, w, 56, [22, 22, 0, 0]); g.fill();
  [['#ff5f57', 0], ['#febc2e', 1], ['#28c840', 2]].forEach(([c, i]) => { g.fillStyle = c; g.beginPath(); g.arc(x + 30 + i * 24, y + 28, 8, 0, 7); g.fill(); });
  g.save(); g.beginPath(); g.rect(x + w / 2 - 30, y + 10, 36, 36); g.clip(); dibujaLogo('vscode', x + w / 2 - 12, y + 28, 34); g.restore();
  g.fillStyle = '#ccc'; g.font = `500 24px ${FONT}`; g.fillText('Visual Studio Code', x + w / 2 + 14, y + 36);
  // barra lateral con extensiones
  g.fillStyle = '#252526'; g.fillRect(x, y + 56, 90, h - 56);
  const ext = [['claude', V.pestanas[0]], ['openai', V.pestanas[1]]];
  ext.forEach(([n, te], i) => { const ke = eOut4(clamp((t - te) / .35)); if (ke <= 0) return; const cx = x + 45, cy = y + 120 + i * 90;
    g.save(); g.globalAlpha = k * ke; g.fillStyle = '#3a3a3a'; g.beginPath(); g.roundRect(cx - 30, cy - 30, 60, 60, 14); g.fill();
    if (n === 'claude') logoClaude(cx, cy, 40, 0); else { g.fillStyle = '#fff'; g.font = `700 30px ${FONT}`; g.textAlign = 'center'; g.fillText('⌘', cx, cy + 10); g.textAlign = 'left'; } g.restore(); });
  // pestañas
  const tabs = [['Claude Code', V.pestanas[0]], ['Codex', V.pestanas[1]], ['+ IA', V.pestanas[2] ?? 1e9]];
  let tx = x + 100;
  tabs.forEach(([n, te]) => { const kt = eOut4(clamp((t - te) / .3)); if (kt <= 0) return; g.font = `600 24px ${FONT}`; const tw = g.measureText(n).width + 40;
    g.save(); g.globalAlpha = k * kt; g.fillStyle = '#2d2d2d'; g.fillRect(tx, y + 56, tw, 50); g.fillStyle = NARANJA; g.fillRect(tx, y + 56, tw, 3);
    g.fillStyle = '#eee'; g.fillText(n, tx + 20, y + 89); g.restore(); tx += tw + 4; });
  // código
  g.font = `500 26px Menlo, monospace`;
  CODIGO.forEach(([kw, rest], i) => { const kl = clamp((lt - .2 - i * .08) / .2); if (kl <= 0) return; const ly = y + 160 + i * 42;
    g.globalAlpha = k * kl; g.fillStyle = '#5a5a5a'; g.fillText(String(i + 1).padStart(2), x + 108, ly);
    g.fillStyle = '#c586c0'; g.fillText(kw, x + 160, ly); g.fillStyle = '#9cdcfe'; g.fillText(rest, x + 160 + g.measureText(kw + ' ').width, ly); });
  g.globalAlpha = k;
  // terminal
  const ty = y + 520; g.fillStyle = '#181818'; g.fillRect(x + 90, ty, w - 90, h - 520); g.fillStyle = '#ccc'; g.font = `600 22px ${FONT}`; g.fillText('TERMINAL', x + 110, ty + 34);
  g.font = `500 30px Menlo, monospace`; const cmd = 'claude', n = Math.floor(cmd.length * clamp((t - V.escribe) / .5));
  g.fillStyle = '#4ec9b0'; g.fillText('saul@mac ~ %', x + 110, ty + 90); g.fillStyle = '#fff'; g.fillText(cmd.slice(0, n) + (Math.floor(t * 3) % 2 ? '▌' : ''), x + 360, ty + 90);
  const kb = clamp((t - V.banner) / .45);
  if (kb > 0) {  // banner pixeleado de Claude Code dentro de la terminal
    const esc = 7, pw = 96, ph = 46; PX.width = pw; PX.height = ph; px.clearRect(0, 0, pw, ph); px.font = `900 20px Menlo, monospace`; px.textBaseline = 'top';
    ['CLAUDE', 'CODE'].forEach((l, i) => { px.fillStyle = '#7a3b22'; px.fillText(l, 3, 3 + i * 21); px.fillStyle = '#e07a52'; px.fillText(l, 2, 2 + i * 21); });
    g.save(); g.beginPath(); g.rect(x + 110, ty + 120, (pw * esc) * kb, ph * esc); g.clip(); g.imageSmoothingEnabled = false; g.drawImage(PX, x + 110, ty + 120, pw * esc, ph * esc); g.imageSmoothingEnabled = true; g.restore();
    g.fillStyle = '#9a9a9a'; g.font = `500 24px Menlo, monospace`; g.globalAlpha = k * clamp((t - V.banner - .4) / .3); g.fillText('✻ Welcome to Claude Code', x + 110, ty + 120 + ph * esc + 40);
  }
  g.restore();
}

// ---------- escena: Napkin (texto que se convierte en diagrama) ----------
// escena.napkin = { convierte }
function renderNapkin(s, t, lt) {
  const N = s.napkin; g.fillStyle = '#f6f3ee'; g.fillRect(0, 0, W, H);
  const k = eOut4(clamp(lt / .4)), x = 70, y = 300, w = 940, h = 1000;
  g.save(); g.globalAlpha = k; g.shadowColor = 'rgba(0,0,0,.15)'; g.shadowBlur = 40; g.fillStyle = '#fff'; g.beginPath(); g.roundRect(x, y, w, h, 28); g.fill(); g.restore();
  g.save(); g.globalAlpha = k; g.beginPath(); g.roundRect(x + 30, y + 26, 60, 60, 14); g.clip(); dibujaLogo('napkin', x + 60, y + 56, 60); g.restore();
  g.fillStyle = '#222'; g.font = `700 34px ${FONT}`; g.globalAlpha = k; g.fillText('Napkin AI', x + 110, y + 68); g.globalAlpha = 1;
  const pasos = ['Paso 1: Aprender', 'Paso 2: Encontrar la oportunidad', 'Paso 3: Ejecutar'], cols = ['#ffb020', '#ff7a2f', '#8b5cf6'];
  const km = eInOut(clamp((t - N.convierte) / .9));
  pasos.forEach((p, i) => {
    // posición texto → caja del diagrama
    const tx0 = x + 60, ty0 = y + 190 + i * 64, bx = x + 120 + i * 0, by = y + 220 + i * 260;
    const xx = lerp(tx0, bx, km), yy = lerp(ty0, by, km), bw = lerp(0, 700, km), bh = lerp(0, 170, km);
    if (km > 0) {
      g.save(); g.globalAlpha = k * km; g.fillStyle = cols[i] + '22'; g.strokeStyle = cols[i]; g.lineWidth = 4; g.beginPath(); g.roundRect(xx - 20, yy - 70, bw, bh, 26); g.fill(); g.stroke();
      g.fillStyle = cols[i]; g.beginPath(); g.arc(xx + bw - 80, yy + 25, 46 * km, 0, 7); g.fill();
      g.fillStyle = '#fff'; g.font = `800 40px ${FONT}`; g.textAlign = 'center'; g.fillText(String(i + 1), xx + bw - 80, yy + 40); g.textAlign = 'left';
      if (i < 2) { g.strokeStyle = '#999'; g.lineWidth = 4; g.setLineDash([10, 10]); g.beginPath(); g.moveTo(x + 470, yy + bh - 70); g.lineTo(x + 470, yy + bh + 30); g.stroke(); g.setLineDash([]); }
      g.restore();
    }
    g.save(); g.globalAlpha = k * clamp((lt - .15 - i * .12) / .25); g.fillStyle = '#222'; g.font = `${km > .5 ? 700 : 500} ${lerp(34, 44, km)}px ${FONT}`;
    g.fillText(km > .5 ? p.split(': ')[1] : p, xx, yy); g.restore();
  });
}
// =====================================================================
// INTERFACES EMULADAS (verticales) — tarjeta enfrente, a la altura del pecho; tu cara siempre visible
// escena.ui = { tipo, en, fin, ...tiempos de cada acción }
// =====================================================================
const UIX = { x: 50, y: 905, w: 840, h: 620 };
const esc = (t, a, d = .35) => eOut4(clamp((t - a) / d));
function escribe(txt, t, a, vel = 22) { return txt.slice(0, Math.max(0, Math.floor((t - a) * vel))); }
function cursorMano(x, y, kc) {  // flecha + pulso de clic
  g.save(); if (kc > 0 && kc < 1) { g.globalAlpha *= 1 - kc; g.strokeStyle = '#fff'; g.lineWidth = 4; g.beginPath(); g.arc(x, y, 14 + kc * 40, 0, 7); g.stroke(); g.globalAlpha /= Math.max(.01, 1 - kc); }
  g.translate(x, y); g.scale(1.6, 1.6); g.fillStyle = '#fff'; g.strokeStyle = '#111'; g.lineWidth = 1.5;
  g.beginPath(); g.moveTo(0, 0); g.lineTo(0, 22); g.lineTo(6, 17); g.lineTo(10, 26); g.lineTo(14, 24); g.lineTo(10, 15); g.lineTo(17, 15); g.closePath(); g.fill(); g.stroke(); g.restore();
}
function moverCursor(t, pts) {  // pts: [[t, x, y, clic?], ...]
  if (!pts.length || t < pts[0][0]) return;
  let i = pts.findLastIndex(p => t >= p[0]); const p = pts[i], q = pts[i + 1];
  let x = p[1], y = p[2];
  if (q) { const k = eInOut(clamp((t - p[0]) / Math.max(.01, q[0] - p[0]) * 1.6)); x = lerp(p[1], q[1], k); y = lerp(p[2], q[2], k); }
  const clic = pts.filter(c => c[3] && t >= c[0] && t < c[0] + .45).pop();
  cursorMano(x, y, clic ? (t - clic[0]) / .45 : 0);
}
function tarjetaUI(U, t, fondo, borde) {
  if (U.full) {  // la app llena la pantalla del celular; el contenido va dentro de la zona segura y más grande
    const a = esc(t, U.en, .3);
    g.save(); g.fillStyle = fondo; g.fillRect(0, 0, W, H); g.globalAlpha = a;
    const S = 1.19; g.translate(40, 290 + (1 - a) * 60); g.scale(S, S);
    return { a, x: 0, y: 0, w: 840, h: 770 };
  }
  const a = esc(t, U.en, .4) * (1 - eInOut(clamp((t - U.fin) / .35)));
  if (a <= 0) return null;
  const { x, w, h } = UIX, y = UIX.y + (1 - a) * 120;
  g.save(); g.globalAlpha = a;
  g.shadowColor = 'rgba(0,0,0,.55)'; g.shadowBlur = 60; g.shadowOffsetY = 20; g.fillStyle = fondo; g.beginPath(); g.roundRect(x, y, w, h, 40); g.fill(); g.shadowColor = 'transparent';
  if (borde) { g.strokeStyle = borde; g.lineWidth = 2; g.beginPath(); g.roundRect(x, y, w, h, 40); g.stroke(); }
  g.beginPath(); g.roundRect(x, y, w, h, 40); g.clip();
  return { a, x, y, w, h };
}
function chip(x, y, txt, fondo, color, tam = 24, alto = 50) {
  g.font = `600 ${tam}px ${FONT}`; const w = g.measureText(txt).width + 36;
  g.fillStyle = fondo; g.beginPath(); g.roundRect(x, y, w, alto, alto / 2 > 18 ? 14 : alto / 2); g.fill();
  g.fillStyle = color; g.textBaseline = 'middle'; g.fillText(txt, x + 18, y + alto / 2 + 1); g.textBaseline = 'alphabetic'; return w;
}
function onda(x, y, w, h, t, color, n = 40, activa = 1) {
  g.fillStyle = color; const bw = w / n;
  for (let i = 0; i < n; i++) { const v = .15 + .85 * activa * Math.abs(Math.sin(t * 8 + i * .7) * Math.sin(t * 2.7 + i * 1.3)); g.beginPath(); g.roundRect(x + i * bw + bw * .2, y + h / 2 - h * v / 2, bw * .6, h * v, 3); g.fill(); }
}
function imgCover(im, x, y, w, h, zoom = 1) {
  if (!im) return; const s = Math.max(w / im.width, h / im.height) * zoom, iw = im.width * s, ih = im.height * s;
  g.drawImage(im, x + (w - iw) / 2, y + (h - ih) / 2, iw, ih);
}

// ---- HIGGSFIELD: prompt → GENERAR → videos generándose → resultados ----
// ui = { tipo:'higgsfield', en, fin, escribe, referencia, generar, listos:[t,t,t,t] }
function uiHiggsfield(U, t) {
  const c = tarjetaUI(U, t, '#0b0b0b', 'rgba(255,255,255,.08)'); if (!c) return;
  const { x, y, w, h } = c;
  // barra superior
  g.save(); g.beginPath(); g.roundRect(x + 28, y + 26, 54, 54, 14); g.clip(); dibujaLogo('higgsfield', x + 55, y + 53, 54); g.restore();
  g.fillStyle = '#fff'; g.font = `700 32px ${FONT}`; g.fillText('Higgsfield', x + 96, y + 64);
  const gb = g.createLinearGradient(0, y + 26, 0, y + 80); gb.addColorStop(0, '#e2ff3d'); gb.addColorStop(1, '#c8f000');
  g.fillStyle = gb; g.beginPath(); g.roundRect(x + w - 200, y + 28, 172, 50, 12); g.fill(); g.fillStyle = '#111'; g.font = `600 24px ${FONT}`; g.fillText('Regístrate', x + w - 176, y + 61);
  let tx = x + 28; ['Explorar', 'Imagen', 'Video', 'Audio'].forEach(n => { g.font = `600 24px ${FONT}`; g.fillStyle = n === 'Video' ? '#fff' : '#7a7a7a'; g.fillText(n, tx, y + 128); if (n === 'Video') { g.fillStyle = '#d4ff2a'; g.fillRect(tx, y + 138, g.measureText(n).width, 3); } tx += g.measureText(n).width + 30; });
  // caja de prompt
  const px = x + 24, py = y + 160, pw = w - 48, ph = 190;
  g.fillStyle = '#1b1b1b'; g.beginPath(); g.roundRect(px, py, pw, ph, 22); g.fill(); g.strokeStyle = 'rgba(255,255,255,.08)'; g.lineWidth = 2; g.stroke();
  g.fillStyle = '#2a2a2a'; g.beginPath(); g.roundRect(px + 18, py + 18, 50, 50, 12); g.fill(); g.fillStyle = '#ddd'; g.font = `300 40px ${FONT}`; g.fillText('+', px + 31, py + 57);
  let ox = px + 82;
  const kr = esc(t, U.referencia, .35);
  if (kr > 0) {  // clip de referencia (un cuadro de tu video)
    g.save(); g.globalAlpha *= kr; g.beginPath(); g.roundRect(ox, py + 14, 74, 58, 10); g.clip(); imgCover(IMG.uiRef, ox, py + 14, 74, 58); g.restore();
    g.fillStyle = '#d4ff2a'; g.globalAlpha *= kr; g.font = `600 16px ${FONT}`; g.fillText('REF', ox + 4, py + 86); g.globalAlpha = c.a; ox += 88;
  }
  const prompt = 'Un astronauta caminando en Marte, toma cinematográfica', s = escribe(prompt, t, U.escribe, 26);
  g.font = `400 26px ${FONT}`; g.fillStyle = s ? '#f2f2f2' : '#777';
  const linea = (s || 'Describe cualquier idea visual. Nosotros generaremos un video.');
  const maxw = px + pw - 190 - ox; let l1 = linea, l2 = '';
  while (g.measureText(l1).width > maxw) { const i = l1.lastIndexOf(' '); l2 = l1.slice(i + 1) + (l2 ? ' ' + l2 : ''); l1 = l1.slice(0, i); }
  g.fillText(l1, ox, py + 50); if (l2) g.fillText(l2 + (s && Math.floor(t * 3) % 2 ? '|' : ''), ox, py + 86);
  let cx = px + 18; [['▮▮ Seedance 2.0'], ['◷ 8s'], ['⛶ Auto'], ['🔊 Activado']].forEach(([n]) => { cx += chip(cx, py + 118, n, '#262626', '#e8e8e8', 21, 46) + 10; });
  // GENERAR
  const kg = clamp((t - U.generar) / .25), apretado = kg > 0 && kg < 1 ? .94 : 1;
  const bx = px + pw - 168, by = py + 20, bw = 150, bh = 84;
  g.save(); g.translate(bx + bw / 2, by + bh / 2); g.scale(apretado, apretado); g.translate(-(bx + bw / 2), -(by + bh / 2));
  const gg = g.createLinearGradient(0, by, 0, by + bh); gg.addColorStop(0, '#dcff2f'); gg.addColorStop(1, '#eef200');
  g.shadowColor = 'rgba(214,255,42,.45)'; g.shadowBlur = kg > 0 && kg < 1 ? 40 : 18; g.fillStyle = gg; g.beginPath(); g.roundRect(bx, by, bw, bh, 16); g.fill(); g.shadowColor = 'transparent';
  g.fillStyle = '#151515'; g.font = `800 24px ${FONT}`; g.textAlign = 'center'; g.fillText('GENERAR', bx + bw / 2, by + bh / 2 + 9); g.textAlign = 'left'; g.restore();
  // resultados: 4 tarjetas que se generan
  const ry = py + ph + 22, rh = y + h - 22 - ry, gap = 12, rw = (pw - gap * 3) / 4;
  U.listos.forEach((tl, i) => {
    const rx = px + i * (rw + gap), k0 = esc(t, U.generar + .2 + i * .12, .3); if (k0 <= 0) return;
    g.save(); g.globalAlpha = c.a * k0; g.beginPath(); g.roundRect(rx, ry, rw, rh, 16); g.clip();
    const kl = clamp((t - tl) / .5);
    if (kl < 1) {  // generándose: brillo que barre + porcentaje
      g.fillStyle = '#171717'; g.fillRect(rx, ry, rw, rh);
      const sx = rx - rw + ((t * 420 + i * 90) % (rw * 3)); const sh = g.createLinearGradient(sx, 0, sx + rw, 0); sh.addColorStop(0, 'rgba(255,255,255,0)'); sh.addColorStop(.5, 'rgba(214,255,42,.12)'); sh.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = sh; g.fillRect(rx, ry, rw, rh);
      const pct = Math.min(99, Math.floor(clamp((t - U.generar) / Math.max(.3, tl - U.generar)) * 100));
      g.fillStyle = '#d4ff2a'; g.font = `700 30px ${FONT}`; g.textAlign = 'center'; g.fillText(pct + '%', rx + rw / 2, ry + rh / 2 + 10); g.textAlign = 'left';
    }
    if (kl > 0) {
      g.globalAlpha = c.a * eOut(kl); imgCover(IMG['uiRes' + (i + 1)], rx, ry, rw, rh, 1.05 + (t - tl) * .02);
      g.fillStyle = 'rgba(0,0,0,.55)'; g.beginPath(); g.roundRect(rx + 8, ry + 8, 54, 30, 8); g.fill(); g.fillStyle = '#fff'; g.font = `600 18px ${FONT}`; g.fillText('8s', rx + 20, ry + 29);
      g.fillStyle = '#d4ff2a'; g.beginPath(); g.arc(rx + rw - 22, ry + 24, 13, 0, 7); g.fill(); g.fillStyle = '#111'; g.font = `800 16px ${FONT}`; g.fillText('✓', rx + rw - 28, ry + 30);
    }
    g.restore();
  });
  moverCursor(t, [[U.en + .2, x + w * .6, y + h * .9], [U.generar - .6, bx + 90, by + 60], [U.generar, bx + 90, by + 60, 1], [U.referencia - .5, px + 40, py + 40], [U.referencia - .1, px + 40, py + 40, 1], [U.referencia + .4, x + w * .7, y + h * .85]].sort((a, b) => a[0] - b[0]));
  g.restore();
}

// ---- NOTEBOOKLM: fuentes (YouTube, PDF) → chat con pregunta → Resumen en audio ----
// ui = { tipo:'notebooklm', en, fin, youtube, pregunta, respuesta, pdf, audio }
function uiNotebook(U, t) {
  const c = tarjetaUI(U, t, '#ffffff'); if (!c) return;
  const { x, y, w, h } = c;
  g.save(); g.beginPath(); g.rect(x + 26, y + 26, 48, 48); g.clip(); dibujaLogo('notebooklm', x + 50, y + 50, 48); g.restore();
  g.fillStyle = '#1f1f1f'; g.font = `500 32px ${FONT}`; g.fillText('NotebookLM', x + 88, y + 62);
  const modo = t >= U.pdf - .3 ? 'Fuentes' : t >= U.audio - .6 ? 'Studio' : t >= U.pregunta - .3 ? 'Chat' : 'Fuentes';
  let tx = x + 28; ['Fuentes', 'Chat', 'Studio'].forEach(n => { g.font = `600 24px ${FONT}`; const tw = g.measureText(n).width + 40;
    g.fillStyle = n === modo ? '#e8f0fe' : '#f3f4f6'; g.beginPath(); g.roundRect(tx, y + 100, tw, 50, 25); g.fill(); g.fillStyle = n === modo ? '#1a56db' : '#555'; g.fillText(n, tx + 20, y + 133); tx += tw + 12; });
  const by = y + 180;
  if (modo === 'Fuentes') {
    g.strokeStyle = '#d0d7e2'; g.lineWidth = 2; g.setLineDash([8, 6]); g.beginPath(); g.roundRect(x + 28, by, w - 56, 70, 18); g.stroke(); g.setLineDash([]);
    g.fillStyle = '#1a56db'; g.font = `600 24px ${FONT}`; g.fillText('+  Agregar fuente', x + 60, by + 44);
    const fuentes = [[U.youtube, 'yt', 'youtube.com/watch?v=… · Video'], [U.pdf, 'pdf', 'Guía de marketing.pdf']];
    let fy = by + 92;
    fuentes.forEach(([tt, tipo, nombre]) => { const k = esc(t, tt); if (k <= 0) return;
      g.save(); g.globalAlpha *= k; g.fillStyle = '#f6f8fb'; g.beginPath(); g.roundRect(x + 28 + (1 - k) * 40, fy, w - 56, 76, 16); g.fill();
      if (tipo === 'yt') { g.fillStyle = '#ff0000'; g.beginPath(); g.roundRect(x + 48, fy + 20, 50, 36, 9); g.fill(); g.fillStyle = '#fff'; g.beginPath(); g.moveTo(x + 66, fy + 29); g.lineTo(x + 82, fy + 38); g.lineTo(x + 66, fy + 47); g.fill(); }
      else { g.fillStyle = '#e5322d'; g.beginPath(); g.roundRect(x + 48, fy + 18, 50, 40, 8); g.fill(); g.fillStyle = '#fff'; g.font = `800 16px ${FONT}`; g.fillText('PDF', x + 56, fy + 44); }
      g.fillStyle = '#222'; g.font = `500 23px ${FONT}`; g.fillText(nombre, x + 116, fy + 46); g.fillStyle = '#34a853'; g.fillText('✓', x + w - 70, fy + 46); g.restore(); fy += 90; });
  } else if (modo === 'Chat') {
    const q = escribe('¿Cuáles son las 3 ideas principales del video?', t, U.pregunta, 30);
    if (t >= U.pregunta + 1.4) { g.fillStyle = '#e8f0fe'; g.beginPath(); g.roundRect(x + 150, by, w - 178, 70, 22); g.fill(); g.fillStyle = '#1f1f1f'; g.font = `500 22px ${FONT}`; g.fillText('¿Cuáles son las 3 ideas principales del video?', x + 172, by + 44); }
    const kr = clamp((t - U.respuesta) / 1.4);
    if (kr > 0) { const L = ['Según el video, las ideas clave son:', '1. Aprender con fuentes propias.', '2. Hacer preguntas sobre el contenido.', '3. Convertirlo en audio o resumen.'];
      g.save(); g.beginPath(); g.rect(x, y, w, by + 100 + kr * 220 - y); g.clip(); g.fillStyle = '#1f1f1f'; g.font = `400 24px ${FONT}`;
      L.forEach((l, i) => g.fillText(l, x + 36, by + 130 + i * 42)); g.restore(); g.fillStyle = '#9aa4b2'; g.font = `500 18px ${FONT}`; g.fillText('Basado en 1 fuente', x + 36, by + 320); }
    // caja de texto abajo
    g.fillStyle = '#f3f4f6'; g.beginPath(); g.roundRect(x + 28, y + h - 92, w - 56, 64, 32); g.fill(); g.fillStyle = q && t < U.pregunta + 1.4 ? '#1f1f1f' : '#8a8f98'; g.font = `400 22px ${FONT}`;
    g.fillText(t < U.pregunta + 1.4 ? (q || 'Escribe una pregunta…') + (q && Math.floor(t * 3) % 2 ? '|' : '') : 'Escribe una pregunta…', x + 54, y + h - 52);
  } else {  // Studio: Resumen en audio
    g.fillStyle = '#f6f8fb'; g.beginPath(); g.roundRect(x + 28, by, w - 56, 150, 22); g.fill();
    g.fillStyle = '#1f1f1f'; g.font = `600 28px ${FONT}`; g.fillText('🎧 Resumen en audio', x + 56, by + 56); g.fillStyle = '#5f6368'; g.font = `400 21px ${FONT}`; g.fillText('Conversación tipo podcast con tus fuentes', x + 56, by + 96);
    const kg = clamp((t - U.audio) / .25); g.fillStyle = kg > 0 ? '#1a56db' : '#1a73e8'; g.beginPath(); g.roundRect(x + w - 210, by + 48, 150, 56, 28); g.fill(); g.fillStyle = '#fff'; g.font = `600 22px ${FONT}`; g.fillText('Generar', x + w - 177, by + 84);
    const kp = clamp((t - U.audio - .9) / .4);
    if (kp > 0) { g.save(); g.globalAlpha *= kp; g.fillStyle = '#1f1f1f'; g.beginPath(); g.roundRect(x + 28, by + 175, w - 56, 140, 22); g.fill();
      g.fillStyle = '#fff'; g.font = `600 24px ${FONT}`; g.fillText('Análisis profundo · 12 min', x + 56, by + 216); onda(x + 56, by + 236, w - 160, 60, t, '#8ab4f8', 46);
      g.fillStyle = '#fff'; g.beginPath(); g.arc(x + w - 76, by + 266, 26, 0, 7); g.fill(); g.fillStyle = '#1f1f1f'; g.fillRect(x + w - 84, by + 254, 6, 24); g.fillRect(x + w - 72, by + 254, 6, 24); g.restore(); }
  }
  moverCursor(t, [[U.en + .2, x + w * .7, y + h * .8], [U.youtube - .4, x + 200, by + 35], [U.youtube - .05, x + 200, by + 35, 1], [U.audio - .5, x + w - 135, by + 76], [U.audio, x + w - 135, by + 76, 1], [U.audio + .6, x + w * .6, y + h * .9]].filter(p => p[0] > 0).sort((a, b) => a[0] - b[0]));
  g.restore();
}

// ---- VS CODE + CLAUDE CODE: terminal → claude → pedido → respuesta ----
// ui = { tipo:'claudecode', en, fin, claude, pedido, respuesta, codex }
function uiClaudeCode(U, t) {
  const c = tarjetaUI(U, t, '#1e1e1e', 'rgba(0,122,204,.5)'); if (!c) return;
  const { x, y, w, h } = c;
  g.fillStyle = '#2d2d2d'; g.fillRect(x, y, w, 70);
  g.save(); g.beginPath(); g.rect(x + 24, y + 16, 38, 38); g.clip(); dibujaLogo('vscode', x + 43, y + 35, 38); g.restore();
  let tx = x + 80; [['Claude Code', U.en], ['Codex', U.codex]].forEach(([n, te]) => { const k = esc(t, te, .3); if (k <= 0) return; g.font = `600 22px ${FONT}`; const tw = g.measureText(n).width + 50;
    g.save(); g.globalAlpha *= k; g.fillStyle = '#1e1e1e'; g.fillRect(tx, y + 12, tw, 58); g.fillStyle = n === 'Codex' ? '#10a37f' : '#e07a52'; g.fillRect(tx, y + 12, tw, 3);
    if (n === 'Claude Code') logoClaude(tx + 20, y + 41, 20, 0); else { g.fillStyle = '#fff'; g.beginPath(); g.arc(tx + 20, y + 41, 9, 0, 7); g.fill(); }
    g.fillStyle = '#ddd'; g.fillText(n, tx + 36, y + 49); g.restore(); tx += tw + 6; });
  g.fillStyle = '#9d9d9d'; g.font = `600 18px ${FONT}`; g.fillText('TERMINAL', x + 28, y + 106);
  g.font = `500 25px Menlo, monospace`; let ly = y + 150;
  g.fillStyle = '#4ec9b0'; g.fillText('saul@mac ~ %', x + 28, ly); g.fillStyle = '#fff'; g.fillText(escribe('claude', t, U.claude, 9), x + 230, ly);
  const kb = clamp((t - U.claude - .8) / .4);
  if (kb > 0) {  // mini banner + caja de entrada estilo Claude Code
    const esc2 = 4, pw = 96, ph = 46; PX.width = pw; PX.height = ph; px.clearRect(0, 0, pw, ph); px.font = `900 20px Menlo, monospace`; px.textBaseline = 'top';
    ['CLAUDE', 'CODE'].forEach((l, i) => { px.fillStyle = '#7a3b22'; px.fillText(l, 3, 3 + i * 21); px.fillStyle = '#e07a52'; px.fillText(l, 2, 2 + i * 21); });
    g.save(); g.beginPath(); g.rect(x + 28, ly + 22, pw * esc2 * kb, ph * esc2); g.clip(); g.imageSmoothingEnabled = false; g.drawImage(PX, x + 28, ly + 22, pw * esc2, ph * esc2); g.imageSmoothingEnabled = true; g.restore();
    ly += 22 + ph * esc2 + 20;
    g.strokeStyle = 'rgba(224,122,82,.7)'; g.lineWidth = 2; g.beginPath(); g.roundRect(x + 28, ly, w - 56, 62, 12); g.stroke();
    g.fillStyle = '#e07a52'; g.font = `600 25px Menlo, monospace`; g.fillText('>', x + 46, ly + 40);
    g.fillStyle = '#fff'; g.font = `500 23px Menlo, monospace`; g.fillText(escribe('Edita mi video con el estilo Saúl Pro', t, U.pedido, 24), x + 76, ly + 40);
    ly += 100;
    const L = [['✻', 'Analizando video…', '#e07a52'], ['⏺', 'Leyendo corte.mov · 1:30', '#9cdcfe'], ['⏺', 'Aplicando plantilla Saúl Pro', '#9cdcfe'], ['⏺', 'Subtítulos + animaciones', '#9cdcfe'], ['✓', 'Listo: Video editado.mp4', '#4ec9b0']];
    L.forEach(([ic, tx2, col], i) => { const k = clamp((t - U.respuesta - i * .45) / .2); if (k <= 0) return; g.save(); g.globalAlpha *= k; g.fillStyle = col; g.font = `600 23px Menlo, monospace`; g.fillText(ic, x + 32, ly + i * 38); g.fillStyle = '#d4d4d4'; g.font = `500 22px Menlo, monospace`; g.fillText(tx2, x + 66, ly + i * 38); g.restore(); });
  }
  g.restore();
}

// ---- NAPKIN: texto → seleccionar → ⚡ → diagrama ----
// ui = { tipo:'napkin', en, fin, selecciona, rayo, diagrama }
function uiNapkin(U, t) {
  const c = tarjetaUI(U, t, '#ffffff'); if (!c) return;
  const { x, y, w, h } = c;
  g.save(); g.beginPath(); g.rect(x + 26, y + 26, 44, 44); g.clip(); dibujaLogo('napkin', x + 48, y + 48, 44); g.restore();
  g.fillStyle = '#1f2937'; g.font = `700 30px ${FONT}`; g.fillText('Napkin', x + 82, y + 59);
  g.fillStyle = '#111827'; g.beginPath(); g.roundRect(x + w - 230, y + 22, 200, 50, 12); g.fill(); g.fillStyle = '#fff'; g.font = `600 21px ${FONT}`; g.fillText('Compartir', x + w - 185, y + 54);
  const L = ['Cómo crecer tu marca con IA:', 'Paso 1: aprende de tus referentes.', 'Paso 2: encuentra la oportunidad.', 'Paso 3: ejecuta todos los días.'];
  const kd = clamp((t - U.diagrama) / .9), ks = clamp((t - U.selecciona) / .6);
  const ty0 = y + 130;
  L.forEach((l, i) => { g.font = `${i ? 400 : 700} 27px ${FONT}`; const lw = g.measureText(l).width;
    if (ks > 0 && i > 0) { g.fillStyle = 'rgba(59,130,246,.22)'; g.fillRect(x + 60, ty0 + i * 46 - 30, lw * clamp(ks * 3 - (i - 1)), 40); }
    g.fillStyle = '#111827'; g.globalAlpha = c.a * (1 - kd * .65); g.fillText(l, x + 60, ty0 + i * 46); g.globalAlpha = c.a; });
  // ⚡ botón azul a la izquierda del párrafo
  const kr = clamp((t - U.rayo) / .3), rx = x + 34, ry = ty0 + 46;
  g.fillStyle = kr > 0 && kr < 1 ? '#1d4ed8' : '#3b82f6'; g.beginPath(); g.arc(rx, ry, 18 * (kr > 0 && kr < 1 ? 1.2 : 1), 0, 7); g.fill(); g.fillStyle = '#fff'; g.font = `700 20px ${FONT}`; g.fillText('⚡', rx - 10, ry + 8);
  if (kd > 0) {  // diagrama
    const cols = ['#f59e0b', '#ef6c2f', '#8b5cf6'], N = ['Aprende', 'Oportunidad', 'Ejecuta'], dy = y + (U.full ? 420 : 330);
    N.forEach((n, i) => { const k = eOut4(clamp(kd * 3 - i)); if (k <= 0) return; const bx = x + 40 + i * 262, bw = 236;
      g.save(); g.globalAlpha *= k; g.fillStyle = cols[i] + '22'; g.strokeStyle = cols[i]; g.lineWidth = 4; g.beginPath(); g.roundRect(bx, dy + (1 - k) * 30, bw, 200, 24); g.fill(); g.stroke();
      g.fillStyle = cols[i]; g.beginPath(); g.arc(bx + bw / 2, dy + 64, 34, 0, 7); g.fill(); g.fillStyle = '#fff'; g.font = `800 32px ${FONT}`; g.textAlign = 'center'; g.fillText(i + 1, bx + bw / 2, dy + 76);
      g.fillStyle = '#111827'; g.font = `700 27px ${FONT}`; g.fillText(n, bx + bw / 2, dy + 150); g.textAlign = 'left';
      if (i < 2) { g.strokeStyle = '#9ca3af'; g.lineWidth = 4; g.beginPath(); g.moveTo(bx + bw + 4, dy + 100); g.lineTo(bx + bw + 22, dy + 100); g.stroke(); }
      g.restore(); });
  }
  moverCursor(t, [[U.en + .2, x + w * .7, y + h * .85], [U.rayo - .5, rx + 6, ry + 6], [U.rayo, rx + 6, ry + 6, 1], [U.rayo + .6, x + w * .75, y + h * .9]]);
  g.restore();
}

// ---- HEYGEN: subir video → creando avatar → avatar listo ----
// ui = { tipo:'heygen', en, fin, sube, creando, listo }
function uiHeyGen(U, t) {
  const c = tarjetaUI(U, t, '#ffffff'); if (!c) return;
  const { x, y, w, h } = c;
  heygenGema(x + 50, y + 50, 20); g.fillStyle = '#111'; g.font = `800 32px ${FONT}`; g.fillText('HeyGen', x + 82, y + 62);
  g.fillStyle = '#00b4ff'; g.beginPath(); g.roundRect(x + w - 210, y + 24, 180, 52, 26); g.fill(); g.fillStyle = '#fff'; g.font = `700 22px ${FONT}`; g.fillText('Crear video', x + w - 182, y + 58);
  g.fillStyle = '#111'; g.font = `800 34px ${FONT}`; g.fillText('Crea tu avatar', x + 34, y + 140);
  const ax = x + 34, ay = y + 172, aw = U.full ? 360 : 300, ah = U.full ? h - 210 : 400;
  const ku = esc(t, U.sube, .45), kc = clamp((t - U.creando) / Math.max(.3, U.listo - U.creando)), kl = esc(t, U.listo, .4);
  g.strokeStyle = '#c7d2fe'; g.lineWidth = 3; g.setLineDash([10, 8]); g.beginPath(); g.roundRect(ax, ay, aw, ah, 24); g.stroke(); g.setLineDash([]);
  if (ku <= 0) { g.fillStyle = '#6b7280'; g.font = `600 22px ${FONT}`; g.fillText('Sube un video tuyo', ax + 54, ay + ah / 2); }
  else { g.save(); g.globalAlpha *= ku; g.beginPath(); g.roundRect(ax, ay + (1 - ku) * 40, aw, ah, 24); g.clip(); imgCover(IMG.uiRef, ax, ay, aw, ah);
    if (kl > 0) { g.globalAlpha = c.a * kl; g.fillStyle = 'rgba(0,180,255,.25)'; g.fillRect(ax, ay, aw, ah); }
    g.restore(); }
  // panel derecho: estado
  const rx = ax + aw + 30, rw = x + w - 34 - rx;
  if (t >= U.creando && kl <= 0) {
    g.fillStyle = '#111'; g.font = `700 26px ${FONT}`; g.fillText('Creando tu avatar…', rx, ay + 60);
    g.fillStyle = '#e5e7eb'; g.beginPath(); g.roundRect(rx, ay + 90, rw, 16, 8); g.fill(); g.fillStyle = '#00b4ff'; g.beginPath(); g.roundRect(rx, ay + 90, rw * kc, 16, 8); g.fill();
    g.fillStyle = '#6b7280'; g.font = `600 22px ${FONT}`; g.fillText(Math.floor(kc * 100) + '%', rx, ay + 146);
    ['Analizando tu rostro', 'Clonando tu voz', 'Gestos y expresiones'].forEach((n, i) => { const ok = kc > (i + 1) / 3.2; g.fillStyle = ok ? '#10b981' : '#9ca3af'; g.font = `600 21px ${FONT}`; g.fillText((ok ? '✓ ' : '○ ') + n, rx, ay + 200 + i * 44); });
  }
  if (kl > 0) {
    g.save(); g.globalAlpha *= kl; g.fillStyle = '#111'; g.font = `800 30px ${FONT}`; g.fillText(`${E.nombre || 'Saúl'} · Avatar`, rx, ay + 60);
    g.fillStyle = '#10b981'; g.font = `700 22px ${FONT}`; g.fillText('✓ Listo para usar', rx, ay + 100);
    g.fillStyle = '#f3f4f6'; g.beginPath(); g.roundRect(rx, ay + 130, rw, 150, 18); g.fill(); g.fillStyle = '#374151'; g.font = `400 20px ${FONT}`;
    [`"Hola, soy ${E.nombre || 'Saúl'} y hoy`, 'te enseño 5 herramientas…"'].forEach((l, i) => g.fillText(l, rx + 18, ay + 175 + i * 32));
    g.fillStyle = '#00b4ff'; g.beginPath(); g.roundRect(rx, ay + 300, rw, 60, 30); g.fill(); g.fillStyle = '#fff'; g.font = `700 22px ${FONT}`; g.fillText('▶ Generar video', rx + 40, ay + 338); g.restore();
  }
  moverCursor(t, [[U.en + .2, x + w * .8, y + h * .9], [U.sube - .5, ax + aw / 2, ay + ah / 2], [U.sube - .1, ax + aw / 2, ay + ah / 2, 1], [U.sube + .5, x + w * .85, y + h * .92]]);
  g.restore();
}

// ---- ELEVENLABS: texto → voz clonada → generar → onda ----
// ui = { tipo:'elevenlabs', en, fin, escribe, generar }
function uiEleven(U, t) {
  const c = tarjetaUI(U, t, '#ffffff'); if (!c) return;
  const { x, y, w, h } = c;
  g.fillStyle = '#000'; g.font = `800 32px ${FONT}`; g.fillText('II', x + 32, y + 62); g.font = `600 30px ${FONT}`; g.fillText('ElevenLabs', x + 62, y + 62);
  g.fillStyle = '#000'; g.beginPath(); g.roundRect(x + w - 190, y + 24, 160, 50, 25); g.fill(); g.fillStyle = '#fff'; g.font = `600 21px ${FONT}`; g.fillText('Text to Speech', x + w - 176, y + 56);
  // caja de texto
  const EY = U.full ? 120 : 0;
  g.fillStyle = '#fafafa'; g.strokeStyle = '#e5e5e5'; g.lineWidth = 2; g.beginPath(); g.roundRect(x + 28, y + 100, w - 56, 200 + EY, 20); g.fill(); g.stroke();
  const txt = `Hola, soy ${E.nombre || 'Saúl'}. Este audio lo hizo mi voz clonada con inteligencia artificial.`, s = escribe(txt, t, U.escribe, 30);
  g.fillStyle = s ? '#111' : '#999'; g.font = `400 26px ${FONT}`; let l = s || 'Escribe el texto que quieres convertir en voz…', lines = [], cur = '';
  l.split(' ').forEach(wd => { const tt = cur ? cur + ' ' + wd : wd; if (g.measureText(tt).width > w - 110) { lines.push(cur); cur = wd; } else cur = tt; }); lines.push(cur);
  lines.slice(0, 4).forEach((ln, i) => g.fillText(ln, x + 52, y + 150 + i * 38));
  // voz y ajustes
  g.save(); g.translate(0, EY);
  g.fillStyle = '#fff'; g.strokeStyle = '#e5e5e5'; g.beginPath(); g.roundRect(x + 28, y + 318, 360, 64, 32); g.fill(); g.stroke();
  const vg = g.createLinearGradient(x + 50, y + 330, x + 90, y + 370); vg.addColorStop(0, '#f97316'); vg.addColorStop(1, '#8b5cf6'); g.fillStyle = vg; g.beginPath(); g.arc(x + 66, y + 350, 20, 0, 7); g.fill();
  g.fillStyle = '#111'; g.font = `600 23px ${FONT}`; g.fillText(`${E.nombre || 'Saúl'} (voz clonada)`, x + 98, y + 358);
  [['Estabilidad', .55], ['Similitud', .85]].forEach(([n, v], i) => { const sx = x + 420, sy = y + 330 + i * 34; g.fillStyle = '#6b7280'; g.font = `500 18px ${FONT}`; g.fillText(n, sx, sy);
    g.fillStyle = '#e5e5e5'; g.fillRect(sx + 110, sy - 7, 250, 6); g.fillStyle = '#111'; g.fillRect(sx + 110, sy - 7, 250 * v, 6); g.beginPath(); g.arc(sx + 110 + 250 * v, sy - 4, 10, 0, 7); g.fill(); });
  // generar
  const kg = clamp((t - U.generar) / .25); g.fillStyle = kg > 0 && kg < 1 ? '#333' : '#000'; g.beginPath(); g.roundRect(x + w - 230, y + 400, 202, 62, 31); g.fill(); g.fillStyle = '#fff'; g.font = `700 23px ${FONT}`; g.fillText('Generar voz', x + w - 194, y + 439);
  const kp = clamp((t - U.generar - .5) / .4);
  if (kp > 0) { g.save(); g.globalAlpha *= kp; g.fillStyle = '#111'; g.beginPath(); g.roundRect(x + 28, y + 484, w - 56, 108, 24); g.fill();
    g.fillStyle = '#fff'; g.beginPath(); g.arc(x + 82, y + 538, 26, 0, 7); g.fill(); g.fillStyle = '#111'; g.fillRect(x + 74, y + 526, 6, 24); g.fillRect(x + 86, y + 526, 6, 24);
    onda(x + 130, y + 508, w - 260, 60, t, '#fff', 48); g.fillStyle = '#9ca3af'; g.font = `500 18px ${FONT}`; g.fillText('0:05', x + w - 100, y + 545); g.restore(); }
  moverCursor(t, [[U.en + .2, x + w * .7, y + 560], [U.generar - .5, x + w - 130, y + 430], [U.generar, x + w - 130, y + 430, 1], [U.generar + .6, x + w * .8, y + 620]]);
  g.restore(); g.restore();
}
const UIS = { higgsfield: uiHiggsfield, notebooklm: uiNotebook, claudecode: uiClaudeCode, napkin: uiNapkin, heygen: uiHeyGen, elevenlabs: uiEleven };
function interfaces(s, t) { if (s.visual === 'interfaz') return; for (const U of [].concat(s.ui || [])) if (t >= U.en - .1 && t <= U.fin + .4) UIS[U.tipo](U, t); }
function renderInterfaz(s, t) { const U = { ...s.ui, full: true }; UIS[U.tipo](U, t); }

// ---- presentación de herramienta como capa (no pantalla completa): ícono que salta con destello ----
// escena.icono = { en, fin, logo, nombre }
function iconoHerramienta(s, t) {
  const I = s.icono; if (!I || t < I.en - .05 || t > I.fin + .3) return;
  const k = eOut4(clamp((t - I.en) / .45)), ko = eInOut(clamp((t - I.fin) / .3)), a = k * (1 - ko);
  const cx = W / 2 - 50, cy = 1180 - (1 - k) * 80, tam = 230 * lerp(.6, 1, k);
  g.save(); g.globalAlpha = a;
  for (let i = 0; i < 26; i++) { const ang = hash(i * 2.2) * 7, d = eOut(clamp((t - I.en) / .7)) * (140 + hash(i * 4.4) * 260); g.fillStyle = `rgba(255,170,70,${(a * (1 - clamp((t - I.en) / .9))).toFixed(2)})`; g.beginPath(); g.arc(cx + Math.cos(ang) * d, cy + Math.sin(ang) * d, 3.5, 0, 7); g.fill(); }
  g.shadowColor = 'rgba(255,130,30,.95)'; g.shadowBlur = 70; const gr = g.createLinearGradient(cx - tam / 2, cy - tam / 2, cx + tam / 2, cy + tam / 2); gr.addColorStop(0, '#3a2412'); gr.addColorStop(1, '#140c06');
  g.fillStyle = gr; g.beginPath(); g.roundRect(cx - tam / 2, cy - tam / 2, tam, tam, tam * .23); g.fill(); g.shadowColor = 'transparent';
  halo5(cx - tam / 2, cy - tam / 2, tam, tam, tam * .23, .9);
  const ls = I.logo.split('+');
  ls.forEach((l, i) => { const ox = ls.length > 1 ? (i ? 1 : -1) * tam * .22 : 0, ts = ls.length > 1 ? tam * .4 : tam * .62; g.save(); g.beginPath(); g.roundRect(cx + ox - ts / 2, cy - ts / 2, ts, ts, ts * .2); g.clip(); dibujaLogo(l, cx + ox, cy, ts); g.restore(); });
  g.fillStyle = '#fff'; g.font = `800 64px ${FONT}`; g.textAlign = 'center'; g.shadowColor = 'rgba(0,0,0,.7)'; g.shadowBlur = 24; g.fillText(I.nombre, cx, cy + tam / 2 + 80); g.textAlign = 'left';
  g.restore();
}
const VIS = { logos: renderLogos, silueta: renderSilueta, ojo: renderOjo, telefonos: renderTelefonos, moneda: renderMoneda, persona: renderPersona, prompt: renderPrompt, tripie: renderTripie, laptop: renderLaptop, censurados: renderCensurados, guion: renderGuion, clip: renderClip, contador: renderContador, tarjetas: renderTarjetas, chat: renderChat, herramienta: renderHerramienta, vscode: renderVSCode, napkin: renderNapkin, interfaz: renderInterfaz, icono3d: renderIcono3d };

window.init = async (edit) => {
  E = edit; MODO = E.modo;
  const faltan = [];
  if (MODO === 'hf') for (const s of E.escenas) { try { IMG[s.hf] = await loadImg(`${E.hfDir}/${s.hf}.png`); } catch (e) { faltan.push(e); } }
  for (const [n, src] of Object.entries(E.imagenes || {})) { try { IMG[n] = await loadImg(src); } catch (e) { faltan.push(e); } }
  for (const [n, src] of Object.entries(E.logos || {})) { try { IMG['logo_' + n] = await loadImg(src); } catch (e) { faltan.push(e); } }
  for (const s of E.escenas) if (s.img) { try { IMG[s.img] = await loadImg(`${E.hfDir}/${s.img}.png`); } catch (e) { faltan.push(e); } }
  // logos: cada escena trae su lista ("logos": [{marca, en}]); las escenas seguidas con "logo" comparten una sola secuencia
  let corrida = null;
  for (let i = 0; i < E.escenas.length; i++) {
    const s = E.escenas[i]; if (s.visual !== 'logos') { corrida = null; continue; }
    if (s.logos) {
      s.items = []; s.tins = s.logos.map(l => l.en); s.grupoIni = s.ini;
      for (const l of s.logos) s.items.push(await buildLogoCodigo(l.marca));
      corrida = null;
    } else {
      if (!corrida) corrida = { items: [], tins: [], ini: s.ini };
      corrida.items.push(MODO === 'hf' ? buildLogoImagen(IMG[s.hf]) : await buildLogoCodigo(s.logo)); corrida.tins.push(s.ini);
      s.items = corrida.items; s.tins = corrida.tins; s.grupoIni = corrida.ini;
    }
  }
  for (const s of E.escenas) if (s.items) s.items.forEach(o => { if (!LG.items.includes(o)) { LG.items.push(o); LG.scene.add(o); } });
  setupLogoLights();
  if (!_claudeP) { const txt = await (await fetch('logos/claude.svg')).text(); _claudeP = new Path2D(txt.match(/ d="([^"]+)"/)[1]); }
  buildOjo(); buildTelefonos(); buildMoneda(); buildTripie(); buildLaptop(); buildCensurados();
  for (const s of E.escenas) if (s.icono3d) s.icono3d.logos.forEach(L => { L.obj = buildBloque(L.n); });
  for (const s of E.escenas) if (s.visual === 'persona' || s.visual === 'interfaz') s.grupos.forEach(gp => { if (!gp.detras) gp.sombra = true; });
  layout();
  return faltan;
};

window.render = async (t) => {
  const i = Math.max(0, E.escenas.findLastIndex(s => t >= s.ini));
  const s = E.escenas[i], lt = t - s.ini;
  E._escena = s;
  g.setTransform(1, 0, 0, 1, 0, 0); g.filter = 'none'; g.globalAlpha = 1; g.globalCompositeOperation = 'source-over'; g.shadowColor = 'transparent';
  g.fillStyle = s.tema === 'claro' ? '#e6e2d8' : '#040404'; g.fillRect(0, 0, W, H);
  await VIS[s.visual](s, t, lt);
  if (s.pelicula) pelicula(t);
  tarjetaBio(t); anillos(t); titular(t); letreroPixel(s, t); chipsLista(s, t); cronometro(s, t); selloClaude(s, t); cuentaGrande(s, t); ondaAudio(s, t); appsTachadas(s, t); demoNotebook1(s, t); demoNotebook2(s, t); barraPrompt(s, t); ventanaTop5(t); listaHerramientas(s, t); tecleo(s, t); preguntaIG(s, t);
  for (const gp of s.grupos) if (!(gp.detras && s.visual === 'persona')) dibujaGrupo(gp, t, temaTexto(s));
  iconoHerramienta(s, t); interfaces(s, t);
  motas(t, s.tema);
  quemaduras(t);
  const f = efectos(t, s.tema);
  U.time.value = t; U.rgb.value = f.rgb; U.glitch.value = f.glitch; U.zoomBlur.value = f.zoomBlur; U.dir.value.set(f.dx, f.dy);
  U.flash.value = f.flash; U.grain.value = f.grain; U.vig.value = f.vig; U.dark.value = f.dark; U.zoom.value = f.zoom; U.pan.value.set(f.px, f.py); U.leak.value = f.leak;
  tex2.needsUpdate = true;
  R2.render(postScene, postCam);
  return true;
};
