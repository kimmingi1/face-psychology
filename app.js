/* 관상 심리전 — 체험 화면.
   얼굴 영상·사진은 이 화면 안에서만 읽고 어디에도 저장·전송하지 않는다.
   이름과 비밀 답은 메모리에만 두고, 서버에는 "맞혔나 / 관상이 맞혔나 / 관상을 따랐나" 숫자만 보낸다. */
(() => {
  'use strict';
  const FF = window.FaceFeatures, Core = window.PsychCore, Q = Core.QUESTIONS;
  const $ = (s) => document.querySelector(s);
  const qs = new URLSearchParams(location.search);
  const CALIB = qs.get('calib') === '1';          // 기준값용 얼굴 측정 모드 (한 명씩 재서 수치만 기록)
  const RELAX = qs.get('relax') === '1';          // 시험용: 입 다묾·고개 숙임 검사를 건너뜀
  const MUTE = qs.get('mute') === '1';
  const IDLE_MS = 120_000;                        // 2분 동안 아무 입력이 없으면 처음으로
  const INK = '#2a221b';

  // ---------- 소리 (작게. ?mute=1 이면 끔) ----------
  let ac = null;
  function tone(freq, dur = 0.07, type = 'triangle', vol = 0.04, delay = 0) {
    if (MUTE) return;
    try {
      ac = ac || new (window.AudioContext || window.webkitAudioContext)();
      if (ac.state === 'suspended') ac.resume();
      const t0 = ac.currentTime + delay, o = ac.createOscillator(), g = ac.createGain();
      o.type = type; o.frequency.value = freq;
      g.gain.setValueAtTime(vol, t0); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      o.connect(g); g.connect(ac.destination); o.start(t0); o.stop(t0 + dur + 0.02);
    } catch { /* 소리가 안 나도 진행에는 문제없다 */ }
  }
  const chime = () => [523, 784, 1047].forEach((f, i) => tone(f, 0.18, 'triangle', 0.05, i * 0.1));
  addEventListener('pointerdown', (e) => { if (e.target.closest && e.target.closest('button')) tone(660, 0.05); }, true);

  // ---------- 상태 ----------
  const fresh = () => ({
    screen: 's-start', rel: null, names: ['', ''], idx: 0, f: [null, null], lean: [null, null], praise: [null, null],
    demo: [false, false], secret: [[], []], guess: [[], []], ref: null,
  });
  const state = fresh();
  const label = (i) => (state.names[i] ? state.names[i] + ' 님' : (i ? '乙 손님' : '甲 손님'));   // 항상 "님"으로 끝난다

  // ---------- 화면 전환 ----------
  function show(id) {
    document.querySelectorAll('.screen').forEach((s) => s.classList.toggle('on', s.id === id));
    const dot = Number(document.getElementById(id).dataset.dot || 0);
    document.querySelectorAll('#dots i').forEach((d, k) => d.classList.toggle('on', k < dot));
    state.screen = id;
    touch();
  }
  let idleTimer = null;
  function touch() { clearTimeout(idleTimer); if (state.screen !== 's-start') idleTimer = setTimeout(restart, IDLE_MS); }
  ['pointerdown', 'keydown'].forEach((e) => addEventListener(e, touch, { passive: true }));
  function toast(t) { const el = $('#toast'); el.textContent = t; el.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => { el.hidden = true; }, 2200); }

  function restart() {
    stopScan(); loadToken++; clearInterval(loadTimer); clearTimeout(lockT);
    const keepRef = state.ref;
    Object.assign(state, fresh(), { ref: keepRef });
    $('#name0').value = ''; $('#name1').value = '';
    document.querySelectorAll('#rel-choices .choice').forEach((b) => b.classList.remove('pick'));
    $('#btn-pair').disabled = true; $('#photo-msg').hidden = true;
    show('s-start');
  }
  $('#btn-home').addEventListener('click', restart);
  $('#btn-again').addEventListener('click', restart);

  // ---------- 서버 · 이 기기 통계 ----------
  async function getJson(url) { const r = await fetch(url, { cache: 'no-store' }); if (!r.ok) throw new Error(r.status); return r.json(); }
  async function postJson(url, body) {
    const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || r.status);
    return j;
  }
  async function loadRef() { try { const j = await getJson('api/ref'); state.ref = j.ref; } catch { state.ref = null; } }
  const LS_KEY = 'face-psych-rounds-v1';
  let localRounds = [];
  try { localRounds = JSON.parse(localStorage.getItem(LS_KEY) || '[]'); } catch { localRounds = []; }
  function addLocalRound(r) { localRounds.push(r); try { localStorage.setItem(LS_KEY, JSON.stringify(localRounds.slice(-300))); } catch { /* 저장이 막혀도 이번 방문 동안은 센다 */ } }

  // ---------- 얼굴 그림 (잰 비율로 선 그림을 그린다. 사진은 쓰지 않는다) ----------
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  function smooth(pts) {
    const n = pts.length; let d = `M ${pts[0][0].toFixed(1)} ${pts[0][1].toFixed(1)}`;
    for (let i = 0; i < n; i++) {
      const p0 = pts[(i - 1 + n) % n], p1 = pts[i], p2 = pts[(i + 1) % n], p3 = pts[(i + 2) % n];
      const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
      const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
      d += ` C ${c1[0].toFixed(1)} ${c1[1].toFixed(1)}, ${c2[0].toFixed(1)} ${c2[1].toFixed(1)}, ${p2[0].toFixed(1)} ${p2[1].toFixed(1)}`;
    }
    return d + ' Z';
  }
  function faceSVG(f, color = INK) {
    const W = clamp(112 * f.aspect / 78, 90, 140);
    const J = clamp(W * f.jaw / 100, 62, W);
    const right = [[W * 0.30, 32], [W * 0.46, 62], [W * 0.5, 104], [J * 0.5, 172], [J * 0.28, 207]];
    const left = right.map(([x, y]) => [-x, y]).reverse();
    const pts = [[0, 24], ...right, [0, 220], ...left].map(([x, y]) => [100 + x, y]);
    const eyeY = 98, ew = W * 0.17, g = clamp(f.eyeGap, 0.6, 1.8) * ew, tan = Math.tan(clamp(f.tilt, -10, 22) * Math.PI / 180);
    let parts = `<path d="${smooth(pts)}"/>`;
    for (const s of [-1, 1]) {
      const ix = 100 + s * g / 2, ox = ix + s * ew, oy = eyeY - tan * ew, mx = (ix + ox) / 2;
      parts += `<path d="M ${ix} ${eyeY} Q ${mx} ${eyeY - 7} ${ox} ${oy} Q ${mx} ${eyeY + 7} ${ix} ${eyeY}"/>`;
      parts += `<circle cx="${mx}" cy="${(eyeY + oy) / 2}" r="3" fill="${color}" stroke="none"/>`;
      const bi = (clamp(f.browGap, 8, 32) / 100) * W / 2, bx1 = 100 + s * bi, bx2 = 100 + s * (bi + ew * 1.15);
      parts += `<path d="M ${bx1} ${eyeY - 19} Q ${(bx1 + bx2) / 2} ${eyeY - 26 - tan * 8} ${bx2} ${eyeY - 21 - tan * ew * 0.6}"/>`;
    }
    const noseBase = 142;
    parts += `<path d="M 99 ${eyeY + 8} L 96 ${noseBase - 2} Q 100 ${noseBase + 5} 104 ${noseBase - 2} L 101 ${eyeY + 8}"/>`;
    const lipTop = noseBase + (clamp(f.philtrum, 5, 16) / 100) * 196;
    const mw = (clamp(f.mouthW, 25, 55) / 100) * W, up = (clamp(f.mouthUp, -4, 8) / 100) * 196, cy = lipTop + 4 - up;
    parts += `<path d="M ${100 - mw / 2} ${cy} Q ${100 - mw / 4} ${lipTop - 1} 100 ${lipTop} Q ${100 + mw / 4} ${lipTop - 1} ${100 + mw / 2} ${cy} Q 100 ${lipTop + 14} ${100 - mw / 2} ${cy}"/>`;
    return `<svg viewBox="0 0 200 240" fill="none" stroke="${color}" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round">${parts}</svg>`;
  }
  function gauss() { let u = 0, v = 0; while (!u) u = Math.random(); while (!v) v = Math.random(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }
  function randomFace(spread = 1) {
    const ref = state.ref || FF.DEFAULT_REF, f = {};
    FF.FEATURES.forEach(({ key }) => { const r = ref[key] || FF.DEFAULT_REF[key]; f[key] = r.mean + clamp(gauss() * spread, -2.4, 2.4) * r.sd; });
    return f;
  }

  // ---------- 시작 · 두 사람 ----------
  $('#btn-start').addEventListener('click', () => { if (CALIB) { state.idx = 0; beginCamera(); } else show('s-pair'); });
  document.querySelectorAll('#rel-choices .choice').forEach((b) => b.addEventListener('click', () => {
    state.rel = b.dataset.rel;
    document.querySelectorAll('#rel-choices .choice').forEach((x) => x.classList.toggle('pick', x === b));
    $('#btn-pair').disabled = false;
  }));
  const clean = (s) => s.replace(/[\u0000-\u001f\u007f<>&"']/g, '').trim().slice(0, 8);
  $('#btn-pair').addEventListener('click', () => {
    if (!state.rel) return;
    state.names = [clean($('#name0').value), clean($('#name1').value)];
    startMeasure(0);
  });
  ['#name0', '#name1'].forEach((s) => $(s).addEventListener('keydown', (e) => { if (e.key === 'Enter' && state.rel) { e.preventDefault(); $('#btn-pair').click(); } }));

  function startMeasure(i) {
    state.idx = i;
    $('#c-kick').textContent = `${label(i)} 차례 (${i + 1} / 2)`;
    $('#photo-msg').hidden = true;
    show('s-consent');
  }
  $('#btn-cam').addEventListener('click', () => beginCamera());
  $('#btn-demo').addEventListener('click', () => useDemo());
  $('#btn-scan-demo').addEventListener('click', () => useDemo());
  $('#btn-photo').addEventListener('click', () => $('#photo-input').click());
  $('#btn-scan-photo').addEventListener('click', () => { stopScan(); show('s-consent'); $('#photo-input').click(); });
  $('#photo-input').addEventListener('change', (e) => { const f = e.target.files && e.target.files[0]; e.target.value = ''; if (f) measurePhoto(f); });
  $('#btn-scan-cancel').addEventListener('click', restart);

  function useDemo() {
    stopScan();
    state.demo[state.idx] = true;
    state.f[state.idx] = randomFace(1.1);
    gotoCard();
  }

  // ---------- 카메라 측정 ----------
  let stream = null, fm = null, fmReady = null, scanning = false, good = [], bad = 0, scanTimer = null, busy = false, pendingPhoto = null;
  const video = $('#video'), overlay = $('#overlay'), octx = overlay.getContext('2d');
  const NEED = 22;
  function setMsg(t, ok) { const m = $('#scan-msg'); m.textContent = t; m.className = 'msg' + (ok ? ' ok' : ''); }
  function setBar(p) { $('#scan-bar').style.width = Math.round(p * 100) + '%'; }

  function initMesh() {
    if (fmReady) return fmReady;
    fmReady = (async () => {
      fm = new FaceMesh({ locateFile: (f) => f });
      fm.setOptions({ maxNumFaces: 1, refineLandmarks: true, minDetectionConfidence: 0.6, minTrackingConfidence: 0.6 });
      fm.onResults(onResults);
      await fm.initialize();
    })();
    fmReady.catch(() => { fmReady = null; });
    return fmReady;
  }
  async function beginCamera() {
    show('s-scan'); good = []; bad = 0; setBar(0);
    $('#ring').className = 'ring'; $('#btn-scan-demo').hidden = true; $('#btn-scan-photo').hidden = true;
    setMsg('카메라를 켜는 중…');
    await loadRef();
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw new Error('이 주소에서는 카메라를 쓸 수 없어요(localhost 또는 https 필요).');
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
      video.srcObject = stream; await video.play();
      setMsg('얼굴 인식 준비 중… (처음 한 번은 몇 초 걸려요)');
      await initMesh();
    } catch (e) {
      stopScan();
      setMsg(`카메라를 쓸 수 없어요: ${e.message || e.name}`);
      $('#btn-scan-demo').hidden = false; $('#btn-scan-photo').hidden = false;
      return;
    }
    scanning = true;
    clearTimeout(scanTimer);
    scanTimer = setTimeout(() => { if (scanning) { setMsg('잘 안 보이면 사진으로 보거나 카메라 없이 체험할 수도 있어요.'); $('#btn-scan-demo').hidden = false; $('#btn-scan-photo').hidden = false; } }, 30_000);
    setMsg('얼굴을 동그라미 안에 맞춰 주세요');
    loop();
  }
  function stopScan() {
    scanning = false; clearTimeout(scanTimer);
    if (stream) { stream.getTracks().forEach((t) => t.stop()); stream = null; }
    try { video.srcObject = null; } catch { /* */ }
    octx.clearRect(0, 0, overlay.width, overlay.height);
  }
  async function loop() {
    if (!scanning) return;
    if (!busy && video.readyState >= 2 && video.videoWidth) {
      busy = true;
      try { await fm.send({ image: video }); } catch { /* 한 프레임 건너뜀 */ }
      busy = false;
    }
    if (scanning) requestAnimationFrame(loop);
  }
  function onResults(r) {
    if (pendingPhoto) { const cb = pendingPhoto; pendingPhoto = null; cb(r); return; }
    if (!scanning) return;
    const vw = video.videoWidth, vh = video.videoHeight;
    if (overlay.width !== vw) { overlay.width = vw; overlay.height = vh; }
    octx.clearRect(0, 0, vw, vh);
    const lm = r.multiFaceLandmarks && r.multiFaceLandmarks[0];
    const m = lm ? FF.measure(lm, vw, vh) : null;
    let problem = null;
    if (!m) problem = '얼굴이 보이지 않아요. 화면 가운데로 와 주세요';
    else {
      const s = m.state;
      if (s.size < 0.17) problem = '조금만 더 가까이 와 주세요';
      else if (s.size > 0.62) problem = '조금만 뒤로 물러나 주세요';
      else if (Math.abs(s.cx - 0.5) > 0.2) problem = '화면 가운데로 와 주세요';
      else if (Math.abs(s.yaw) > 0.07) problem = '정면을 바라봐 주세요';
      else if (Math.abs(s.rollDeg) > 12) problem = '고개를 곧게 세워 주세요';
      else if (!RELAX && (s.pitch < 0.26 || s.pitch > 0.47)) problem = '고개를 똑바로 들어 주세요';
      else if (!RELAX && s.open > 0.07) problem = '입을 다물고 무표정으로 봐 주세요';
    }
    $('#ring').className = 'ring' + (problem ? '' : ' good');
    if (lm) {   // 얼굴 위에 아주 옅은 점만 찍어 "읽고 있다"는 느낌만 준다
      octx.fillStyle = problem ? 'rgba(255,255,255,.2)' : 'rgba(255,255,255,.6)';
      for (let i = 0; i < lm.length; i += 3) octx.fillRect(lm[i].x * vw - 1, lm[i].y * vh - 1, 2, 2);
    }
    if (problem) { if (++bad > 4) { good = []; setBar(0); } setMsg(problem); return; }
    bad = 0; good.push(m.f); setBar(good.length / NEED); setMsg('그대로 있어 주세요…', true);
    if (good.length >= NEED) finishScan();
  }

  // 사진 한 장으로 재기. 사진은 이 화면 안의 캔버스에서만 읽고 어디에도 보내지 않는다.
  async function measurePhoto(file) {
    const msg = $('#photo-msg');
    const say = (t) => { msg.textContent = t; msg.hidden = !t; };
    const lock = (on) => ['#btn-cam', '#btn-photo', '#btn-demo'].forEach((s) => { $(s).disabled = on; });
    if (!/^image\//.test(file.type)) return say('이미지 파일을 골라 주세요.');
    if (file.size > 25 * 1024 * 1024) return say('사진이 너무 커요. 25MB 이하로 골라 주세요.');
    lock(true); say('사진을 읽는 중… (처음 한 번은 몇 초 걸려요)');
    try {
      await initMesh();
      let bmp;
      try { bmp = await createImageBitmap(file); }
      catch { const img = new Image(); const u = URL.createObjectURL(file); img.src = u; await img.decode(); URL.revokeObjectURL(u); bmp = img; }
      const bw = bmp.width, bh = bmp.height, k = Math.min(1, 1280 / Math.max(bw, bh));
      const w = Math.round(bw * k), h = Math.round(bh * k);
      const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
      cv.getContext('2d').drawImage(bmp, 0, 0, w, h);
      if (bmp.close) bmp.close();
      const r = await new Promise((resolve, reject) => {
        const t = setTimeout(() => { pendingPhoto = null; reject(new Error('시간이 너무 오래 걸려요')); }, 25_000);
        pendingPhoto = (res) => { clearTimeout(t); resolve(res); };
        fm.send({ image: cv }).catch((e) => { clearTimeout(t); pendingPhoto = null; reject(e); });
      });
      cv.width = cv.height = 0; // 읽은 사진은 바로 지운다
      const lm = r.multiFaceLandmarks && r.multiFaceLandmarks[0];
      const m = lm ? FF.measure(lm, w, h) : null;
      if (!m) return say('얼굴을 찾지 못했어요. 얼굴이 크게 나온 정면 사진으로 골라 주세요.');
      if (Math.abs(m.state.yaw) > 0.12 || Math.abs(m.state.rollDeg) > 20) return say('고개가 많이 돌아가 있어요. 정면을 보는 사진으로 골라 주세요.');
      await loadRef();
      state.f[state.idx] = m.f; state.demo[state.idx] = false;
      say('');
      gotoCard();
    } catch (e) {
      pendingPhoto = null;
      say('사진을 읽지 못했어요: ' + (e.message || e));
    } finally { lock(false); }
  }

  async function finishScan() {
    scanning = false;
    const f = FF.medianFeatures(good);
    stopScan();
    if (CALIB) {
      try { const j = await postJson('api/calib', { f }); toast(`기록됐어요 (${j.n}명째)`); await loadRef(); } catch (e) { toast('기록 실패: ' + e.message); }
      setTimeout(beginCamera, 1500);
      return;
    }
    state.f[state.idx] = f; state.demo[state.idx] = false;
    gotoCard();
  }

  // ---------- 분석 중 → 접수 카드 ----------
  let loadTimer = null, loadToken = 0;
  function runLoading(done) {
    const token = ++loadToken;
    show('s-loading');
    const log = $('#load-log'), bar = $('#load-bar');
    log.innerHTML = ''; bar.style.width = '0%';
    const steps = [`${label(state.idx)}의 얼굴을 접수하는 중…`, '삼정(三停)의 비율을 대조하는 중…', '오악(五嶽)의 균형을 확인하는 중…', '좋은 말만 골라 담는 중…', '직인을 말리는 중…'];
    let i = 0; clearInterval(loadTimer);
    const step = () => {
      if (token !== loadToken) { clearInterval(loadTimer); return; }
      if (i < steps.length) {
        const d = document.createElement('div'); d.textContent = steps[i]; log.appendChild(d);
        while (log.children.length > 4) log.removeChild(log.firstChild);
        bar.style.width = Math.round(((i + 1) / steps.length) * 100) + '%';
        tone(480 + i * 60, 0.05, 'triangle', 0.03); i++;
      } else { clearInterval(loadTimer); chime(); setTimeout(() => { if (token === loadToken) done(); }, 400); }
    };
    step(); loadTimer = setInterval(step, 520);
  }
  function gotoCard() {
    const i = state.idx, f = state.f[i];
    const z = FF.zScores(f, state.ref);
    state.lean[i] = Core.leans(z);
    state.praise[i] = Core.praise(z);
    runLoading(() => renderCard(i));
  }
  function renderCard(i) {
    $('#card-kick').textContent = `${label(i)} · 관상 접수 완료`;
    $('#card-face').innerHTML = faceSVG(state.f[i]);
    $('#card-who').innerHTML = `<b>相</b>${label(i)}`;
    $('#card-reads').innerHTML = state.praise[i].map((r) => `<div class="k">${r.t}</div><p class="d">${r.d}</p>`).join('');
    $('#btn-card-next').textContent = i === 0 ? '다음 분 차례' : '비밀 답으로';
    show('s-card');
  }
  $('#btn-card-next').addEventListener('click', () => { if (state.idx === 0) startMeasure(1); else beginSecret(0); });

  // ---------- 자리 안내 ----------
  let turnCb = null;
  function showTurn({ kick, big, sub, btn = '준비됐어요', dot, on }) {
    $('#t-kick').textContent = kick; $('#t-big').textContent = big; $('#t-sub').textContent = sub; $('#btn-turn').textContent = btn;
    turnCb = on; show('s-turn');
  }
  $('#btn-turn').addEventListener('click', () => { const cb = turnCb; turnCb = null; if (cb) cb(); });

  // 같은 버튼을 두 번 눌러 두 문항이 한꺼번에 넘어가는 일을 막는다
  let lockT = null, locked = false;
  function lockBriefly() { locked = true; clearTimeout(lockT); lockT = setTimeout(() => { locked = false; }, 350); }
  function renderChoices(box, opts, onPick) {
    box.innerHTML = '';
    opts.forEach((txt, k) => {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'choice'; b.textContent = txt;
      b.addEventListener('click', () => { if (locked) return; lockBriefly(); onPick(k); });
      box.appendChild(b);
    });
  }

  // ---------- 비밀 답 ----------
  function beginSecret(p) {
    state.secret[p] = [];
    showTurn(p === 0
      ? { kick: '비밀 답', big: `${label(1)}은 돌아앉아 주세요`, sub: `${label(0)}만 화면을 보고, 질문 5개에 몰래 답해 주세요.`, on: () => askSecret(0, 0) }
      : { kick: '비밀 답', big: `${label(0)}의 답은 가려졌어요`, sub: `이제 ${label(1)} 차례예요. ${label(0)}은 돌아앉아 주세요.`, on: () => askSecret(1, 0) });
  }
  function askSecret(p, q) {
    $('#sec-head').innerHTML = `<b>${label(p)}</b>의 비밀 답 · ${q + 1} / ${Q.length}`;
    $('#sec-title').textContent = Q[q].title; $('#sec-ask').textContent = Q[q].ask;
    renderChoices($('#sec-choices'), Q[q].opts, (k) => {
      state.secret[p][q] = k;
      if (q < Q.length - 1) askSecret(p, q + 1);
      else if (p === 0) beginSecret(1);
      else beginGuess(1);
    });
    show('s-secret');
  }

  // ---------- 추리 ----------
  function beginGuess(g) {
    const t = 1 - g; state.guess[g] = [];
    showTurn({ kick: '추리', big: `${label(g)}이 ${label(t)}의 답을 추리해요`, sub: `이제 두 분 모두 화면을 봐도 돼요. ${label(t)}의 관상 단서를 보고 골라 보세요.`, btn: '시작',
      on: () => askGuess(g, 0) });
  }
  function askGuess(g, q) {
    const t = 1 - g, ln = state.lean[t][q];
    $('#g-head').innerHTML = `<b>${label(g)}</b>이 <b>${label(t)}</b>의 답을 추리해요 · ${q + 1} / ${Q.length}`;
    $('#g-face').innerHTML = faceSVG(state.f[t]);
    $('#g-title').textContent = Q[q].title; $('#g-ask').textContent = `${label(t)}에게 물었어요: ${Q[q].ask}`;
    $('#g-clue').innerHTML = `<b>관상 단서 · ${ln.clue[0]}</b> ${ln.clue[1]}<br><span class="stars">${'★'.repeat(ln.conf)}${'☆'.repeat(3 - ln.conf)}</span> 관상이 가리키는 쪽: <b>${Q[q].opts[ln.opt]}</b>`;
    renderChoices($('#g-choices'), Q[q].opts, (k) => {
      state.guess[g][q] = k;
      if (q < Q.length - 1) askGuess(g, q + 1);
      else if (g === 1) beginGuess(0);
      else reveal(0);
    });
    show('s-guess');
  }

  // ---------- 공개 ----------
  const mk = (ok) => `<span class="mk ${ok ? 'o' : 'x'}">${ok ? '○' : '✕'}</span>`;
  function reveal(t) {
    const g = 1 - t; let h = 0, l = 0;
    const rows = Q.map((q, i) => {
      const actual = state.secret[t][i], pick = state.guess[g][i], look = state.lean[t][i].opt;
      const hh = pick === actual, lh = look === actual; h += hh ? 1 : 0; l += lh ? 1 : 0;
      return `<div class="tr"><span class="q">${q.title}</span><span>${q.opts[actual]}</span><span class="c">${mk(hh)}</span><span class="c">${mk(lh)}</span></div>`;
    }).join('');
    $('#rv-table').innerHTML = `<div class="tr h"><span>질문</span><span>실제 답</span><span class="c">${label(g).replace(' 님', '')}의 추리</span><span class="c">관상</span></div>` + rows;
    $('#rv-kick').textContent = `公 開 · ${t + 1} / 2`;
    $('#rv-title').textContent = `${label(t)}의 답`;
    $('#rv-sum').innerHTML = `사람 <b>${h}</b> / ${Q.length} · 관상 <b>${l}</b> / ${Q.length}`;
    $('#btn-rv-next').textContent = t === 0 ? `${label(1)}의 답도 볼까요` : '결과 보기';
    $('#btn-rv-next').onclick = () => (t === 0 ? reveal(1) : finish());
    chime();
    show('s-reveal');
  }

  // ---------- 결과 ----------
  function setScore(el, n, win) { el.querySelector('.n').innerHTML = `${n}<small> / ${Q.length * 2}</small>`; el.classList.toggle('win', win); }
  async function finish() {
    const items = Core.buildItems(state.secret, state.guess, state.lean);
    const H = items.reduce((a, x) => a + x[1], 0), L = items.reduce((a, x) => a + x[2], 0);
    const F = items.reduce((a, x) => a + x[3], 0), FH = items.reduce((a, x) => a + (x[3] && x[1] ? 1 : 0), 0);
    const isDemo = state.demo.some(Boolean);
    setScore($('#sc-h'), H, H > L); setScore($('#sc-l'), L, L > H);
    $('#verdict').textContent = H > L
      ? (state.rel === 'friend' ? '아는 사이라 그런지, 관상보다 사람의 눈치가 앞섰소.' : '처음 본 사이인데도, 관상보다 사람의 눈치가 앞섰소.')
      : H < L ? '이번에는 관상이 사람보다 잘 맞혔소.' : '사람과 관상이 막상막하였소.';
    $('#fine1').textContent = F ? `관상을 따라 고른 ${F}번 중 ${FH}번이 맞았어요. 찍어서 맞힐 평균은 10문제 중 5개예요.` : `관상을 따른 선택은 없었어요. 찍어서 맞힐 평균은 10문제 중 5개예요.`;
    $('#fine2').textContent = '전시 전체 기록을 모으는 중…';
    show('s-final'); chime();

    if (CALIB) { $('#fine2').textContent = ''; return; }
    const body = { rel: state.rel || 'stranger', mode: isDemo ? 'demo' : 'camera', items };
    let s;
    try { s = (await postJson('api/round', body)).stats; }
    catch { addLocalRound({ ...body, t: Date.now() }); s = Core.summarize(localRounds); s.local = true; }
    if (state.screen !== 's-final') return;
    $('#fine2').textContent = isDemo ? '카메라 없이 체험한 판은 전시 통계에 넣지 않아요.'
      : s.n ? `${s.local ? '이 기기에서' : '지금까지'} ${s.n}쌍이 해 봤어요 — 사람 ${s.humanPct}% · 관상 ${s.lookPct}%` : '';
  }

  restart();
})();
