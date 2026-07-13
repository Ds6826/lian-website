// lians-player.js · the "how memory works" explainer on the landing page.
// Not a <video>: a scripted, time-driven scene rendered as live DOM, so it can
// be paused at any instant and every element in every frame stays hoverable,
// clickable, and inspectable. render(t) is a pure function of time · scrubbing
// backwards and forwards is exact.
(function () {
  'use strict';
  const host = document.getElementById('memory-player');
  if (!host) return;

  const D = 40; // seconds
  const CHAPTERS = [
    { t: 0,  title: '1 · A fact arrives',        sub: 'The agent writes what it just learned · mem.add(). Nothing goes straight to storage.' },
    { t: 6,  title: '2 · Admission control',     sub: 'A policy gate screens every write: PII/PHI, source trust, prompt injection, vagueness.' },
    { t: 13, title: '3 · Stored bitemporally',   sub: 'The fact gets two clocks · when it happened, and when it became valid · plus a hash-chain receipt.' },
    { t: 19, title: '4 · The world changes',     sub: 'A revision arrives. The governor closes the old fact’s validity window · nothing is deleted.' },
    { t: 27, title: '5 · Recall · now or then',  sub: 'Present recall returns only current facts. recall_at() returns what was valid on any past date.' },
    { t: 35, title: '6 · Prove it',              sub: 'Every step you just watched is one verifiable hash-chain walk: chain_valid: true.' },
  ];

  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const seg = (t, a, b) => clamp((t - a) / (b - a), 0, 1);
  const ease = (p) => (p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2);
  const lerp = (a, b, p) => a + (b - a) * p;
  const move = (t, a, b, x0, y0, x1, y1) => { const p = ease(seg(t, a, b)); return [lerp(x0, x1, p), lerp(y0, y1, p)]; };

  // ── build the DOM ──────────────────────────────────────────────────────────
  const el = (cls, html, parent) => { const d = document.createElement('div'); d.className = cls; if (html != null) d.innerHTML = html; (parent || scene).appendChild(d); return d; };
  host.classList.add('mplayer');
  const stage = document.createElement('div'); stage.className = 'mplayer-stage'; host.appendChild(stage);
  const scene = document.createElement('div'); scene.className = 'mplayer-scene'; stage.appendChild(scene);
  // scale the fixed-size scene to the container width, video-style
  const fit = () => { const s = stage.clientWidth / 880; scene.style.transform = 'scale(' + s + ')'; stage.style.height = Math.round(440 * s) + 'px'; };
  window.addEventListener('resize', fit);

  const agent = el('mp mp-agent', 'agent: <i>desk-1</i>');
  const clock = el('mp mp-clock', '<span class="lbl">clock</span><span class="d">2025-02-20</span>');
  const clockD = clock.querySelector('.d');

  const gate = el('mp mp-gate', '<b>admission gate</b>');
  const CHECKS = [['PII / PHI / MNPI', 'clean'], ['source trust', 'ok'], ['prompt injection', 'none'], ['vagueness', 'specific']];
  const gchecks = CHECKS.map(([name]) => { const c = document.createElement('div'); c.className = 'mp-gcheck'; c.innerHTML = `<span>${name}</span><span class="st">✓</span>`; gate.appendChild(c); return c; });
  const verdict = document.createElement('div'); verdict.className = 'verdict'; verdict.textContent = '→ admitted'; gate.appendChild(verdict);

  const store = el('mp mp-store', '<b>memory store</b>');
  const factA = el('mp mp-card', '<span class="fn">mem.add</span> <span class="body">"NVDA FY26 guidance raised to <b>$32B</b>"</span>' +
    '<div class="stamps"><div class="mp-stamp s-ev">event_time <b>2025-02-20</b></div><div class="mp-stamp s-vf">valid_from <b>2025-02-20</b></div><div class="mp-stamp s-vt">valid_to <b class="vt">∞ (open)</b></div></div>' +
    '<span class="tagline tl"></span>');
  const factB = el('mp mp-card', '<span class="fn">mem.add</span> <span class="body">"NVDA FY26 guidance raised to <b>$40B</b>"</span>' +
    '<div class="stamps sb"><div class="mp-stamp s-ev">event_time <b>2025-05-19</b></div><div class="mp-stamp s-vf">valid_from <b>2025-05-19</b></div><div class="mp-stamp s-vt">valid_to <b>∞ (open)</b></div></div>' +
    '<span class="tagline tl"></span>');
  const badge = el('mp mp-badge', 'governor: SUPERSEDES ⟶ closes fact-A');
  const query = el('mp mp-query', '<span class="fn">recall</span> <span class="q">"NVDA guidance?"</span><br/><span class="asof">as_of: today</span><div class="res"><span class="v"></span><span class="why"></span></div>');
  const qAsof = query.querySelector('.asof'), qV = query.querySelector('.res .v'), qWhy = query.querySelector('.res .why');

  const chainwrap = el('mp mp-chainwrap', '<b>audit chain · SHA-256, append-only</b><div class="mp-chain"></div>');
  const chainrow = chainwrap.querySelector('.mp-chain');
  const BLOCKS = [
    ['#1040', 'prior event', 'h 77c2…f0'],
    ['#1041 ADD', 'fact-A written', 'h 9f3a…b4 · prev 77c2'],
    ['#1042 ADD', 'fact-B written', 'h c81d…22 · prev 9f3a'],
    ['#1043 SUPERSEDE', 'fact-A window closed', 'h 4e57…9c · prev c81d'],
  ];
  const blocks = BLOCKS.map(([h, n, hash]) => { const b = document.createElement('div'); b.className = 'mp-block'; b.innerHTML = `<b>${h}</b>${n}<br/>${hash}`; chainrow.appendChild(b); return b; });
  const chainOk = el('mp mp-verdictchip', '{"chain_valid": true} ✓');

  const caption = el('mplayer-caption', '<b></b><span></span>', host);
  const capT = caption.querySelector('b'), capS = caption.querySelector('span');
  const inspect = el('mplayer-inspect', '', host);
  const controls = el('mplayer-controls', '', host);
  const playBtn = document.createElement('button'); playBtn.type = 'button'; playBtn.className = 'mp-play'; playBtn.textContent = '▶ Play'; controls.appendChild(playBtn);
  const timeEl = document.createElement('span'); timeEl.className = 'mp-time'; controls.appendChild(timeEl);
  // no scrubber: the six chapter buttons are the navigation · each jumps to
  // that part of the story and plays it
  const chaprow = document.createElement('div'); chaprow.className = 'mp-chapters'; controls.appendChild(chaprow);
  const chapBtns = CHAPTERS.map((c, i) => {
    const b = document.createElement('button'); b.type = 'button'; b.className = 'mp-chap'; b.textContent = c.title;
    b.addEventListener('click', () => { render(c.t + 0.01); if (!playing) play(); else last = null; });
    chaprow.appendChild(b); return b;
  });

  // ── the inspector: every actor explains itself at the current t ───────────
  const vtA = () => (T >= 25.2 ? '2025-05-19 (closed by #1043)' : '∞ · currently valid');
  const INFO = [
    [factA, () => `fact-A · "$32B guidance" · event_time 2025-02-20 · valid_from 2025-02-20 · valid_to ${vtA()}. ${T >= 25.2 ? 'Superseded, never deleted: excluded from present recall, still answers as-of queries and audits.' : 'Live fact: returned by present recall.'}`],
    [factB, () => `fact-B · "$40B guidance" · event_time 2025-05-19 · valid_from 2025-05-19 · valid_to ∞. ${T >= 25.2 ? 'The current version · this is what present recall returns.' : 'The revision on its way into memory.'}`],
    [gate, () => 'Admission control · a policy gate on every write: PII/PHI/MNPI detection, source-trust scoring, prompt-injection quarantine, vagueness filter. Runs in off / monitor / enforce mode.'],
    [store, () => 'The memory store · encrypted, bitemporal facts. Every row carries event_time plus a [valid_from, valid_to) window; recall is validity-gated.'],
    [badge, () => 'The Memory Governor decided SUPERSEDES: same key (NVDA · FY26 · guidance), newer event_time. Deterministic rules first; low-confidence calls queue for human review in the console.'],
    [query, () => (T < 31.5 ? 'recall(query) · present mode: only facts with valid_to = ∞ can be returned, so the stale $32B can’t leak into context.' : 'recall_at(query, as_of=2025-03-01) · point-in-time mode: returns the fact whose validity window contained that date. $40B didn’t exist yet.')],
    [clock, () => 'The scene clock. Bitemporal memory means "now" is just a parameter · any query can be re-run as of any date.'],
    [chainwrap, () => 'Append-only SHA-256 hash chain · each event commits to the previous hash. GET /v1/admin/audit/verify recomputes the walk; any altered row breaks every link after it.'],
    [chainOk, () => 'Verification result · the recomputed hashes match the stored ones, so the record provably was never altered.'],
  ];
  let pinned = null;
  const setInspect = (fn) => { inspect.innerHTML = ''; if (!fn) { inspect.innerHTML = '<span class="hint">▲ hover anything in the frame · pause, jump chapters, click to pin an inspection</span>'; return; } const s = document.createElement('span'); s.textContent = fn(); inspect.appendChild(s); };
  INFO.forEach(([node, fn]) => {
    node.setAttribute('data-live', '1');
    node.addEventListener('pointerenter', () => { if (!pinned) setInspect(fn); });
    node.addEventListener('pointerleave', () => { if (!pinned) setInspect(null); });
    node.addEventListener('click', () => {
      if (pinned === node) { pinned.classList.remove('pinned'); pinned = null; setInspect(null); return; }
      if (pinned) pinned.classList.remove('pinned');
      pinned = node; node.classList.add('pinned'); pause(); setInspect(fn);
    });
  });
  setInspect(null);

  // ── render(t): the whole frame as a function of time ──────────────────────
  const px = (n, x, y, op) => { n.style.left = x + '%'; n.style.top = y + '%'; n.style.opacity = op == null ? 1 : op; n.style.display = (op === 0) ? 'none' : 'block'; };
  // static furniture
  store.style.cssText = 'left:59%;top:8%;width:38%;height:60%';
  gate.style.cssText = 'left:31%;top:12%';
  chainwrap.style.display = 'block';

  let T = 0;
  function render(t) {
    T = t;
    // chapter + caption
    let ci = 0; CHAPTERS.forEach((c, i) => { if (t >= c.t) ci = i; });
    capT.textContent = CHAPTERS[ci].title; capS.textContent = CHAPTERS[ci].sub;
    chapBtns.forEach((b, i) => b.classList.toggle('now', i === ci));
    // clock
    clockD.textContent = t < 19 ? '2025-02-20' : t < 31.5 ? '2025-05-19' : t < 35 ? 'as-of 2025-03-01' : 'today';

    // fact A: slides in from off-screen, docks left of the gate, then → slot A
    {
      let x, y, op = seg(t, 0.8, 2.0);
      [x, y] = move(t, 0.8, 4.0, -26, 15, 4, 15);           // dock at gate entrance
      if (t >= 11.4) { const m = move(t, 11.4, 13, 4, 15, 61.5, 11); x = m[0]; y = m[1]; }
      px(factA, x, y, op);
      factA.classList.toggle('stale', t >= 25.4 && !(t >= 32 && t < 35));
      factA.classList.toggle('glow', (t >= 28.5 && t < 31.5) ? false : (t >= 32 && t < 35));
      const tl = factA.querySelector('.tl');
      tl.textContent = (t >= 32 && t < 35) ? '✓ valid on 2025-03-01' : (t >= 28.5 && t < 31.5 ? 'stale · suppressed' : (t >= 25.4 ? 'superseded · kept for audit' : ''));
      if (t >= 28.5 && t < 31.5) { tl.style.display = 'block'; tl.style.color = '#e0b34a'; } else { tl.style.display = ''; tl.style.color = ''; }
      // stamps appear in ch.3; valid_to closes in ch.4
      factA.querySelector('.s-ev').style.opacity = t >= 14 ? 1 : 0;
      factA.querySelector('.s-vf').style.opacity = t >= 15.3 ? 1 : 0;
      const vt = factA.querySelector('.s-vt'); vt.style.opacity = t >= 16.6 ? 1 : 0;
      vt.classList.toggle('hot', t >= 25.2 && t < 27);
      vt.querySelector('.vt').textContent = t >= 25.2 ? '2025-05-19 (closed)' : '∞ (open)';
    }

    // gate checks · run for A (6–11), re-run fast for B (21.5–23)
    {
      const times = [6.4, 7.5, 8.6, 9.7];
      gchecks.forEach((c, i) => {
        const onA = t >= times[i] && t < 19;
        const onB = t >= 21.5 + i * 0.3 && t < 27;
        c.classList.toggle('on', onA || onB);
      });
      verdict.classList.toggle('show', (t >= 10.8 && t < 19) || (t >= 23 && t < 27));
    }

    // fact B: slides in, docks at the gate, then → slot B
    {
      const op = seg(t, 19.4, 20.6);
      let [x, y] = move(t, 19.4, 21.4, -26, 41, 4, 41);
      if (t >= 23.5) { const m = move(t, 23.5, 25, 4, 41, 61.5, 44); x = m[0]; y = m[1]; }
      px(factB, x, y, t < 19 ? 0 : op);
      factB.querySelector('.sb').style.display = t >= 25.2 ? '' : 'none';
      factB.classList.toggle('glow', t >= 28.5 && t < 31.5);
      factB.classList.toggle('stale', t >= 32 && t < 35);
      const tl = factB.querySelector('.tl');
      tl.textContent = (t >= 28.5 && t < 31.5) ? '✓ current · returned' : (t >= 32 && t < 35 ? 'not yet known on 2025-03-01' : '');
      if (t >= 32 && t < 35) { tl.style.display = 'block'; tl.style.color = '#e0b34a'; } else { tl.style.display = ''; tl.style.color = ''; }
    }

    // governor badge below the gate, pointing at the store
    px(badge, 31, 60, t >= 23 && t < 27 ? seg(t, 23, 23.6) : 0);

    // query card + results
    {
      px(query, 1.5, 44, t >= 27.3 ? seg(t, 27.3, 28) : 0);
      qAsof.textContent = t < 31.5 ? 'as_of: today' : 'as_of: 2025-03-01';
      if (t >= 29 && t < 31.5) { qV.textContent = '→ "$40B"'; qWhy.textContent = 'the only currently-valid version'; }
      else if (t >= 32.6) { qV.textContent = '→ "$32B"'; qWhy.textContent = 'valid then · not today’s $40B'; }
      else { qV.textContent = ''; qWhy.textContent = ''; }
    }

    // audit chain
    {
      blocks[0].style.opacity = 1;
      blocks[1].style.opacity = t >= 17.5 ? 1 : 0.14;
      blocks[2].style.opacity = t >= 25.6 ? 1 : 0.14;
      blocks[3].style.opacity = t >= 26.3 ? 1 : 0.14;
      blocks.forEach((b, i) => b.classList.toggle('verified', t >= 35.2 + i * 0.55 && t < 40));
      px(chainOk, 70, 71.5, t >= 37.6 ? seg(t, 37.6, 38.2) : 0);
    }

    timeEl.textContent = `0:${String(Math.floor(t)).padStart(2, '0')} / 0:40`;
  }

  // ── transport ──────────────────────────────────────────────────────────────
  let playing = false, raf = null, last = null;
  function tick(ts) {
    if (!playing) return;
    if (last == null) last = ts;
    let t = T + (ts - last) / 1000; last = ts;
    if (t >= D) { t = D; render(t); pause(true); return; }
    render(t);
    raf = requestAnimationFrame(tick);
  }
  let everPlayed = false;
  function play() {
    if (!everPlayed) { everPlayed = true; render(0); } // preview frame → start of story
    if (T >= D - 0.05) render(0);
    playing = true; last = null; playBtn.textContent = '❚❚ Pause';
    raf = requestAnimationFrame(tick);
  }
  function pause(ended) {
    playing = false; if (raf) cancelAnimationFrame(raf); raf = null; last = null;
    playBtn.textContent = ended ? '↻ Replay' : '▶ Play';
  }
  playBtn.addEventListener('click', () => (playing ? pause() : play()));
  stage.addEventListener('click', (e) => { if (e.target === stage || e.target === scene) (playing ? pause() : play()); });

  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  fit();
  // initial paint is a populated mid-story frame, not an empty stage;
  // pressing play (or autoplay) rewinds to the beginning
  render(17.9);
  if (!reduced && 'IntersectionObserver' in window) {
    let started = false;
    const io = new IntersectionObserver((entries) => {
      entries.forEach((en) => { if (en.isIntersecting && !started) { started = true; play(); io.disconnect(); } });
    }, { threshold: 0.45 });
    io.observe(host);
  }
})();
