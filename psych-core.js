/* 관상 심리전 — 질문, 관상 단서 규칙, 통계 계산.
   브라우저와 Node(서버)에서 같은 코드를 쓴다. 얼굴·이름·답변 내용은 여기서도, 서버에서도 다루지 않는다. */
(function (root) {
  // 질문 5개. 각 질문은 얼굴 비율 하나와 짝지어 "관상이 가리키는 쪽"을 정한다.
  // (z >= 0 이면 hi 쪽, 아니면 lo 쪽. 이 짝짓기는 재미로 정한 규칙이고, 맞는지 보는 것이 이 전시의 목적이다.)
  const QUESTIONS = [
    { key: 'sauce', title: '탕수육 소스', ask: '탕수육이 나오면?', opts: ['소스를 부어 먹는다', '소스에 찍어 먹는다'],
      feat: 'mouthW', hiOpt: 0,
      hi: ['시원한 입', '입이 시원하니 소스도 풍덩 부어 먹는 상이오.'],
      lo: ['작은 입', '입이 야무지니 소스를 살짝 찍어 먹는 상이오.'] },
    { key: 'clock', title: '하루의 리듬', ask: '하루 중 더 활발한 때는?', opts: ['아침형', '올빼미형'],
      feat: 'tilt', hiOpt: 0,
      hi: ['올라간 눈꼬리', '눈꼬리가 곧게 올라 해와 함께 일어나는 상이오.'],
      lo: ['순한 눈꼬리', '눈꼬리가 순하니 달 아래서 빛나는 상이오.'] },
    { key: 'trip', title: '여행 스타일', ask: '여행을 가면?', opts: ['일정표를 짜서 간다', '발길 닿는 대로 간다'],
      feat: 'browGap', hiOpt: 1,
      hi: ['열린 미간', '미간이 활짝 열렸으니 발길 닿는 대로 가는 상이오.'],
      lo: ['야무진 미간', '미간이 야무지니 일정표부터 짜는 상이오.'] },
    { key: 'chat', title: '메시지 답장', ask: '메시지가 오면?', opts: ['보자마자 바로 답한다', '모아서 한꺼번에 답한다'],
      feat: 'philtrum', hiOpt: 1,
      hi: ['긴 인중', '인중이 길어 느긋하니 모아서 답하는 상이오.'],
      lo: ['짧은 인중', '인중이 짧아 몸이 가벼우니 보자마자 답하는 상이오.'] },
    { key: 'mint', title: '민트초코', ask: '민트초코는?', opts: ['좋아한다', '싫어한다'],
      feat: 'jaw', hiOpt: 1,
      hi: ['단단한 턱', '턱이 단단하니 입맛도 뚝심, 민트초코는 사절하는 상이오.'],
      lo: ['갸름한 턱', '턱이 갸름하니 새 맛에 열린 상, 민트초코를 즐기는 상이오.'] },
  ];

  // 풀이 화면(추리 전)에 보여 주는 칭찬 두 줄. 질문에 쓰이지 않는 비율만 써서 단서가 미리 새지 않게 한다.
  const PRAISE = {
    eyeGap: { hi: ['널찍한 눈 사이', '눈 사이가 널찍하니 마음이 넓고 귀인이 따르는 상이오.'], lo: ['모인 눈매', '눈매가 모였으니 한번 마음먹으면 끝을 보는 상이오.'] },
    mouthUp: { hi: ['올라간 입꼬리', '입꼬리가 올라가 복이 들어오는 입매요. 호감을 주는 상이오.'], lo: ['다문 입매', '입매가 야무져 말 한마디가 곧 믿음이 되는 상이오.'] },
    aspect: { hi: ['둥글고 넓은 얼굴', '얼굴이 둥글고 넓으니 사람이 모이는 인상이오.'], lo: ['길고 단정한 얼굴', '얼굴이 길고 단정하니 생각이 깊고 품위 있는 상이오.'] },
  };
  const PRAISE_KEYS = Object.keys(PRAISE);

  // 한 사람의 얼굴 비율 → 질문별로 관상이 가리키는 쪽(0/1)과 확신(1~3)
  function leans(z) {
    return QUESTIONS.map((q) => {
      const v = z[q.feat] || 0;
      const isHi = v >= 0;
      const opt = isHi ? q.hiOpt : 1 - q.hiOpt;
      const a = Math.abs(v);
      return { opt, conf: a < 0.5 ? 1 : a < 1.2 ? 2 : 3, clue: (isHi ? q.hi : q.lo) };
    });
  }
  function praise(z) {
    const ranked = PRAISE_KEYS.map((k) => ({ k, z: z[k] || 0 })).sort((a, b) => Math.abs(b.z) - Math.abs(a.z)).slice(0, 2);
    return ranked.map((r) => ({ key: r.k, z: r.z, t: PRAISE[r.k][r.z >= 0 ? 'hi' : 'lo'][0], d: PRAISE[r.k][r.z >= 0 ? 'hi' : 'lo'][1] }));
  }

  // 한 판의 결과 → 항목 10개: [질문번호, 사람이 맞힘, 관상이 맞힘, 관상을 따름] (0/1)
  function buildItems(secret, guess, lean) {
    const items = [];
    for (let g = 0; g < 2; g++) {          // g 가 t 의 답을 추리한다 (t = 1 - g)
      const t = 1 - g;
      for (let q = 0; q < QUESTIONS.length; q++) {
        const actual = secret[t][q], pick = guess[g][q], look = lean[t][q].opt;
        items.push([q, pick === actual ? 1 : 0, look === actual ? 1 : 0, pick === look ? 1 : 0]);
      }
    }
    return items;
  }

  const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);

  // rounds: [{ t, rel, mode, items }] → 벽면·결과 화면에 쓰는 통계
  function summarize(rounds) {
    const real = rounds.filter((r) => r.mode !== 'demo');
    const s = { n: real.length, demo: rounds.length - real.length, humanPct: 0, lookPct: 0, followN: 0, followHitPct: 0, defyN: 0, defyHitPct: 0,
      perQ: QUESTIONS.map(() => ({ n: 0, h: 0, l: 0, missPct: 0, lookPct: 0 })), rel: { stranger: { n: 0, h: 0, i: 0, pct: 0 }, friend: { n: 0, h: 0, i: 0, pct: 0 } }, last: null };
    let items = 0, h = 0, l = 0, fh = 0, dh = 0;
    for (const r of real) {
      const rr = s.rel[r.rel] || s.rel.stranger;
      rr.n++;
      for (const [q, hh, lh, fo] of r.items) {
        items++; h += hh; l += lh;
        if (fo) { s.followN++; fh += hh; } else { s.defyN++; dh += hh; }
        const pq = s.perQ[q]; pq.n++; pq.h += hh; pq.l += lh;
        rr.i++; rr.h += hh;
      }
    }
    s.items = items;
    s.humanPct = pct(h, items); s.lookPct = pct(l, items);
    s.followHitPct = pct(fh, s.followN); s.defyHitPct = pct(dh, s.defyN);
    s.perQ.forEach((p) => { p.missPct = p.n ? 100 - pct(p.h, p.n) : 0; p.lookPct = pct(p.l, p.n); });
    for (const k of ['stranger', 'friend']) s.rel[k].pct = pct(s.rel[k].h, s.rel[k].i);
    const last = real[real.length - 1];
    if (last) s.last = { h: last.items.reduce((a, x) => a + x[1], 0), l: last.items.reduce((a, x) => a + x[2], 0), rel: last.rel, t: last.t };
    return s;
  }

  // 서버로 들어온 값 검사 (형식이 맞지 않으면 null)
  function cleanRound(b) {
    if (!b || !Array.isArray(b.items) || b.items.length !== QUESTIONS.length * 2) return null;
    const items = [];
    for (const it of b.items) {
      if (!Array.isArray(it) || it.length !== 4) return null;
      const q = Number(it[0]);
      if (!Number.isInteger(q) || q < 0 || q >= QUESTIONS.length) return null;
      items.push([q, it[1] ? 1 : 0, it[2] ? 1 : 0, it[3] ? 1 : 0]);
    }
    return { rel: b.rel === 'friend' ? 'friend' : 'stranger', mode: b.mode === 'demo' ? 'demo' : 'camera', items };
  }

  const api = { QUESTIONS, PRAISE, leans, praise, buildItems, summarize, cleanRound };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.PsychCore = api;
})(typeof window !== 'undefined' ? window : globalThis);
