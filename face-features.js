/* 얼굴 랜드마크(MediaPipe 478점) → 비율 8개 + 측정 상태.
   브라우저와 Node에서 모두 쓸 수 있게 만들었다. 이미지·랜드마크는 어디에도 저장하지 않는다. */
(function (root) {
  // 점 번호는 MediaPipe 얼굴 메시 기준 (화면에 찍어 눈으로 확인한 번호들)
  const IDX = {
    top: 10, chin: 152, cheekL: 234, cheekR: 454,
    eyeOuterL: 33, eyeInnerL: 133, eyeInnerR: 362, eyeOuterR: 263,
    browInnerL: 107, browInnerR: 336,
    noseTip: 1, noseBase: 2, lipTop: 0, lipInTop: 13, lipInBot: 14,
    mouthL: 61, mouthR: 291, jawL: 172, jawR: 397,
  };

  const FEATURES = [
    { key: 'eyeGap',   label: '눈 사이 / 눈 너비',    unit: '배', digits: 2 },
    { key: 'tilt',     label: '눈꼬리 각도',           unit: '°',  digits: 1 },
    { key: 'browGap',  label: '미간 / 얼굴 너비',      unit: '%',  digits: 1 },
    { key: 'philtrum', label: '인중 / 얼굴 길이',      unit: '%',  digits: 1 },
    { key: 'mouthUp',  label: '입꼬리 높이',           unit: '%',  digits: 1 },
    { key: 'mouthW',   label: '입 너비 / 얼굴 너비',   unit: '%',  digits: 1 },
    { key: 'jaw',      label: '턱 너비 / 얼굴 너비',   unit: '%',  digits: 1 },
    { key: 'aspect',   label: '얼굴 너비 / 길이',      unit: '%',  digits: 1 },
  ];

  // 기본 기준값(임시). 실제 얼굴 수십 명을 ?calib=1 로 재면 서버가 평균·표준편차를 다시 계산해 덮어쓴다.
  const DEFAULT_REF = {
    eyeGap:   { mean: 1.05, sd: 0.12 },
    tilt:     { mean: 5.0,  sd: 3.0 },
    browGap:  { mean: 17.0, sd: 2.2 },
    philtrum: { mean: 10.0, sd: 1.4 },
    mouthUp:  { mean: 0.0,  sd: 1.0 },
    mouthW:   { mean: 36.0, sd: 3.0 },
    jaw:      { mean: 76.0, sd: 5.0 },
    aspect:   { mean: 78.0, sd: 5.0 },
  };

  function measure(lm, w, h) {
    if (!lm || lm.length < 468) return null;
    const P = (i) => ({ x: lm[i].x * w, y: lm[i].y * h });
    const pts = {};
    for (const k in IDX) pts[k] = P(IDX[k]);

    // 고개가 살짝 기울어도 눈 높이를 가로로 맞춰서 잰다
    const eL = { x: (pts.eyeOuterL.x + pts.eyeInnerL.x) / 2, y: (pts.eyeOuterL.y + pts.eyeInnerL.y) / 2 };
    const eR = { x: (pts.eyeOuterR.x + pts.eyeInnerR.x) / 2, y: (pts.eyeOuterR.y + pts.eyeInnerR.y) / 2 };
    const roll = Math.atan2(eR.y - eL.y, eR.x - eL.x);
    const c = Math.cos(roll), s = Math.sin(roll);
    const rot = (p) => ({ x: p.x * c + p.y * s, y: -p.x * s + p.y * c });
    const R = {};
    for (const k in pts) R[k] = rot(pts[k]);

    const d = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
    const L = d(pts.top, pts.chin);
    const W = d(pts.cheekL, pts.cheekR);
    const eyeWidth = (d(pts.eyeOuterL, pts.eyeInnerL) + d(pts.eyeOuterR, pts.eyeInnerR)) / 2;

    const tiltL = Math.atan2(R.eyeInnerL.y - R.eyeOuterL.y, R.eyeInnerL.x - R.eyeOuterL.x);
    const tiltR = Math.atan2(R.eyeInnerR.y - R.eyeOuterR.y, R.eyeOuterR.x - R.eyeInnerR.x);

    const yMid = (R.lipInTop.y + R.lipInBot.y) / 2;
    const yCorner = (R.mouthL.y + R.mouthR.y) / 2;
    const mouthWidth = d(pts.mouthL, pts.mouthR);

    const f = {
      eyeGap:   d(pts.eyeInnerL, pts.eyeInnerR) / eyeWidth,
      tilt:     ((tiltL + tiltR) / 2) * 180 / Math.PI,
      browGap:  d(pts.browInnerL, pts.browInnerR) / W * 100,
      philtrum: d(pts.noseBase, pts.lipTop) / L * 100,
      mouthUp:  (yMid - yCorner) / L * 100,
      mouthW:   mouthWidth / W * 100,
      jaw:      d(pts.jawL, pts.jawR) / W * 100,
      aspect:   W / L * 100,
    };

    // 측정이 믿을 만한 자세인지 보는 값들
    const eyeMidY = (R.eyeInnerL.y + R.eyeInnerR.y) / 2;
    const state = {
      yaw: (pts.noseTip.x - pts.cheekL.x) / ((pts.cheekR.x - pts.cheekL.x) || 1) - 0.5, // 0 이면 정면
      pitch: (R.noseTip.y - eyeMidY) / ((R.chin.y - eyeMidY) || 1),                      // 정면이면 일정
      rollDeg: roll * 180 / Math.PI,
      open: d(pts.lipInTop, pts.lipInBot) / (mouthWidth || 1),                           // 입 벌림
      size: W / w,                                                                       // 화면 대비 얼굴 폭
      cx: (pts.cheekL.x + pts.cheekR.x) / 2 / w,
      cy: (pts.top.y + pts.chin.y) / 2 / h,
    };
    return { f, state };
  }

  function median(a) {
    const b = a.slice().sort((x, y) => x - y);
    const n = b.length;
    return n % 2 ? b[(n - 1) / 2] : (b[n / 2 - 1] + b[n / 2]) / 2;
  }
  function medianFeatures(list) {
    const out = {};
    FEATURES.forEach(({ key }) => { out[key] = median(list.map((m) => m[key])); });
    return out;
  }
  function zScores(f, ref) {
    const z = {};
    FEATURES.forEach(({ key }) => {
      const r = (ref && ref[key]) || DEFAULT_REF[key];
      z[key] = (f[key] - r.mean) / (r.sd || 1);
    });
    return z;
  }

  const api = { IDX, FEATURES, DEFAULT_REF, measure, medianFeatures, zScores, median };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.FaceFeatures = api;
})(typeof window !== 'undefined' ? window : globalThis);
