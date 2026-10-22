/* =====================================================================
   千里江山 · 烟花       Qianli Jiangshan · Fireworks
   ml5.js HandPose  +  p5.js        ——  HTML / CSS / JS 三文件版
   ---------------------------------------------------------------------
   手势：伸出食指 = 单发 ｜ 张开手掌 = 连放 ｜ 握拳蓄力后松开 = 齐放
   鼠标：移动瞄准 ｜ 单击单发 ｜ 按住连放 ｜ 空格齐放
   ===================================================================== */

/* ------------------------------ 参数 ------------------------------ */
const CAM_W = 640, CAM_H = 480;
const NODE_N  = 12;      // 江山节点数
const NODE_R  = 120;     // 点亮判定半径
const COOL_PT = 280;     // 指点单发冷却 (ms)
const COOL_OP = 150;     // 张掌连放冷却 (ms)
const CHARGE_MAX = 900;  // 蓄力上限 (ms)

/* 配色：烟花取自青绿山水的对比色 —— 石青 / 石绿 / 泥金 / 朱红 */
const FIRE_PAL = [
  [255, 208, 116], [255, 132,  88], [110, 226, 198],
  [150, 190, 255], [255, 148, 196], [178, 255, 196],
  [255, 240, 205], [196, 152, 255]
];

/* 手部骨架连线（21 关键点） */
const CONN = [
  [0,1],[1,2],[2,3],[3,4],            // 拇指
  [0,5],[5,6],[6,7],[7,8],            // 食指
  [5,9],[9,10],[10,11],[11,12],       // 中指
  [9,13],[13,14],[14,15],[15,16],     // 无名指
  [13,17],[17,18],[18,19],[19,20],    // 小指
  [0,17]                              // 掌根
];

/* ------------------------------ 状态 ------------------------------ */
let bg, fx;                       // 背景层（静态山水） / 烟花层（带拖尾）
let video, handPose, hands = [];
let mode = 'cam';                 // 'cam' | 'mouse'
let camOK = false, modelOK = false, triedMP = false;

let ridges = { mid: [] };
let nodes  = [];
let rockets = [], sparks = [];

let ptr = null;                   // 笔尖（平滑后的指尖/鼠标位置）
let lastFire = 0, charge = 0, wasFist = false;
let litCount = 0, score = 0;
let finale = false, finaleEnd = 0;
let showSkel = true, showCam = true;
let uiLock = 0;                   // 点按钮时屏蔽画布点击
let poseTxt = '初始化…';
let finaleNext = 0;

/* 帧间共享的小容器（骨架点 / 笔尖 / 蓄力） */
const G = { kp: null, ptr: null, charge: 0 };

/* =====================================================================
   p5 生命周期
   ===================================================================== */
function setup() {
  const c = createCanvas(windowWidth, windowHeight);
  if (document.getElementById('sketch-holder')) c.parent('sketch-holder');
  pixelDensity(1);
  noiseSeed(2026);
  buildLayers();
  bindUI();
  startCamera();
}

function buildLayers() {
  if (bg) bg.remove();
  if (fx) fx.remove();
  bg = createGraphics(width, height);
  fx = createGraphics(width, height);
  paintScroll(bg);
  initNodes();
}

function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
  buildLayers();
}

function draw() {
  fadeFX();            // 烟花层淡出 → 拖尾
  stepFireworks();     // 更新并绘制烟花
  image(bg, 0, 0);
  image(fx, 0, 0);
  drawNodes();         // 江山节点（含点亮光）
  handleInput();       // 手势 / 鼠标 → 触发烟花
  if (showSkel) drawSkeleton();
  if (finale)   stepFinale();
  drawBanner();
  if (frameCount % 10 === 0) updateHUD();
}

/* =====================================================================
   背景：千里江山（夜色青绿山水，程序化绘制一次）
   ===================================================================== */
function paintScroll(g) {
  const w = g.width, h = g.height, ctx = g.drawingContext;

  // 夜空渐变
  const sky = ctx.createLinearGradient(0, 0, 0, h);
  sky.addColorStop(0.00, '#04070f');
  sky.addColorStop(0.32, '#08182a');
  sky.addColorStop(0.58, '#0f2b3d');
  sky.addColorStop(0.78, '#143648');
  sky.addColorStop(1.00, '#07141a');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, w, h);

  // 星子
  for (let i = 0; i < 180; i++) {
    const x = random(w), y = random(h * 0.62);
    const a = random(0.12, 0.75) * (1 - y / (h * 0.62));
    ctx.fillStyle = 'rgba(226,240,255,' + a.toFixed(3) + ')';
    ctx.beginPath();
    ctx.arc(x, y, random(0.4, 1.35), 0, TAU);
    ctx.fill();
  }

  // 淡月
  const mx = w * 0.78, my = h * 0.15, mr = Math.min(w, h) * 0.052;
  const mg = ctx.createRadialGradient(mx, my, 0, mx, my, mr * 4.2);
  mg.addColorStop(0, 'rgba(255,248,224,0.42)');
  mg.addColorStop(0.18, 'rgba(255,244,214,0.16)');
  mg.addColorStop(1, 'rgba(255,240,200,0)');
  ctx.fillStyle = mg;
  ctx.beginPath(); ctx.arc(mx, my, mr * 4.2, 0, TAU); ctx.fill();
  ctx.fillStyle = 'rgba(255,250,232,0.85)';
  ctx.beginPath(); ctx.arc(mx, my, mr, 0, TAU); ctx.fill();

  // 三层山峦：远山（石青）→ 中山（石绿）→ 近山（浓绿）
  buildRidge('far',  11.3, 0.60, 0.20, 0.0014);
  fillRidge(ctx, ridges.far,  '#1a4356', 'rgba(120,190,205,0.35)');
  buildRidge('mid',  47.9, 0.74, 0.17, 0.0021);
  fillRidge(ctx, ridges.mid,  '#2b6b52', 'rgba(198,168,96,0.42)');
  buildRidge('near', 91.5, 0.90, 0.12, 0.0032);
  fillRidge(ctx, ridges.near, '#123528', 'rgba(150,200,170,0.30)');

  // 江面：横波 + 泥金反光
  const wy = h * 0.955;
  const wg = ctx.createLinearGradient(0, wy - 8, 0, h);
  wg.addColorStop(0, 'rgba(24,72,86,0.95)');
  wg.addColorStop(1, 'rgba(6,18,26,1)');
  ctx.fillStyle = wg;
  ctx.fillRect(0, wy - 8, w, h - wy + 8);
  ctx.strokeStyle = 'rgba(232,197,116,0.20)';
  ctx.lineWidth = 1;
  for (let i = 0; i < 40; i++) {
    const y = wy + random(h - wy);
    const len = random(w * 0.06, w * 0.30), x = random(w);
    ctx.globalAlpha = random(0.08, 0.4);
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + len, y); ctx.stroke();
  }
  ctx.globalAlpha = 1;

  // 远山上的雾带
  const fg = ctx.createLinearGradient(0, h * 0.5, 0, h * 0.78);
  fg.addColorStop(0, 'rgba(180,215,225,0)');
  fg.addColorStop(0.55, 'rgba(180,215,225,0.10)');
  fg.addColorStop(1, 'rgba(180,215,225,0)');
  ctx.fillStyle = fg;
  ctx.fillRect(0, h * 0.5, w, h * 0.28);
}

function buildRidge(kind, seed, baseRatio, ampRatio, freq) {
  const pts = [];
  const base = height * baseRatio, amp = height * ampRatio;
  for (let x = -4; x <= width + 4; x += 4) {
    const n1 = noise(x * freq + seed) - 0.5;
    const n2 = (noise(x * freq * 3.1 + seed * 2.7) - 0.5) * 0.34;
    const n3 = (noise(x * freq * 0.42 + seed * 5.1) - 0.5) * 0.6;
    pts.push({ x: x, y: base - (n1 + n2 + n3) * amp });
  }
  ridges[kind] = pts;
}

function fillRidge(ctx, pts, fillCol, edgeCol) {
  if (!pts || !pts.length) return;
  ctx.beginPath();
  ctx.moveTo(pts[0].x, height + 2);
  for (const p of pts) ctx.lineTo(p.x, p.y);
  ctx.lineTo(pts[pts.length - 1].x, height + 2);
  ctx.closePath();
  ctx.fillStyle = fillCol;
  ctx.fill();

  // 山脊描边（泥金 / 石青，模拟青绿山水的勾线）
  ctx.beginPath();
  pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
  ctx.strokeStyle = edgeCol;
  ctx.lineWidth = 1.3;
  ctx.stroke();
}

/* =====================================================================
   江山节点（山巅亭台 · 需烟花点亮）
   ===================================================================== */
function initNodes() {
  nodes = [];
  const pts = ridges.mid;
  if (!pts || pts.length < 4) return;
  for (let i = 0; i < NODE_N; i++) {
    const idx = Math.floor(((i + 0.5) / NODE_N) * (pts.length - 1));
    const p = pts[idx];
    nodes.push({ x: p.x, y: p.y - 12, lit: 0, done: false, ph: random(TAU) });
  }
}

function drawNodes() {
  const t = millis() / 1000;
  push();
  for (const n of nodes) {
    const pulse = 0.5 + 0.5 * Math.sin(t * 1.7 + n.ph);
    if (n.done) {
      noStroke();
      for (let i = 3; i >= 1; i--) {
        fill(255, 206, 118, 13 * i * (0.65 + 0.35 * pulse));
        circle(n.x, n.y, 22 + i * 17);
      }
      pavilion(n.x, n.y, 1, true);
      fill(255, 232, 170, 150 + 90 * pulse);
      circle(n.x, n.y - 15, 4.5);
    } else {
      pavilion(n.x, n.y, 1, false);
      if (n.lit > 0) {
        fill(255, 206, 118, 70 + 80 * pulse);
        circle(n.x, n.y - 15, 5 + 7 * n.lit);
      }
    }
  }
  pop();
}

/* 简笔中式亭台 */
function pavilion(x, y, s, lit) {
  const w = 15 * s, h = 11 * s;
  push();
  translate(x, y);
  if (lit) { stroke(255, 214, 130, 235); strokeWeight(1.5); }
  else     { stroke(150, 186, 168, 120); strokeWeight(1.1); }
  noFill();

  beginShape();                                   // 起翘屋檐
  vertex(-w, 0);
  bezierVertex(-w * 0.55, -h * 0.62, -w * 0.30, -h * 0.92, 0, -h * 1.05);
  bezierVertex(w * 0.30, -h * 0.92, w * 0.55, -h * 0.62, w, 0);
  endShape();

  line(-w * 0.62, -h * 0.28, -w * 0.62, 0);       // 柱
  line(w * 0.62, -h * 0.28, w * 0.62, 0);
  line(-w * 0.7, 0, w * 0.7, 0);                  // 台基
  pop();
}

function lightNear(x, y, amount) {
  for (const n of nodes) {
    if (n.done) continue;
    const d = dist(x, y, n.x, n.y);
    if (d < NODE_R) {
      n.lit += amount * 0.36 * (1 - d / NODE_R);
      if (n.lit >= 1) {
        n.lit = 1; n.done = true; litCount++; score += 120;
        for (let i = 0; i < 3; i++) {
          setTimeout(() => launch(n.x + random(-40, 40), n.y - random(30, 90), false), i * 130);
        }
        updateHUD();
      }
    }
  }
  if (litCount >= NODE_N && !finale) startFinale();
}

/* =====================================================================
   烟花系统
   ===================================================================== */
function rgbStr(c) { return 'rgb(' + c[0] + ',' + c[1] + ',' + c[2] + ')'; }

function launch(tx, ty, big) {
  const sx = constrain(tx + random(-70, 70), 16, width - 16);
  const sy = height - random(0, 8);
  const d  = Math.max(70, sy - ty);
  const frames = d / random(7.5, 10.5);
  rockets.push({
    x: sx, y: sy, px: sx, py: sy,
    vx: (tx - sx) / frames,
    vy: (ty - sy) / frames,
    ty: ty, life: frames,
    col: rgbStr(random(FIRE_PAL)),
    big: !!big
  });
}

function volley(x, y) {
  const n = Math.floor(random(4, 7));
  for (let i = 0; i < n; i++) {
    const tx = x + random(-160, 160), ty = y + random(-90, 90);
    setTimeout(() => launch(tx, ty, Math.random() < 0.45), i * 95);
  }
}

function burst(x, y, big, colStr) {
  const type = random(['peony', 'chrys', 'willow', 'ring']);
  const n    = big ? 100 : 58;
  const base = big ? random(4.4, 6.6) : random(2.9, 4.5);
  const col  = colStr || rgbStr(random(FIRE_PAL));

  // 粒子总量封顶，防止低端机掉帧
  if (sparks.length > 2400) sparks.splice(0, sparks.length - 2400);

  for (let i = 0; i < n; i++) {
    let ang, sp, grav, drag, life, r, glow;

    if (type === 'ring') {
      ang = (i / n) * TAU; sp = base * random(0.92, 1.06);
      grav = 0.020; drag = 0.986; life = random(52, 72);
    } else if (type === 'willow') {
      ang = random(TAU); sp = base * random(0.35, 0.85);
      grav = 0.150; drag = 0.982; life = random(80, 115);
    } else if (type === 'chrys') {
      ang = random(TAU); sp = base * Math.pow(random(), 0.35);
      grav = 0.052; drag = 0.955; life = random(58, 84);
    } else {  // peony 牡丹
      ang = random(TAU); sp = base * Math.pow(random(), 0.55);
      grav = 0.038; drag = 0.938; life = random(46, 70);
    }
    r = big ? random(1.6, 3.0) : random(1.1, 2.2);
    glow = Math.random() < 0.22;

    // 少量粒子换色，制造层次
    const c = (Math.random() < 0.16 && type !== 'willow')
      ? rgbStr(random(FIRE_PAL)) : col;

    sparks.push({
      x: x, y: y, px: x, py: y,
      vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp,
      grav, drag, life, maxLife: life, r, col: c, glow,
      a: 1
    });
  }

  // 爆炸闪光
  const g = fx.drawingContext;
  const rad = big ? 130 : 82;
  const rg = g.createRadialGradient(x, y, 0, x, y, rad);
  rg.addColorStop(0, 'rgba(255,247,222,0.55)');
  rg.addColorStop(0.35, 'rgba(255,214,150,0.22)');
  rg.addColorStop(1, 'rgba(255,200,120,0)');
  g.save();
  g.globalCompositeOperation = 'lighter';
  g.fillStyle = rg;
  g.beginPath(); g.arc(x, y, rad, 0, TAU); g.fill();
  g.restore();

  lightNear(x, y, big ? 1.15 : 0.75);
  score += big ? 12 : 6;
}

function stepFireworks() {
  // 升空
  for (let i = rockets.length - 1; i >= 0; i--) {
    const r = rockets[i];
    r.px = r.x; r.py = r.y;
    r.x += r.vx; r.y += r.vy;
    r.life -= 1;
    if (r.life <= 0 || r.y <= r.ty) {
      burst(r.x, r.y, r.big, r.col);
      rockets.splice(i, 1);
    }
  }
  // 粒子
  for (let i = sparks.length - 1; i >= 0; i--) {
    const s = sparks[i];
    s.px = s.x; s.py = s.y;
    s.vx *= s.drag; s.vy *= s.drag;
    s.vy += s.grav;
    s.x += s.vx; s.y += s.vy;
    s.life -= 1;
    s.a = Math.pow(Math.max(0, s.life / s.maxLife), 1.35);
    if (s.life <= 0) sparks.splice(i, 1);
  }
  drawFX();
}

function drawFX() {
  const g = fx.drawingContext;
  g.save();
  g.globalCompositeOperation = 'lighter';
  g.lineCap = 'round';

  for (const s of sparks) {
    g.globalAlpha = s.a;
    g.strokeStyle = s.col;
    g.lineWidth = s.r;
    g.beginPath(); g.moveTo(s.px, s.py); g.lineTo(s.x, s.y); g.stroke();
    if (s.glow) {
      g.globalAlpha = s.a * 0.22;
      g.fillStyle = s.col;
      g.beginPath(); g.arc(s.x, s.y, s.r * 3.4, 0, TAU); g.fill();
    }
  }
  for (const r of rockets) {
    g.globalAlpha = 0.95;
    g.strokeStyle = r.col;
    g.lineWidth = 2.4;
    g.beginPath(); g.moveTo(r.px, r.py); g.lineTo(r.x, r.y); g.stroke();
    g.globalAlpha = 0.3;
    g.fillStyle = 'rgba(255,238,200,0.9)';
    g.beginPath(); g.arc(r.x, r.y, 3.4, 0, TAU); g.fill();
  }
  g.restore();
}

function fadeFX() {
  const ctx = fx.drawingContext;
  ctx.save();
  ctx.globalCompositeOperation = 'destination-out';
  ctx.fillStyle = 'rgba(0,0,0,0.13)';
  ctx.fillRect(0, 0, fx.width, fx.height);
  ctx.restore();
}

/* 全卷点亮 → 终章齐放 */
function startFinale() {
  finale = true;
  finaleEnd = millis() + 6000;
  score += 600;
  updateHUD();
}
function stepFinale() {
  const now = millis();
  if (now > finaleNext) {
    finaleNext = now + 190;
    launch(random(width * 0.08, width * 0.92), random(height * 0.12, height * 0.5), true);
  }
  if (now > finaleEnd) finale = false;
}

function drawBanner() {
  if (litCount < NODE_N) return;
  const a = 200 + 55 * Math.sin(millis() / 320);
  push();
  textAlign(CENTER, CENTER);
  noStroke();
  fill(255, 226, 160, a);
  textSize(Math.min(width, height) * 0.052);
  text('千里江山 · 已全卷点亮', width / 2, height * 0.16);
  fill(200, 226, 214, 150);
  textSize(Math.min(width, height) * 0.021);
  text('得分 ' + score, width / 2, height * 0.16 + Math.min(width, height) * 0.055);
  pop();
}

/* =====================================================================
   摄像头 + ml5.handPose
   ===================================================================== */
function startCamera() {
  video = document.getElementById('cam');
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    fallbackMouse('浏览器不支持摄像头');
    return;
  }
  navigator.mediaDevices.getUserMedia({
    video: { width: CAM_W, height: CAM_H, facingMode: 'user' }, audio: false
  }).then(stream => {
    video.srcObject = stream;
    video.play();
    camOK = true;
    hideBoot();                                   // 画面先出来，模型后台接着下
    setPose('正在加载手势模型…');
    loadModel(false);                             // 通道一：mediapipe（CDN 直取）
    setTimeout(() => {                            // 通道一不行 → 换 tfjs
      if (!modelOK && !triedMP) { triedMP = true; setPose('换备用通道加载模型…'); loadModel(true); }
    }, 14000);
    setTimeout(() => {
      if (!modelOK) fallbackMouse('手势模型加载失败');
    }, 32000);
  }).catch(() => {
    fallbackMouse('摄像头不可用');
  });
}

function loadModel(useTfjs) {
  if (typeof ml5 === 'undefined') { fallbackMouse('ml5.js 未加载'); return; }
  try {
    const opt = { maxHands: 1, flipped: false, modelType: 'full' };
    if (!useTfjs) {
      opt.runtime = 'mediapipe';                  // 通道一：CDN 取模型
      opt.solutionPath = 'https://cdn.jsdelivr.net/npm/@mediapipe/hands';
    }                                             // 通道二：tfjs 默认（tfhub）
    handPose = ml5.handPose(opt, () => {
      if (modelOK) return;
      modelOK = true;
      handPose.detectStart(video, gotHands);
      hideBoot();
      setPose('请伸手 · 检测中');
    });
  } catch (e) {
    fallbackMouse('模型初始化异常');
  }
}

function gotHands(results) { hands = results || []; }

function fallbackMouse(why) {
  camOK = false; mode = 'mouse';
  hideBoot();
  setPose('鼠标模式 · ' + why);
  document.getElementById('st-mode').textContent = '鼠标模式';
  const b = document.getElementById('b-mouse');
  if (b) b.textContent = '摄像头模式';
  document.getElementById('cam').classList.add('hidden');
}

/* 关键点映射到画布（自拍镜像 + 等比适配） */
function hk(hand) {
  const vw = (video && video.videoWidth) || CAM_W;
  const vh = (video && video.videoHeight) || CAM_H;
  const sc = height / vh;
  const ox = (width - vw * sc) / 2;
  return hand.keypoints.map(p => ({
    x: ox + (vw - p.x) * sc,
    y: p.y * sc
  }));
}

/* =====================================================================
   手势 → 烟花
   ===================================================================== */
function handleInput() {
  let tx = null, ty = null, pose = 'none';
  const now = millis();

  if (mode === 'cam' && camOK && hands.length > 0) {
    const k = hk(hands[0]);
    if (k.length < 21) return;
    const ext = (tip, pip) =>
      dist(k[tip].x, k[tip].y, k[0].x, k[0].y) >
      dist(k[pip].x, k[pip].y, k[0].x, k[0].y) * 1.12;

    const eI = ext(8, 6), eM = ext(12, 10), eR = ext(16, 14), eP = ext(20, 18), eT = ext(4, 3);
    const cnt = [eI, eM, eR, eP, eT].filter(Boolean).length;

    if (cnt >= 4) pose = 'open';
    else if (eI && !eM && !eR && !eP) pose = 'point';
    else if (cnt === 0) pose = 'fist';
    else pose = 'none';

    tx = k[8].x; ty = k[8].y;
    G.kp = k;

    if (pose === 'point' && now - lastFire > COOL_PT) {
      launch(tx, ty - random(10, 60), true); lastFire = now;
    } else if (pose === 'open' && now - lastFire > COOL_OP) {
      launch(tx + random(-50, 50), ty - random(20, 90), false); lastFire = now;
    } else if (pose === 'fist') {
      charge = Math.min(CHARGE_MAX, charge + deltaTime);
      wasFist = true;
    }

    if (pose !== 'fist' && wasFist) {
      wasFist = false;
      volley(tx, ty - 60);
      charge = 0;
    }
    if (pose !== 'fist') charge = Math.max(0, charge - deltaTime * 1.6);

    setPose(modelOK
      ? ({ point: '指点 · 单发', open: '张掌 · 连放', fist: '握拳 · 蓄力', none: '待势' })[pose]
      : '模型加载中…');

  } else if (mode === 'mouse') {
    tx = mouseX; ty = mouseY;
    if (mouseIsPressed && now - lastFire > COOL_OP) {
      launch(tx + random(-40, 40), ty - random(10, 70), false);
      lastFire = now;
    }
    setPose('鼠标模式 · 移动瞄准');
  } else {
    setPose(modelOK ? '未检测到手' : '模型加载中…');
    return;
  }

  // 平滑笔尖
  if (!ptr) ptr = { x: tx, y: ty };
  ptr.x = lerp(ptr.x, tx, 0.35);
  ptr.y = lerp(ptr.y, ty, 0.35);
  G.ptr = ptr;
  G.charge = charge / CHARGE_MAX;
}

/* 骨架叠加 */
function drawSkeleton() {
  const k = G.kp;
  if (!k || mode !== 'cam') return;
  push();
  stroke(255, 208, 120, 190);
  strokeWeight(1.7);
  for (const [a, b] of CONN) line(k[a].x, k[a].y, k[b].x, k[b].y);
  noStroke();
  for (let i = 0; i < k.length; i++) {
    fill(i === 8 ? color(120, 255, 214) : color(255, 236, 190), i === 8 ? 255 : 200);
    circle(k[i].x, k[i].y, i === 8 ? 11 : 5.5);
  }
  // 指尖火种
  const p = G.ptr;
  if (p) {
    noStroke();
    for (let i = 3; i >= 1; i--) { fill(255, 190, 110, 26 * i); circle(p.x, p.y, 14 + i * 12); }
    fill(255, 240, 200, 240); circle(p.x, p.y, 5);
    // 蓄力环
    if (G.charge > 0.02) {
      noFill(); stroke(255, 200, 110, 230); strokeWeight(2.6);
      arc(p.x, p.y, 40, 40, -HALF_PI, -HALF_PI + TWO_PI * G.charge);
    }
  }
  pop();
}

/* =====================================================================
   鼠标 / 键盘
   ===================================================================== */
function mousePressed() {
  if (mode !== 'mouse' || millis() < uiLock) return;
  launch(mouseX, mouseY - random(10, 50), true);
  lastFire = millis();
}
function doubleClicked() {
  if (mode !== 'mouse' || millis() < uiLock) return;
  volley(mouseX, mouseY);
}
function keyPressed() {
  if (key === ' ') {
    const p = (mode === 'cam' && G.ptr) ? G.ptr : { x: mouseX, y: mouseY };
    volley(p.x, p.y);
    return false;                 // 阻止页面滚动
  }
}

/* =====================================================================
   界面
   ===================================================================== */
function bindUI() {
  const lock = () => { uiLock = millis() + 260; };

  document.getElementById('b-clear').onclick = () => {
    lock(); sparks = []; rockets = []; fx.clear();
  };
  document.getElementById('b-save').onclick = () => {
    lock(); saveCanvas('qianli-jiangshan-fireworks', 'png');
  };
  document.getElementById('b-skel').onclick = e => {
    lock(); showSkel = !showSkel;
    e.target.textContent = '骨架：' + (showSkel ? '开' : '关');
  };
  document.getElementById('b-camv').onclick = e => {
    lock(); showCam = !showCam;
    document.getElementById('cam').classList.toggle('hidden', !showCam);
    e.target.textContent = '预览：' + (showCam ? '开' : '关');
  };
  document.getElementById('b-mouse').onclick = e => {
    lock();
    if (mode === 'mouse' && camOK) {
      mode = 'cam';
      e.target.textContent = '鼠标模式';
      document.getElementById('st-mode').textContent = '摄像头模式';
      document.getElementById('cam').classList.toggle('hidden', !showCam);
    } else {
      mode = 'mouse';
      e.target.textContent = '摄像头模式';
      document.getElementById('st-mode').textContent = '鼠标模式';
      document.getElementById('cam').classList.add('hidden');
    }
  };
}

function setPose(txt) {
  if (txt === poseTxt) return;
  poseTxt = txt;
  const el = document.getElementById('st-pose');
  if (el) el.textContent = txt;
  const bs = document.getElementById('boot-sub');
  if (bs) bs.textContent = txt;
}

function updateHUD() {
  const a = document.getElementById('st-lit');
  const b = document.getElementById('st-score');
  if (a) a.textContent = '江山 ' + litCount + ' / ' + NODE_N;
  if (b) b.textContent = score + ' 分';
}

function hideBoot() {
  const b = document.getElementById('boot');
  if (b) { b.classList.add('gone'); setTimeout(() => (b.style.display = 'none'), 800); }
}
