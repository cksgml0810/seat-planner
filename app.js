(() => {
  'use strict';

  /* ───────────── 기본 도구 ───────────── */
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const STORE_KEY = 'seat-planner-v1';
  const rand = n => Math.floor(Math.random() * n);
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = rand(i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const esc = s => String(s).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const key = (r, c) => r + '-' + c;
  const parseKey = k => { const [r, c] = k.split('-').map(Number); return { r, c, k }; };

  // group: 1=개별, 2=2인 짝, 3=3인, 0=직접 설정. gaps[i] = i열과 i+1열 사이가 띄워져 있는지
  const gapsFor = (cols, group) =>
    Array.from({ length: Math.max(cols - 1, 0) }, (_, i) => group > 0 ? (i + 1) % group === 0 : true);

  const PRESETS = [
    { label: '5열 7행', sub: '개별 · 35석', cols: 5, rows: 7, group: 1 },
    { label: '6열 5행', sub: '짝 · 30석', cols: 6, rows: 5, group: 2 },
    { label: '6열 5행', sub: '개별 · 30석', cols: 6, rows: 5, group: 1 },
    { label: '6열 6행', sub: '짝 · 36석', cols: 6, rows: 6, group: 2 },
    { label: '8열 4행', sub: '짝 · 32석', cols: 8, rows: 4, group: 2 },
    { label: '6열 5행', sub: '3인 · 30석', cols: 6, rows: 5, group: 3 },
  ];

  const ICON = {
    ban: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="12" cy="12" r="8.5"/><path d="M6 6l12 12"/></svg>',
    lock: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>',
    x: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M7 7l10 10M17 7 7 17"/></svg>',
    join: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12h6m0 0-3-3m3 3-3 3"/><path d="M21 12h-6m0 0 3-3m-3 3 3 3"/></svg>',
    split: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 12H3m0 0 3-3m-3 3 3 3"/><path d="M15 12h6m0 0-3-3m3 3-3 3"/></svg>',
  };

  /* ───────────── 상태 ───────────── */
  const defaults = () => ({
    title: '우리 반 자리 배치',
    students: [],                    // { id, no, name }
    layout: { cols: 6, rows: 5, group: 2, gaps: gapsFor(6, 2), disabled: [] },
    view: 'student', display: 'both', fill: 'front',
    rules: { together: [], apart: [], front: [], frontRows: 2, apartDist: 1, avoidPrev: false },
    assign: {},                      // seatKey -> studentId
    locked: [],                      // seatKey[]
    prevPairs: [],
    unmet: [],
  });

  function hydrate(s) {
    const d = defaults();
    return { ...d, ...s, layout: { ...d.layout, ...(s.layout || {}) }, rules: { ...d.rules, ...(s.rules || {}) } };
  }
  function load() {
    try { const raw = localStorage.getItem(STORE_KEY); if (raw) return hydrate(JSON.parse(raw)); } catch (e) { /* 저장소 사용 불가 */ }
    return defaults();
  }
  function save() { try { localStorage.setItem(STORE_KEY, JSON.stringify(S)); } catch (e) { /* 무시 */ } }

  let S = load();
  let editMode = false, selected = null, animating = false;

  const studentMap = () => new Map(S.students.map(s => [s.id, s]));
  const label = s => s ? (s.name || `${s.no}번`) : '';
  const fullLabel = s => s ? (s.name ? `${s.no} ${s.name}` : `${s.no}번`) : '';
  const mainText = s => S.display === 'no' ? s.no : label(s);

  function normalize() {
    const L = S.layout;
    L.cols = clamp(+L.cols || 1, 1, 14);
    L.rows = clamp(+L.rows || 1, 1, 12);
    if (L.group > 0) L.gaps = gapsFor(L.cols, L.group);
    else {
      const g = (L.gaps || []).slice(0, L.cols - 1);
      while (g.length < L.cols - 1) g.push(true);
      L.gaps = g;
    }
    L.disabled = [...new Set(L.disabled)].filter(k => { const p = parseKey(k); return p.r < L.rows && p.c < L.cols; });
    const off = new Set(L.disabled), ids = new Set(S.students.map(s => s.id)), seen = new Set();
    for (const k of Object.keys(S.assign)) {
      const p = parseKey(k), id = S.assign[k];
      if (p.r >= L.rows || p.c >= L.cols || off.has(k) || !ids.has(id) || seen.has(id)) delete S.assign[k];
      else seen.add(id);
    }
    S.locked = [...new Set(S.locked)].filter(k => S.assign[k]);
    const R = S.rules;
    R.together = R.together.filter(p => p.every(i => ids.has(i)));
    R.apart = R.apart.filter(p => p.every(i => ids.has(i)));
    R.front = R.front.filter(i => ids.has(i));
    S.prevPairs = S.prevPairs.filter(p => p.every(i => ids.has(i)));
    S.unmet = (S.unmet || []).filter(u => u.slice(1).every(i => ids.has(i)));
  }

  /* ───────────── 좌석 기하 / 배치 알고리즘 ───────────── */
  function activeSeats() {
    const off = new Set(S.layout.disabled), out = [];
    for (let r = 0; r < S.layout.rows; r++)
      for (let c = 0; c < S.layout.cols; c++) {
        const k = key(r, c);
        if (!off.has(k)) out.push({ r, c, k });
      }
    return out;
  }

  function geometry() {
    const gaps = S.layout.gaps;
    const tight = gaps.some(g => !g); // 붙어 있는 책상이 하나라도 있으면 '짝'은 붙은 책상끼리만
    const seats = activeSeats();
    const rowsUsed = [...new Set(seats.map(s => s.r))].sort((a, b) => a - b);
    const rank = new Map(rowsUsed.map((r, i) => [r, i])); // 교탁 기준 몇 번째 줄인지 (빈 줄 제외)
    const partner = (a, b) => a.r === b.r && Math.abs(a.c - b.c) === 1 && (!tight || !gaps[Math.min(a.c, b.c)]);
    return { seats, rank, partner };
  }

  function evaluate(pos, G) {
    const R = S.rules; let cost = 0; const unmet = [];
    for (const [a, b] of R.together) {
      const A = pos.get(a), B = pos.get(b);
      if (A && B && !G.partner(A, B)) { cost += 100; unmet.push(['together', a, b]); }
    }
    for (const [a, b] of R.apart) {
      const A = pos.get(a), B = pos.get(b);
      if (A && B && Math.max(Math.abs(A.r - B.r), Math.abs(A.c - B.c)) <= R.apartDist) { cost += 100; unmet.push(['apart', a, b]); }
    }
    for (const a of R.front) {
      const A = pos.get(a);
      if (A && G.rank.get(A.r) >= R.frontRows) { cost += 100; unmet.push(['front', a]); }
    }
    if (R.avoidPrev) for (const [a, b] of S.prevPairs) {
      const A = pos.get(a), B = pos.get(b);
      if (A && B && G.partner(A, B)) cost += 1;
    }
    return { cost, unmet };
  }

  function solve() {
    const G = geometry();
    const lockedKeys = S.locked.filter(k => S.assign[k]);
    const lockedSet = new Set(lockedKeys);
    const lockedIds = new Set(lockedKeys.map(k => S.assign[k]));
    const pool = S.students.map(s => s.id).filter(id => !lockedIds.has(id));
    const free = G.seats.filter(s => !lockedSet.has(s.k));
    if (pool.length > free.length) return { error: `좌석이 ${pool.length - free.length}석 부족해요. 교실 형태를 조정해 주세요.` };

    // 사용할 좌석 고르기
    let used;
    if (S.fill === 'front') {
      used = [];
      const byRow = new Map();
      free.forEach(s => { if (!byRow.has(s.r)) byRow.set(s.r, []); byRow.get(s.r).push(s); });
      for (const r of [...byRow.keys()].sort((a, b) => a - b)) {
        const need = pool.length - used.length;
        if (need <= 0) break;
        const list = byRow.get(r);
        used.push(...(list.length <= need ? list : shuffle(list.slice()).slice(0, need)));
      }
    } else used = shuffle(free.slice()).slice(0, pool.length);

    const n = pool.length;
    const pos = new Map();
    lockedKeys.forEach(k => pos.set(S.assign[k], parseKey(k)));
    const R = S.rules;
    const focusAll = new Set([...R.together.flat(), ...R.apart.flat(), ...R.front, ...(R.avoidPrev ? S.prevPairs.flat() : [])]);
    const focus = pool.filter(id => focusAll.has(id));

    let best = null, bestCost = Infinity;
    for (let restart = 0; restart < 15 && bestCost > 0; restart++) {
      const arr = shuffle(pool.slice());
      const idx = new Map();
      arr.forEach((id, i) => { pos.set(id, used[i]); idx.set(id, i); });
      let cost = evaluate(pos, G).cost, T = 3;
      if (cost < bestCost) { bestCost = cost; best = arr.slice(); }
      const swap = (i, j) => {
        [arr[i], arr[j]] = [arr[j], arr[i]];
        pos.set(arr[i], used[i]); pos.set(arr[j], used[j]);
        idx.set(arr[i], i); idx.set(arr[j], j);
      };
      for (let it = 0; it < 5000 && cost > 0 && n > 1; it++) {
        const i = focus.length && Math.random() < 0.7 ? idx.get(focus[rand(focus.length)]) : rand(n);
        const j = rand(n);
        if (i === j) continue;
        swap(i, j);
        const nc = evaluate(pos, G).cost;
        if (nc <= cost || Math.random() < Math.exp((cost - nc) / T)) {
          cost = nc;
          if (cost < bestCost) { bestCost = cost; best = arr.slice(); }
        } else swap(i, j);
        T = Math.max(0.05, T * 0.998);
      }
    }

    const assign = {};
    lockedKeys.forEach(k => { assign[k] = S.assign[k]; });
    best.forEach((id, i) => { assign[used[i].k] = id; });
    const fpos = new Map(Object.entries(assign).map(([k, id]) => [id, parseKey(k)]));
    return { assign, unmet: evaluate(fpos, G).unmet };
  }

  function currentPairs() {
    const G = geometry(), out = [];
    const entries = Object.entries(S.assign).map(([k, id]) => [parseKey(k), id]);
    for (let i = 0; i < entries.length; i++)
      for (let j = i + 1; j < entries.length; j++)
        if (G.partner(entries[i][0], entries[j][0])) out.push([entries[i][1], entries[j][1]]);
    return out;
  }

  /* ───────────── 렌더링 ───────────── */
  const room = $('#room'), stage = $('#stage'), tray = $('#tray');

  function render() {
    normalize();
    renderSide();
    renderRoom();
    renderSecret();
    save();
  }

  function setOn(container, attr, value) {
    $$(`[data-${attr}]`, container).forEach(b => b.classList.toggle('on', b.dataset[attr] === String(value)));
  }

  function renderSide() {
    const L = S.layout;
    $('#colsVal').textContent = L.cols;
    $('#rowsVal').textContent = L.rows;
    setOn($('#groupSeg'), 'group', L.group);
    setOn($('#viewSeg'), 'view', S.view);
    setOn($('#dispSeg'), 'disp', S.display);
    setOn($('#fillSeg'), 'fill', S.fill);
    $$('.preset').forEach((b, i) => {
      const p = PRESETS[i];
      b.classList.toggle('on', p.cols === L.cols && p.rows === L.rows && p.group === L.group && !L.disabled.length);
    });

    $('#stuCount').textContent = S.students.length ? `${S.students.length}명` : '';
    const list = $('#stuList');
    list.innerHTML = S.students.length ? `
      <div class="head"><span>명단</span><button class="link" id="stuClear">명단 지우기</button></div>
      <div class="chips">${S.students.map(s => `<span class="chip"><em>${esc(s.no)}</em>${esc(s.name || '')}<button data-del="${esc(s.id)}" title="삭제">×</button></span>`).join('')}</div>` : '';

    const seats = activeSeats().length, n = S.students.length;
    const placed = Object.keys(S.assign).length;
    let stats = `좌석 ${seats}석 · 학생 ${n}명`;
    if (n > seats) stats += ` · <b style="color:var(--danger)">${n - seats}석 부족</b>`;
    else if (n) stats += ` · 빈자리 ${seats - n}석`;
    if (placed && placed < n) stats += ` · 미배치 ${n - placed}명`;
    $('#stats').innerHTML = stats;

    const t = $('#title');
    if (document.activeElement !== t) t.textContent = S.title;
    $('#editBtn').classList.toggle('on', editMode);
    $('#editBar').hidden = !editMode;
    $('#dot').classList.toggle('warn', S.unmet.length > 0);
  }

  function renderRoom() {
    const L = S.layout, teacher = S.view === 'teacher';
    const rows = [...Array(L.rows).keys()], cols = [...Array(L.cols).keys()];
    if (teacher) { rows.reverse(); cols.reverse(); }
    const off = new Set(L.disabled), lock = new Set(S.locked), M = studentMap();
    const gapCls = (a, b) => L.gaps[Math.min(a, b)] ? 'sp wide' : 'sp';

    const seatHTML = (r, c) => {
      const k = key(r, c);
      if (off.has(k)) return `<div class="seat off" data-k="${k}" title="클릭하면 다시 사용하는 자리로 돌아와요">${ICON.x}<span class="offlbl">빈자리</span></div>`;
      const s = M.get(S.assign[k]);
      const sel = selected && selected.type === 'seat' && selected.k === k ? ' sel' : '';
      if (!s) return `<div class="seat empty${sel}" data-k="${k}" title="클릭하면 빈자리로 지정돼요"></div>`;
      return `<div class="seat filled${lock.has(k) ? ' locked' : ''}${sel}" data-k="${k}" draggable="${!editMode}">`
        + (s.name ? `<span class="no">${esc(s.no)}</span>` : '')
        + `<span class="nm">${esc(mainText(s))}</span>`
        + `<button class="ban" data-ban="${k}" title="빈자리로 지정 (학생은 미배치 목록으로)">${ICON.ban}</button>`
        + `<button class="lock" data-lock="${k}" title="${lock.has(k) ? '고정 해제' : '이 자리 고정 (섞어도 그대로)'}">${ICON.lock}</button></div>`;
    };

    let h = '';
    if (editMode) {
      h += '<div class="srow gaprow">';
      cols.forEach((c, i) => {
        if (i) {
          const g = Math.min(cols[i - 1], c);
          h += `<div class="${gapCls(cols[i - 1], c)}"><button class="gapbtn" data-gap="${g}" title="${L.gaps[g] ? '책상 붙이기' : '책상 띄우기'}">${L.gaps[g] ? ICON.join : ICON.split}</button></div>`;
        }
        h += '<div class="ghost"></div>';
      });
      h += '</div>';
    }
    for (const r of rows) {
      h += '<div class="srow">';
      cols.forEach((c, i) => { if (i) h += `<div class="${gapCls(cols[i - 1], c)}"></div>`; h += seatHTML(r, c); });
      h += '</div>';
    }
    const desk = '<div class="front"><div class="desk">교탁</div></div>';
    room.className = `room disp-${S.display}${teacher ? ' teacher' : ''}${editMode ? ' edit' : ''}`;
    room.innerHTML = teacher ? `<div class="grid">${h}</div>${desk}` : `${desk}<div class="grid">${h}</div>`;

    // 미배치 학생 / 안내
    const placedIds = new Set(Object.values(S.assign));
    const unplaced = S.students.filter(s => !placedIds.has(s.id));
    if (!S.students.length) {
      tray.innerHTML = '<div class="empty-hint">왼쪽에서 <b>학생 명단</b>을 입력한 뒤 <b>자리 섞기</b>를 눌러 주세요.<br>엑셀 파일이 없다면 <b>번호로 만들기</b>를 이용하세요.</div>';
    } else if (unplaced.length && !animating) {
      tray.innerHTML = `<div class="tray-title">배치되지 않은 학생 ${unplaced.length}명 · 끌어서 자리에 놓거나, 클릭 후 자리를 클릭하세요</div>
        <div class="chips">${unplaced.map(s => `<span class="chip${selected && selected.type === 'stu' && selected.id === s.id ? ' sel' : ''}" draggable="true" data-stu="${esc(s.id)}">${esc(fullLabel(s))}</span>`).join('')}</div>`;
    } else tray.innerHTML = '';

    sizeRoom();
  }

  function sizeRoom(availW, availH) {
    const L = S.layout;
    const W = availW || stage.clientWidth - 48;
    const H = availH || stage.clientHeight - 56;
    const tight = 6, wide = clamp(Math.round(W / L.cols * 0.18), 14, 34);
    const gapSum = L.gaps.reduce((a, g) => a + (g ? wide : tight), 0);
    let sw = clamp((W - gapSum) / L.cols, 56, 150);
    const reserved = 100 + (editMode ? 30 : 0) + (tray.innerHTML ? 70 : 0);
    let sh = clamp(Math.min(sw * 0.58, (H - reserved - (L.rows - 1) * 12) / L.rows), 40, 90);
    const fs = clamp(Math.min(sw / 6.2, sh / 3.1), 11, 22);
    room.style.setProperty('--sw', sw + 'px');
    room.style.setProperty('--sh', sh + 'px');
    room.style.setProperty('--fs', fs + 'px');
    room.style.setProperty('--gap-wide', wide + 'px');
  }

  /* ───────────── 자리 섞기 ───────────── */
  function doShuffle() {
    if (animating) return;
    if (!S.students.length) return toast('먼저 학생 명단을 입력해 주세요.');
    const res = solve();
    if (res.error) return toast(res.error);
    if (Object.keys(S.assign).length) S.prevPairs = currentPairs();
    S.assign = res.assign;
    S.unmet = res.unmet;
    selected = null; editMode = false;
    animating = true;
    render();
    reveal();
  }

  function reveal() {
    const btn = $('#shuffleBtn');
    btn.disabled = true;
    const pool = S.students;
    const lockedSet = new Set(S.locked);
    const els = $$('.seat.filled', room).filter(el => !lockedSet.has(el.dataset.k));
    const order = shuffle(els.map((_, i) => i));
    let remaining = els.length;
    const finish = () => { animating = false; btn.disabled = false; render(); toast('자리 배치 완료!'); };
    if (!remaining) return finish();
    els.forEach((el, i) => {
      const nm = $('.nm', el), fin = nm.textContent;
      const stopAt = performance.now() + 650 + order[i] * Math.min(28, 900 / els.length);
      el.classList.add('rolling');
      const tick = () => {
        if (performance.now() >= stopAt) {
          nm.textContent = fin;
          el.classList.remove('rolling');
          el.classList.add('pop');
          if (--remaining === 0) setTimeout(finish, 380);
          return;
        }
        nm.textContent = mainText(pool[rand(pool.length)]);
        setTimeout(tick, 55);
      };
      tick();
    });
  }

  /* ───────────── 수동 이동 ───────────── */
  function place(src, k) {
    if (S.layout.disabled.includes(k)) return;
    if (src.type === 'seat') {
      if (src.k === k) return;
      const a = S.assign[src.k], b = S.assign[k];
      if (b) S.assign[src.k] = b; else delete S.assign[src.k];
      if (a) S.assign[k] = a; else delete S.assign[k];
    } else if (src.type === 'stu') {
      for (const kk of Object.keys(S.assign)) if (S.assign[kk] === src.id) delete S.assign[kk];
      S.assign[k] = src.id;
    }
  }

  room.addEventListener('click', e => {
    if (animating) return;
    const gb = e.target.closest('.gapbtn');
    if (gb) {
      const g = +gb.dataset.gap;
      S.layout.gaps[g] = !S.layout.gaps[g];
      S.layout.group = 0;
      return render();
    }
    const lb = e.target.closest('.lock');
    if (lb) {
      const k = lb.dataset.lock;
      S.locked = S.locked.includes(k) ? S.locked.filter(x => x !== k) : [...S.locked, k];
      return render();
    }
    const bb = e.target.closest('.ban');
    if (bb) {
      const k = bb.dataset.ban, s = studentMap().get(S.assign[k]);
      S.layout.disabled.push(k);
      delete S.assign[k];
      selected = null;
      render();
      if (s) toast(`${fullLabel(s)} 학생은 아래 미배치 목록으로 이동했어요.`);
      return;
    }
    const seat = e.target.closest('.seat[data-k]');
    if (!seat) return;
    const k = seat.dataset.k;
    if (editMode || seat.classList.contains('off') || (!selected && !S.assign[k])) {
      const d = S.layout.disabled;
      if (d.includes(k)) S.layout.disabled = d.filter(x => x !== k);
      else { d.push(k); delete S.assign[k]; }
      return render();
    }
    if (!selected) selected = { type: 'seat', k };
    else if (selected.type === 'seat' && selected.k === k) selected = null;
    else { place(selected, k); selected = null; }
    render();
  });

  tray.addEventListener('click', e => {
    const chip = e.target.closest('[data-stu]');
    if (!chip || animating) return;
    const id = chip.dataset.stu;
    selected = selected && selected.type === 'stu' && selected.id === id ? null : { type: 'stu', id };
    render();
  });

  // 드래그 앤 드롭
  document.addEventListener('dragstart', e => {
    if (animating || editMode) return e.preventDefault();
    const seat = e.target.closest && e.target.closest('.seat.filled');
    const chip = e.target.closest && e.target.closest('[data-stu]');
    if (seat) { e.dataTransfer.setData('text/plain', 'seat:' + seat.dataset.k); seat.classList.add('dragging'); }
    else if (chip) e.dataTransfer.setData('text/plain', 'stu:' + chip.dataset.stu);
    e.dataTransfer.effectAllowed = 'move';
  });
  document.addEventListener('dragend', () => $$('.dragging, .over').forEach(el => el.classList.remove('dragging', 'over')));
  room.addEventListener('dragover', e => {
    const seat = e.target.closest('.seat:not(.off)');
    if (!seat) return;
    e.preventDefault();
    $$('.seat.over', room).forEach(el => el !== seat && el.classList.remove('over'));
    seat.classList.add('over');
  });
  room.addEventListener('dragleave', e => { const s = e.target.closest('.seat'); if (s && !s.contains(e.relatedTarget)) s.classList.remove('over'); });
  room.addEventListener('drop', e => {
    const seat = e.target.closest('.seat:not(.off)');
    if (!seat) return;
    e.preventDefault();
    const data = e.dataTransfer.getData('text/plain');
    if (data.startsWith('seat:')) place({ type: 'seat', k: data.slice(5) }, seat.dataset.k);
    else if (data.startsWith('stu:')) place({ type: 'stu', id: data.slice(4) }, seat.dataset.k);
    selected = null;
    render();
  });
  stage.addEventListener('dragover', e => {
    if (e.target.closest('.seat')) return;
    e.preventDefault();
    tray.classList.toggle('over', !!S.students.length);
  });
  stage.addEventListener('dragleave', e => { if (!stage.contains(e.relatedTarget)) tray.classList.remove('over'); });
  stage.addEventListener('drop', e => {
    tray.classList.remove('over');
    if (e.target.closest('.seat')) return;
    e.preventDefault();
    const data = e.dataTransfer.getData('text/plain');
    if (data.startsWith('seat:')) { const k = data.slice(5); delete S.assign[k]; render(); }
  });

  /* ───────────── 학생 명단 입력 ───────────── */
  function numericSort(a, b) {
    const x = parseFloat(a.no), y = parseFloat(b.no);
    if (!isNaN(x) && !isNaN(y) && x !== y) return x - y;
    return String(a.no).localeCompare(String(b.no), 'ko', { numeric: true });
  }

  function setStudents(list) {
    list = list.map(x => ({ no: String(x.no ?? '').trim(), name: String(x.name ?? '').trim() })).filter(x => x.no || x.name);
    list.forEach((x, i) => { if (!x.no) x.no = String(i + 1); });
    const counts = {};
    list.forEach(x => { counts[x.no] = (counts[x.no] || 0) + 1; });
    S.students = list.map((x, i) => ({ id: counts[x.no] === 1 ? 'n:' + x.no : `x:${i}:${x.name}`, no: x.no, name: x.name })).sort(numericSort);
    selected = null;
    render();
    toast(`학생 ${S.students.length}명을 불러왔어요.`);
  }

  function rowsToStudents(aoa) {
    const rows = aoa.map(r => (r || []).map(v => String(v ?? '').trim())).filter(r => r.some(v => v));
    if (!rows.length) return [];
    let hi = -1, nameI = -1, noI = -1;
    for (let i = 0; i < Math.min(rows.length, 10); i++) {
      const r = rows[i];
      const n = r.findIndex(v => /^(이름|성명|학생명|name)$/i.test(v.replace(/\s/g, '')));
      if (n >= 0) {
        hi = i; nameI = n;
        noI = r.findIndex(v => /학번/.test(v));
        if (noI < 0) noI = r.findIndex(v => /^(번호|출석번호|no\.?|number|id)$/i.test(v.replace(/\s/g, '')));
        break;
      }
    }
    const data = rows.slice(hi + 1);
    if (hi < 0) {
      const width = Math.max(...data.map(r => r.length));
      let bestNum = -1, bestNumScore = 0, bestTxt = -1, bestTxtScore = 0;
      for (let c = 0; c < width; c++) {
        const vals = data.map(r => r[c] || '').filter(Boolean);
        if (!vals.length) continue;
        const num = vals.filter(v => /^\d+$/.test(v)).length / data.length;
        const txt = vals.filter(v => !/^\d+$/.test(v)).length / data.length;
        if (num > bestNumScore) { bestNumScore = num; bestNum = c; }
        if (txt > bestTxtScore) { bestTxtScore = txt; bestTxt = c; }
      }
      noI = bestNumScore > 0.5 ? bestNum : -1;
      nameI = bestTxtScore > 0.5 ? bestTxt : -1;
    }
    return data.map(r => ({ no: noI >= 0 ? r[noI] : '', name: nameI >= 0 ? r[nameI] : '' }));
  }

  async function readFile(file) {
    try {
      const buf = await file.arrayBuffer();
      if (typeof XLSX === 'undefined') throw new Error('no xlsx');
      const wb = XLSX.read(buf, { type: 'array' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '' });
      const list = rowsToStudents(aoa);
      if (!list.length) return toast('파일에서 학생을 찾지 못했어요. 학번/이름 열을 확인해 주세요.');
      setStudents(list);
    } catch (err) {
      console.error(err);
      toast('파일을 읽을 수 없어요. 엑셀(.xlsx) 또는 CSV 파일인지 확인해 주세요.');
    }
  }

  function parseNums(str) {
    const set = new Set();
    String(str).split(/[,\s/·]+/).forEach(t => {
      t = t.replace(/번/g, '');
      const m = t.match(/^(\d+)[-~](\d+)$/);
      if (m) { for (let i = +m[1]; i <= +m[2]; i++) set.add(i); }
      else if (/^\d+$/.test(t)) set.add(+t);
    });
    return set;
  }

  /* ───────────── 내보내기 ───────────── */
  function exportXlsx() {
    if (typeof XLSX === 'undefined') return toast('엑셀 라이브러리를 불러오지 못했어요.');
    const L = S.layout, teacher = S.view === 'teacher', M = studentMap(), off = new Set(L.disabled);
    const rows = [...Array(L.rows).keys()], cols = [...Array(L.cols).keys()];
    if (teacher) { rows.reverse(); cols.reverse(); }
    const grid = rows.map(r => {
      const line = [];
      cols.forEach((c, i) => {
        if (i && L.gaps[Math.min(cols[i - 1], c)]) line.push('');
        const k = key(r, c);
        line.push(off.has(k) ? '' : (fullLabel(M.get(S.assign[k])) || '(빈자리)'));
      });
      return line;
    });
    const width = grid[0] ? grid[0].length : 1;
    const deskRow = Array(width).fill('');
    deskRow[Math.floor((width - 1) / 2)] = '[ 교탁 ]';
    const aoa = [[S.title], [new Date().toLocaleDateString('ko-KR')], []];
    if (teacher) aoa.push(...grid, [], deskRow); else aoa.push(deskRow, [], ...grid);
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws['!cols'] = grid[0].map(v => ({ wch: v ? 14 : 3 }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '자리배치');
    XLSX.writeFile(wb, `${S.title.replace(/[\\/:*?"<>|]/g, '') || '자리배치'}.xlsx`);
  }

  function downloadTemplate() {
    if (typeof XLSX === 'undefined') return toast('엑셀 라이브러리를 불러오지 못했어요.');
    const aoa = [['학번', '이름'], ['10101', '홍길동'], ['10102', '김철수'], ['10103', '이영희']];
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws['!cols'] = [{ wch: 10 }, { wch: 12 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '명단');
    XLSX.writeFile(wb, '학생명단_양식.xlsx');
  }

  function exportJson() {
    const blob = new Blob([JSON.stringify(S, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `seat-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  /* ───────────── 세부 설정 (숨김) ───────────── */
  const secret = $('#secret');
  const openSecret = () => { secret.hidden = false; renderSecret(); };
  const closeSecret = () => { secret.hidden = true; };

  function renderSecret() {
    if (secret.hidden) return;
    const M = studentMap();
    const opts = '<option value="">학생 선택</option>' + S.students.map(s => `<option value="${esc(s.id)}">${esc(fullLabel(s))}</option>`).join('');
    ['togA', 'togB', 'apA', 'frA'].forEach(id => {
      const el = $('#' + id), v = el.value;
      el.innerHTML = opts;
      if (M.has(v)) el.value = v;
    });
    const R = S.rules;
    const pairChips = (arr, kind, sym) => arr.map((p, i) =>
      `<span class="chip">${esc(fullLabel(M.get(p[0])))} <i>${sym}</i> ${esc(fullLabel(M.get(p[1])))}<button data-rm="${kind}:${i}">×</button></span>`).join('');
    $('#togList').innerHTML = pairChips(R.together, 'together', '＋');
    // 떨어뜨리기: 기준 학생별로 묶어서 표시
    const groups = new Map();
    R.apart.forEach((p, i) => { if (!groups.has(p[0])) groups.set(p[0], []); groups.get(p[0]).push([p[1], i]); });
    $('#apList').innerHTML = [...groups].map(([a, list]) =>
      `<div class="grp"><b>${esc(fullLabel(M.get(a)))}</b><i>↔</i>${list.map(([b, i]) =>
        `<span class="chip">${esc(fullLabel(M.get(b)))}<button data-rm="apart:${i}" title="이 학생만 삭제">×</button></span>`).join('')}`
      + `<button class="link danger" data-rmgrp="${esc(a)}">전체 삭제</button></div>`).join('');
    renderApMulti();
    $('#frList').innerHTML = R.front.map((id, i) => `<span class="chip">${esc(fullLabel(M.get(id)))}<button data-rm="front:${i}">×</button></span>`).join('');
    $('#apDist').value = String(R.apartDist);
    $('#frRows').value = String(R.frontRows);
    $('#avoidPrev').checked = !!R.avoidPrev;

    const un = $('#unmet');
    if (S.unmet.length) {
      const txt = S.unmet.map(u => u[0] === 'front'
        ? `앞자리: ${esc(fullLabel(M.get(u[1])))}`
        : `${u[0] === 'together' ? '같이 앉기' : '떨어뜨리기'}: ${esc(fullLabel(M.get(u[1])))}, ${esc(fullLabel(M.get(u[2])))}`);
      un.innerHTML = `<b>최근 배치에서 지키지 못한 조건</b><br>${txt.join('<br>')}<br><small>좌석 형태나 조건이 서로 충돌하는지 확인해 주세요.</small>`;
      un.hidden = false;
    } else un.hidden = true;
  }

  function addPair(kind, a, b) {
    const A = $(a).value, B = $(b).value;
    if (!A || !B) return toast('학생 두 명을 선택해 주세요.');
    if (A === B) return toast('서로 다른 학생을 선택해 주세요.');
    const list = S.rules[kind];
    if (list.some(p => (p[0] === A && p[1] === B) || (p[0] === B && p[1] === A))) return toast('이미 추가된 조합이에요.');
    if (kind === 'together' && list.some(p => p.includes(A) || p.includes(B)))
      toast('한 학생에게 짝을 여러 명 지정하면 모두 만족하기 어려울 수 있어요.');
    list.push([A, B]);
    $(a).value = ''; $(b).value = '';
    render();
  }

  $('#togAdd').onclick = () => addPair('together', '#togA', '#togB');
  // 떨어뜨리기: 한 명 ↔ 여러 명
  const apPick = new Set();
  const apLinked = a => new Set(S.rules.apart.filter(p => p.includes(a)).map(p => p[0] === a ? p[1] : p[0]));
  function renderApMulti() {
    const a = $('#apA').value, box = $('#apMulti');
    if (!a) { box.innerHTML = ''; $('#apSel').textContent = '기준 학생을 먼저 선택하세요'; return; }
    const had = apLinked(a);
    box.innerHTML = S.students.filter(s => s.id !== a).map(s => {
      const cls = had.has(s.id) ? ' had' : apPick.has(s.id) ? ' on' : '';
      return `<button class="mchip${cls}" data-pick="${esc(s.id)}" title="${had.has(s.id) ? '이미 추가됨' : ''}">${esc(fullLabel(s))}</button>`;
    }).join('');
    $('#apSel').textContent = apPick.size ? `${apPick.size}명 선택됨` : '떨어뜨릴 학생을 클릭해 선택하세요';
  }
  $('#apA').addEventListener('change', () => { apPick.clear(); renderApMulti(); });
  $('#apMulti').addEventListener('click', e => {
    const b = e.target.closest('[data-pick]');
    if (!b || b.classList.contains('had')) return;
    const id = b.dataset.pick;
    apPick.has(id) ? apPick.delete(id) : apPick.add(id);
    renderApMulti();
  });
  $('#apNums').addEventListener('keydown', e => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const a = $('#apA').value;
    if (!a) return toast('기준 학생을 먼저 선택해 주세요.');
    const had = apLinked(a), miss = [];
    e.target.value.split(/[,\s/·]+/).map(t => t.replace(/번/g, '')).filter(Boolean).forEach(t => {
      const s = S.students.find(x => x.no === t) || S.students.find(x => /^\d+$/.test(t) && parseFloat(x.no) === +t);
      if (!s) miss.push(t); else if (s.id !== a && !had.has(s.id)) apPick.add(s.id);
    });
    e.target.value = '';
    renderApMulti();
    if (miss.length) toast(`찾을 수 없는 번호: ${miss.join(', ')}`);
  });
  $('#apAdd').onclick = () => {
    const a = $('#apA').value;
    if (!a) return toast('기준 학생을 선택해 주세요.');
    if (!apPick.size) return toast('떨어뜨릴 학생을 한 명 이상 선택해 주세요.');
    apPick.forEach(b => S.rules.apart.push([a, b]));
    apPick.clear();
    render();
  };
  $('#frAdd').onclick = () => {
    const id = $('#frA').value;
    if (!id) return toast('학생을 선택해 주세요.');
    if (!S.rules.front.includes(id)) S.rules.front.push(id);
    $('#frA').value = '';
    render();
  };
  secret.addEventListener('click', e => {
    if (e.target === secret || e.target.closest('[data-close]')) return closeSecret();
    const rm = e.target.closest('[data-rm]');
    if (rm) { const [kind, i] = rm.dataset.rm.split(':'); S.rules[kind].splice(+i, 1); return render(); }
    const rg = e.target.closest('[data-rmgrp]');
    if (rg) { S.rules.apart = S.rules.apart.filter(p => p[0] !== rg.dataset.rmgrp); render(); }
  });
  $('#apDist').onchange = e => { S.rules.apartDist = +e.target.value; render(); };
  $('#frRows').onchange = e => { S.rules.frontRows = +e.target.value; render(); };
  $('#avoidPrev').onchange = e => { S.rules.avoidPrev = e.target.checked; render(); };
  $('#rulesClear').onclick = () => {
    if (!confirm('세부 설정을 모두 지울까요?')) return;
    S.rules = { ...defaults().rules };
    S.unmet = [];
    render();
  };

  $('#dot').addEventListener('click', openSecret);
  document.addEventListener('keydown', e => {
    // Alt(Option) + Shift + S : 세부 설정 열기
    if (e.altKey && e.shiftKey && e.code === 'KeyS') { e.preventDefault(); secret.hidden ? openSecret() : closeSecret(); return; }
    if (e.key === 'Escape') {
      if (!secret.hidden) return closeSecret();
      if (selected) { selected = null; render(); }
      else if (editMode) { editMode = false; render(); }
    }
  });

  /* ───────────── 컨트롤 연결 ───────────── */
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => t.classList.remove('show'), 2400);
  }

  $('#presets').innerHTML = PRESETS.map((p, i) => `<button class="preset" data-preset="${i}"><b>${p.label}</b><span>${p.sub}</span></button>`).join('');
  $('#presets').addEventListener('click', e => {
    const b = e.target.closest('[data-preset]');
    if (!b) return;
    const p = PRESETS[+b.dataset.preset];
    Object.assign(S.layout, { cols: p.cols, rows: p.rows, group: p.group, disabled: [] });
    render();
  });

  $$('[data-step]').forEach(b => b.addEventListener('click', () => {
    const L = S.layout, f = b.dataset.step, d = +b.dataset.d;
    const before = L.cols;
    L[f] = clamp(L[f] + d, 1, f === 'cols' ? 14 : 12);
    if (f === 'cols' && L.group === 0 && L.cols > before) L.gaps.push(true);
    render();
  }));

  $('#groupSeg').addEventListener('click', e => { const b = e.target.closest('[data-group]'); if (b && b.dataset.group !== '0') { S.layout.group = +b.dataset.group; render(); } });
  $('#viewSeg').addEventListener('click', e => { const b = e.target.closest('[data-view]'); if (b) { S.view = b.dataset.view; render(); } });
  $('#dispSeg').addEventListener('click', e => { const b = e.target.closest('[data-disp]'); if (b) { S.display = b.dataset.disp; render(); } });
  $('#fillSeg').addEventListener('click', e => { const b = e.target.closest('[data-fill]'); if (b) { S.fill = b.dataset.fill; render(); } });

  $('#srcTabs').addEventListener('click', e => {
    const b = e.target.closest('[data-tab]');
    if (!b) return;
    setOn($('#srcTabs'), 'tab', b.dataset.tab);
    $$('[data-pane]').forEach(p => { p.hidden = p.dataset.pane !== b.dataset.tab; });
  });

  const drop = $('#drop');
  $('#fileInput').addEventListener('change', e => { if (e.target.files[0]) readFile(e.target.files[0]); e.target.value = ''; });
  drop.addEventListener('dragover', e => { e.preventDefault(); e.stopPropagation(); drop.classList.add('over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', e => { e.preventDefault(); e.stopPropagation(); drop.classList.remove('over'); if (e.dataTransfer.files[0]) readFile(e.dataTransfer.files[0]); });
  $('#tplBtn').onclick = downloadTemplate;

  $('#numBtn').onclick = () => {
    const a = parseInt($('#numStart').value, 10), b = parseInt($('#numEnd').value, 10);
    if (isNaN(a) || isNaN(b) || b < a) return toast('시작 번호와 끝 번호를 확인해 주세요.');
    if (b - a > 200) return toast('한 번에 200명까지 만들 수 있어요.');
    const skip = parseNums($('#numSkip').value);
    const list = [];
    for (let i = a; i <= b; i++) if (!skip.has(i)) list.push({ no: String(i), name: '' });
    setStudents(list);
  };

  $('#pasteBtn').onclick = () => {
    const lines = $('#pasteBox').value.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    const list = lines.map(l => {
      const parts = l.split(/\t|,|\s+/).map(x => x.trim()).filter(Boolean);
      if (parts.length > 1 && /^\d+$/.test(parts[0])) return { no: parts[0], name: parts.slice(1).join(' ') };
      if (parts.length === 1 && /^\d+$/.test(parts[0])) return { no: parts[0], name: '' };
      return { no: '', name: l };
    });
    if (!list.length) return toast('명단을 입력해 주세요.');
    setStudents(list);
  };

  $('#stuList').addEventListener('click', e => {
    const del = e.target.closest('[data-del]');
    if (del) { S.students = S.students.filter(s => s.id !== del.dataset.del); return render(); }
    if (e.target.id === 'stuClear' && confirm('학생 명단과 현재 배치를 지울까요?')) {
      S.students = []; S.assign = {}; S.locked = []; render();
    }
  });

  const title = $('#title');
  title.addEventListener('input', () => { S.title = title.textContent.trim() || '자리 배치'; save(); });
  title.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); title.blur(); } });
  title.addEventListener('blur', () => { title.textContent = S.title; });

  $('#editBtn').onclick = () => { editMode = !editMode; selected = null; render(); };
  $('#editDone').onclick = () => { editMode = false; render(); };
  $('#clearBtn').onclick = () => {
    if (!Object.keys(S.assign).length) return;
    if (!confirm('현재 배치를 모두 비울까요? (고정한 자리도 해제됩니다)')) return;
    S.assign = {}; S.locked = []; S.unmet = []; selected = null; render();
  };
  $('#shuffleBtn').onclick = doShuffle;
  $('#xlsxBtn').onclick = exportXlsx;
  $('#printBtn').onclick = () => window.print();
  window.addEventListener('beforeprint', () => sizeRoom(1000, 620));
  window.addEventListener('afterprint', () => sizeRoom());

  $('#exportJson').onclick = exportJson;
  $('#importJson').onclick = () => $('#jsonInput').click();
  $('#jsonInput').addEventListener('change', async e => {
    const f = e.target.files[0];
    e.target.value = '';
    if (!f) return;
    try { S = hydrate(JSON.parse(await f.text())); selected = null; render(); toast('설정을 불러왔어요.'); }
    catch (err) { toast('설정 파일을 읽을 수 없어요.'); }
  });
  $('#resetAll').onclick = () => {
    if (!confirm('명단, 교실 형태, 배치를 모두 초기화할까요?')) return;
    S = defaults(); editMode = false; selected = null; render();
  };

  let rt;
  window.addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(sizeRoom, 80); });

  $('#today').textContent = new Date().toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'short' });
  render();
})();
