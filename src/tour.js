// Live tour: a guide cursor uses the real app on the sample pack and explains each part in English and
// Bangla at the same time. Both languages are always on screen, so the copy sits beside the actions it
// narrates instead of in i18n.js. main.js sets the visitor's own project aside first and puts it back after.
import './tour.css';

const SEEN_KEY = 'tpb_tour_seen';
const FILE_MIME = 'application/x-tpb-file';
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const canDrag = () => matchMedia('(hover: hover) and (pointer: fine)').matches;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const bnDigits = (s) => String(s).replace(/\d/g, (d) => '০১২৩৪৫৬৭৮৯'[d]);

let app = null; // hooks from main.js
let run = null; // the tour that is playing

class Stopped extends Error {}

export function tourSeen() {
  try {
    return localStorage.getItem(SEEN_KEY) === '1';
  } catch {
    return false;
  }
}

function markSeen() {
  try {
    localStorage.setItem(SEEN_KEY, '1');
  } catch {}
  app.render(); // drops the "new" pulse on the nav button
}

/** First visit: offer the tour once the intro animation is over. `?tour` in the URL starts it directly. */
export function setupTour(hooks) {
  app = hooks;
  document.addEventListener('keydown', onKey, true);
  // Keyboard focus stays on the tour's controls; the page behind is the guide's to drive.
  document.addEventListener('focusin', (e) => {
    if (run && !run.stopped && !run.card.contains(e.target)) focusCard();
  });
  const asked = new URLSearchParams(location.search).has('tour');
  if (!asked && (tourSeen() || navigator.webdriver)) return;
  afterIntro().then(() => (asked ? startTour() : welcome()));
}

async function afterIntro() {
  await app.ready;
  const intro = document.getElementById('intro');
  while (intro && !intro.hasAttribute('data-done')) await sleep(120);
  await sleep(450);
}

// ---------------- Icons ----------------

const CURSOR = '<svg viewBox="0 0 28 28" aria-hidden="true"><path d="M6 3.2v19.6c0 .6.7.9 1.1.5l4.6-4.5 3 6.6c.2.4.6.5 1 .4l2.5-1.1c.4-.2.5-.6.4-1l-3-6.5h6.3c.6 0 .9-.7.5-1.1L7.1 2.7C6.7 2.3 6 2.6 6 3.2Z"/></svg>';
const svg = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const I_PAUSE = svg('<path d="M9 6v12M15 6v12"/>');
const I_PLAY = svg('<path d="M8 5.5v13l10-6.5Z" fill="currentColor"/>');
const I_NEXT = svg('<path d="m9 6 6 6-6 6"/>');
const I_REPLAY = svg('<path d="M4 12a8 8 0 1 0 2.4-5.7M4 4v4.5h4.5"/>');
const I_X = svg('<path d="M7 7l10 10M17 7 7 17"/>');

// ---------------- Welcome popup ----------------

function welcome() {
  if (run || document.querySelector('dialog.tour-welcome')) return;
  const steps = [['01', 'Tender'], ['02', 'Files'], ['03', 'Match'], ['04', 'Package']];
  const dlg = document.createElement('dialog');
  dlg.className = 'tour-welcome';
  dlg.setAttribute('aria-labelledby', 'tw-title');
  dlg.innerHTML = `
    <div class="tw-stage" aria-hidden="true"><div class="tw-track">
      <div class="tw-steps">${steps.map(([n, s], i) => `<span class="tw-step" style="--n:${i}"><i>${n}</i>${s}</span>`).join('')}</div>
      <span class="tw-cursor">${CURSOR}</span>
    </div></div>
    <div class="tw-body">
      <p class="tw-eyebrow"><i></i>Live tour · <span lang="bn">লাইভ ট্যুর</span></p>
      <h2 id="tw-title">Watch TenderNest work for you</h2>
      <p class="tw-bn-title" lang="bn">টেন্ডারনেস্ট কীভাবে কাজ করে, নিজের চোখে দেখুন</p>
      <p class="tw-text">A guide cursor runs the whole app on a sample tender and explains each part. About 90 seconds. Your own files stay untouched.</p>
      <p class="tw-text" lang="bn">একটি গাইড কার্সর নমুনা টেন্ডারে পুরো অ্যাপ চালিয়ে প্রতিটি অংশ বুঝিয়ে দেবে। প্রায় দেড় মিনিট। আপনার নিজের ফাইলে হাত পড়বে না।</p>
    </div>
    <div class="tw-actions">
      <button class="btn" data-tw="skip">Skip · <span lang="bn">এড়িয়ে যান</span></button>
      <button class="btn primary" data-tw="start" autofocus>${I_PLAY} Start tour · <span lang="bn">শুরু করুন</span></button>
    </div>
    <p class="tw-foot">Replay any time from <b>Live tour</b> in the menu · <span lang="bn">মেনুর <b>লাইভ ট্যুর</b> থেকে যেকোনো সময় আবার দেখুন</span></p>`;
  let left = false;
  const leave = (start) => {
    if (left) return;
    left = true;
    markSeen();
    fadeOut(dlg, () => {
      if (dlg.open) dlg.close();
      dlg.remove();
      if (start) startTour();
    });
  };
  dlg.addEventListener('click', (e) => {
    const b = e.target.closest('[data-tw]');
    if (b) leave(b.dataset.tw === 'start');
    else if (e.target === dlg) leave(false); // backdrop
  });
  dlg.addEventListener('cancel', (e) => {
    e.preventDefault();
    leave(false);
  });
  document.body.appendChild(dlg);
  dlg.showModal();
}

function fadeOut(el, done) {
  if (reduced()) return done();
  let fired = false;
  const finish = () => !fired && ((fired = true), done());
  el.classList.add('closing');
  el.addEventListener('animationend', (e) => e.target === el && finish());
  setTimeout(finish, 400);
}

// ---------------- The script ----------------

/** Each step: copy in both languages (or a function picking device-specific copy) and what the cursor does. */
const STEPS = [
  {
    en: ['Hi! I’m your guide', 'Watch me use TenderNest for you, one step at a time. Just sit back.'],
    bn: ['হ্যালো! আমি আপনার গাইড', 'ধাপে ধাপে আমি টেন্ডারনেস্ট চালিয়ে দেখাচ্ছি। আপনি শুধু দেখুন।'],
    async go() {
      spot();
      await wait(400);
      const b = run.card.getBoundingClientRect();
      const x = b.right - 40;
      const y = b.top - 28;
      await glide(x, y);
      for (const dx of [-14, 12, -8, 0]) await glide(x + dx, y - Math.abs(dx) / 3, 170); // a little wave
    },
  },
  {
    en: ['Just four steps', 'Tender → Files → Match → Package. Each step gets a ✓ when it’s done.'],
    bn: ['মাত্র চারটি ধাপ', 'টেন্ডার → ফাইল → মেলানো → প্যাকেজ। প্রতিটি ধাপ শেষ হলে ✓ চিহ্ন পড়ে।'],
    async go() {
      const nav = find('.rail .steps') || find('.tabbar');
      if (!nav) return;
      spot(nav);
      for (const b of nav.querySelectorAll('[data-tab]')) {
        await hover(b, nav.matches('.tabbar') ? 0.5 : 0.3, 0.5, 420);
        await wait(160);
      }
    },
  },
  {
    en: ['Start with the tender', 'Open the tender’s requirements.json here. Today, let’s use the sample.'],
    bn: ['টেন্ডার দিয়ে শুরু', 'এখানে টেন্ডারের requirements.json খুলুন। চলুন, আজ নমুনা দিয়ে দেখি।'],
    async go() {
      const sample = find('[data-act="sample"]');
      if (!sample) return;
      await show(sample.parentElement);
      await hover(find('#sec-tender label.btn.primary'), 0.4, 0.5);
      await wait(900);
      await press(sample);
      await until(() => !app.ui.busy && app.project.files.length, 20000);
      await wait(350);
    },
  },
  {
    when: () => app.isDesktop(),
    en: ['Every file is checked', 'A logo image was turned away, because only PDFs get in. Copies are caught too.'],
    bn: ['প্রতিটি ফাইল যাচাই হয়', 'একটি লোগো ছবি বাদ পড়েছে, কারণ শুধু PDF নেওয়া হয়। একই ফাইল দুবার থাকলে তাও ধরা পড়ে।'],
    async go() {
      const list = find('.notices');
      if (!list) return;
      spot(list);
      await hover(find('.notice.error') || list, 0.35, 0.5);
    },
  },
  {
    en: () => ['The tender at a glance', `ID, deadline and the ${reqCount()} documents it asks for, all read from one file.`],
    bn: () => ['এক নজরে টেন্ডার', `আইডি, শেষ তারিখ আর চাওয়া ${bnDigits(reqCount())}টি ডকুমেন্ট, সব একটি ফাইল থেকেই।`],
    async go() {
      app.clearNotices();
      await nav('tender'); // loading the pack moved the app on to Files
      const dl = find('#sec-tender dl.tender');
      if (!dl) return;
      await show(dl, dl.nextElementSibling); // with the "N documents required" line
      await hover(dl.querySelector('strong') || dl, 0.3, 0.5);
    },
  },
  {
    en: ['All your PDFs in one place', 'Drop them in all at once. Pages are counted and duplicates are marked.'],
    bn: ['সব PDF এক জায়গায়', 'সব ফাইল একসাথে দিন। পৃষ্ঠা গোনা হয়, ডুপ্লিকেট চিহ্নিত হয়।'],
    async go() {
      await nav('files');
      const drop = find('#sec-files .drop');
      if (drop) {
        await show(drop);
        await hover(drop.querySelector('.btn') || drop);
        await wait(900);
      }
      const table = find('#sec-files .table-wrap');
      const dup = find('#sec-files .dup-row');
      if (!table) return;
      await show(app.isDesktop() ? table : dup || table);
      await hover(dup?.querySelector('.badge') || table);
    },
  },
  {
    en: ['Peek inside', 'Open any file to make sure it’s the right one.'],
    bn: ['ভেতরে দেখে নিন', 'যেকোনো ফাইল খুলে দেখে নিন, ঠিক ফাইল কি না।'],
    async go() {
      const btn = find('#sec-files tr[data-file] [data-act="preview"]');
      if (!btn) return;
      await show(btn.closest('tr'));
      await press(btn);
      const box = await until(() => find('.modal-box'), 3000);
      if (!box) return;
      spot(box);
      await hover(box, 0.6, 0.45);
      await wait(1900);
      await press(find('.modal-box [data-act="close-preview"]'));
      await until(() => !find('.modal'), 2000);
    },
  },
  {
    en: ['The health check', 'This line shows what’s ready. Red means there’s still work left.'],
    bn: ['এক লাইনে অবস্থা', 'কী প্রস্তুত, এই লাইনেই দেখা যায়। লাল মানে এখনো কাজ বাকি।'],
    async go() {
      await nav('match');
      const s = find('#sec-match .summary');
      if (!s) return;
      await show(s);
      await hover(s, 0.25, 0.5);
    },
  },
  {
    en: ['Auto-match in one click', 'It reads file names and fills the rows. Green = OK, orange = needs a date, red = missing.'],
    bn: ['এক ক্লিকে অটো-ম্যাচ', 'ফাইলের নাম পড়ে সারিগুলো পূরণ করে। সবুজ = ঠিক, কমলা = তারিখ চাই, লাল = নেই।'],
    async go() {
      const auto = find('[data-act="auto"]');
      if (!auto) return;
      await show(auto);
      await press(auto);
      await wait(450);
      app.clearNotices();
      const table = find('#sec-match .table-wrap');
      if (!table) return;
      await show(table);
      for (const st of ['ok', 'expiry_needed', 'missing']) {
        const badge = find(`#sec-match tr.st-${st} .c-status .badge`);
        if (!badge || !inView(badge)) continue;
        await hover(badge);
        await wait(420);
      }
    },
  },
  {
    en: ['Expired? It gets caught', 'A date before the deadline turns the row red and blocks the package.'],
    bn: ['মেয়াদ শেষ? ধরা পড়বেই', 'জমার শেষ তারিখের আগে মেয়াদ ফুরালে সারি লাল হয়, প্যাকেজ আটকে যায়।'],
    async go() {
      const row = find('#sec-match tr.st-expiry_needed');
      const input = row?.querySelector('input[type="date"]');
      if (!input) return;
      const lastYear = Number(app.project.reqs.tender.submission_deadline.slice(0, 4)) - 1;
      await show(row);
      await press(input, () => pick(input, `${lastYear}-06-30`), 0.3, 0.5);
      await wait(350);
      await hover(row.querySelector('.c-status .badge'));
    },
  },
  {
    en: ['It reads the real date', 'The expiry date was found inside the file. Tap “Use it” and it’s fixed.'],
    bn: ['আসল তারিখ ফাইল থেকেই', 'মেয়াদের তারিখ ফাইলের ভেতরেই পাওয়া গেছে। “এটি ব্যবহার করুন” চাপলেই ঠিক।'],
    async go() {
      for (let i = 0; i < 4; i++) {
        const use = find('#sec-match [data-act="use-expiry"]');
        if (!use) break;
        const row = use.closest('tr');
        await show(row);
        await press(use);
        await wait(300);
        await hover(row.querySelector('.c-status .badge'));
        await wait(350);
      }
    },
  },
  {
    en: () => (dragging()
      ? ['Drag the rest into place', 'A scan has no useful name, so drag it onto the right document.']
      : ['Pick the rest by hand', 'A scan has no useful name, so choose it from the list.']),
    bn: () => (dragging()
      ? ['বাকিটা টেনে বসান', 'স্ক্যান ফাইলের নাম দেখে কিছু বোঝা যায় না, তাই সঠিক ডকুমেন্টে টেনে ছাড়ুন।']
      : ['বাকিটা নিজে বেছে নিন', 'স্ক্যান ফাইলের নাম দেখে কিছু বোঝা যায় না, তাই তালিকা থেকে বেছে নিন।']),
    async go() {
      const p = app.project;
      const used = new Set(Object.values(p.matches));
      const req = p.reqs.requirements.find((r) => r.mandatory && !p.matches[r.id]);
      const file = p.files.find((f) => !used.has(f.id) && /scan/i.test(f.name));
      const row = req && document.getElementById(`r-${req.id}`);
      if (!row || !file) return;
      const chip = find(`.file-tray .chip[data-file="${file.id}"]`);
      if (chip && dragging()) {
        spot(chip, row);
        await ensureVisible(row);
        await drag(chip, row, () => dropOn(row, req.id, file.id));
      } else {
        const select = row.querySelector('select');
        await show(row);
        await press(select, () => pick(select, file.id), 0.35, 0.5);
      }
      await wait(350);
      await hover(row.querySelector('.c-status .badge'));
    },
  },
  {
    en: ['Everything required is in', 'All mandatory documents are OK. Nothing is blocking anymore.'],
    bn: ['সব আবশ্যিক কাগজ প্রস্তুত', 'সব বাধ্যতামূলক ডকুমেন্ট ঠিক আছে। আর কিছুই আটকে নেই।'],
    async go() {
      const target = find('.rail .ready-card') || find('#sec-match .summary');
      if (!target) return;
      await show(target);
      await hover(target, app.isDesktop() ? 0.2 : 0.3, 0.5);
    },
  },
  {
    en: ['Build the package', 'The button only unlocks when everything is clear. One click, one PDF.'],
    bn: ['প্যাকেজ তৈরি', 'সব ঠিক থাকলেই বোতামটি চালু হয়। এক ক্লিকে একটি PDF।'],
    async go() {
      await nav('package');
      const ok = find('#sec-package .ready');
      if (ok) {
        await show(ok);
        await hover(ok, 0.2, 0.5);
        await wait(800);
      }
      const gen = find('[data-act="generate"]');
      if (!gen || gen.disabled) return;
      await show(gen);
      await press(gen);
      await until(() => app.ui.output && !app.ui.busy, 30000);
    },
  },
  {
    en: ['Ready to submit', 'Cover, index and every file in the right order. Download it right here.'],
    bn: ['জমা দেওয়ার জন্য প্রস্তুত', 'কভার, সূচিপত্র আর সঠিক ক্রমে সব ফাইল। এখান থেকেই ডাউনলোড করুন।'],
    async go() {
      const dl = await until(() => find('#sec-package .gen a.success'), 3000);
      if (!dl) return;
      const preview = find('#sec-package .pdf-preview');
      await show(dl.parentElement, preview);
      if (preview && inView(preview)) {
        await hover(preview, 0.5, 0.35);
        await wait(900);
      }
      await hover(dl, 0.4, 0.5);
    },
  },
  {
    en: ['English or Bangla', 'One tap switches the whole app: every label, every message.'],
    bn: ['ইংরেজি বা বাংলা', 'এক ট্যাপে পুরো অ্যাপের ভাষা বদলে যায়: প্রতিটি লেখা, প্রতিটি বার্তা।'],
    async go() {
      const other = find('[data-act="lang"]:not(.on)');
      if (!other) return;
      spot(other.parentElement);
      await press(other);
      await wait(1700);
      await press(find('[data-act="lang"]:not(.on)'));
    },
  },
  {
    last: true,
    en: ['You’re all set!', 'Your files never leave this browser. The sample clears away and your own work stays just as it was.'],
    bn: ['আপনি প্রস্তুত!', 'আপনার ফাইল এই ব্রাউজারের বাইরে যায় না। নমুনাটি সরে যাবে, আপনার নিজের কাজ যেমন ছিল তেমনই থাকবে।'],
    async go() {
      spot();
      await wait(450);
      await hover(run.card.querySelector('[data-tour="done"]'), 0.3, 0.6);
    },
  },
];

const reqCount = () => app.project.reqs?.requirements.length ?? 0;
const dragging = () => canDrag() && app.isDesktop();

// ---------------- Running the tour ----------------

export async function startTour() {
  if (run || !app) return;
  await app.ready; // the saved project must be in place before it's set aside
  if (run || app.ui.busy) return;
  markSeen();
  run = {
    time: 0, last: 0, waiters: [], paused: false, skip: false, stopped: false,
    cur: { x: innerWidth * 0.78, y: innerHeight * 0.8 }, bend: 0.12, glide: null, anchor: null, ghost: null,
    spotEls: [], spotAt: 0, spotNow: null, spotRect: null, cardPos: null, cardSide: -1, read: null, decide: null,
  };
  run.restore = app.begin();
  mount();
  run.raf = requestAnimationFrame(frame);
  let outcome = 'stop';
  try {
    outcome = await play();
  } catch (e) {
    if (!(e instanceof Stopped)) console.warn('Live tour stopped early:', e);
  }
  await finish(outcome === 'replay');
}

async function play() {
  const steps = STEPS.filter((s) => !s.when || s.when());
  run.bars.innerHTML = '<span class="tc-bar"><i></i></span>'.repeat(steps.length);
  for (const [i, s] of steps.entries()) {
    run.skip = false;
    const copy = caption(s, i, steps.length);
    const t0 = run.time;
    await s.go();
    if (s.last) return choice();
    const readMs = clamp(2000 + (copy.en[0].length + copy.en[1].length) * 36, 3200, 6200);
    await read(Math.max(1400, readMs - (run.time - t0)));
  }
  return 'done';
}

function stop() {
  const r = run;
  if (!r || r.stopped) return;
  r.stopped = true;
  for (const w of r.waiters) w.reject(new Stopped());
  r.waiters = [];
  r.decide?.('stop');
}

async function finish(replay) {
  const r = run;
  stop();
  r.layer.classList.add('leaving');
  document.body.classList.remove('dragging-file');
  r.restore(); // a sample load or PDF build still in flight drops its result (see ui.epoch)
  await sleep(reduced() ? 0 : 340);
  cancelAnimationFrame(r.raf);
  r.layer.remove();
  run = null;
  if (replay) startTour();
}

// ---------------- Clock: every wait and glide runs on tour time, so Pause freezes all of it ----------------

function check() {
  if (!run || run.stopped) throw new Stopped();
}

function wait(ms) {
  check();
  return new Promise((resolve, reject) => run.waiters.push({ at: run.time + ms, resolve, reject }));
}

const nextFrame = () => new Promise((r) => requestAnimationFrame(r)).then(check);

/** Poll the app (in real time) until `test` passes; null on timeout. */
async function until(test, ms = 15000) {
  const end = Date.now() + ms;
  for (;;) {
    check();
    const v = test();
    if (v) return v;
    if (Date.now() > end) return null;
    await sleep(80);
  }
}

/** Let the viewer read; the current progress segment fills meanwhile. Next ends it early. */
async function read(ms) {
  const r = run;
  r.read = { t0: r.time, ms };
  while (r.time - r.read.t0 < ms && !r.skip) await nextFrame();
  r.read = null;
}

function choice() {
  check();
  return new Promise((resolve) => (run.decide = resolve));
}

function frame(now) {
  const r = run;
  if (!r) return;
  const dt = r.last ? Math.min(64, now - r.last) : 16;
  r.last = now;
  if (!r.paused) r.time += dt * (r.skip ? 3 : 1); // Next fast-forwards whatever the cursor is doing
  if (r.waiters.length) r.waiters = r.waiters.filter((w) => (w.at <= r.time ? (w.resolve(), false) : true));
  // Read layout first, then write, so a frame forces at most one layout.
  moveCursor(r);
  const spotGoal = measureSpot(r);
  const desk = app.isDesktop();
  const cardGoal = desk ? place(r.spotRect, r.card.offsetWidth, r.card.offsetHeight, r.cardSide) : null;
  const ease = (tau) => (reduced() ? 1 : 1 - Math.exp(-dt / tau));

  const k = ease(performance.now() - r.spotAt < 500 ? 80 : 22); // glide to a new target, then track it tightly
  const s = (r.spotNow ||= { ...spotGoal });
  for (const key of ['x', 'y', 'w', 'h']) s[key] += (spotGoal[key] - s[key]) * k;
  r.spotEl.style.transform = `translate3d(${s.x}px, ${s.y}px, 0)`;
  r.spotEl.style.width = `${s.w}px`;
  r.spotEl.style.height = `${s.h}px`;
  r.spotEl.classList.toggle('none', !r.spotRect);

  if (cardGoal) {
    r.cardSide = cardGoal.side;
    const c = (r.cardPos ||= { x: cardGoal.x, y: cardGoal.y });
    const kc = ease(120);
    c.x += (cardGoal.x - c.x) * kc;
    c.y += (cardGoal.y - c.y) * kc;
    r.card.style.transform = `translate3d(${c.x}px, ${c.y}px, 0)`;
  } else if (r.cardPos) {
    r.card.style.transform = '';
    r.cardPos = null;
  }

  r.cursor.style.transform = `translate3d(${r.cur.x}px, ${r.cur.y}px, 0)`;
  const flip = r.cur.x > innerWidth - (r.flip ? 150 : 110); // keep the Guide tag on screen near the right edge
  if (flip !== r.flip) r.cursor.classList.toggle('flip', (r.flip = flip));
  if (r.ghost) r.ghost.el.style.transform = `translate3d(${r.cur.x + r.ghost.dx}px, ${r.cur.y + r.ghost.dy}px, 0)`;
  if (r.read && r.fill) r.fill.style.transform = `scaleX(${clamp((r.time - r.read.t0) / r.read.ms, 0, 1)})`;
  r.raf = requestAnimationFrame(frame);
}

// ---------------- Cursor ----------------

function moveCursor(r) {
  const g = r.glide;
  if (g) {
    const p = clamp((r.time - g.t0) / g.dur, 0, 1);
    const e = p < 0.5 ? 4 * p ** 3 : 1 - (-2 * p + 2) ** 3 / 2;
    const a = g.from;
    const b = g.to();
    // A slight arc, like a hand moving a mouse, bending the other way each time.
    const cx = (a.x + b.x) / 2 - (b.y - a.y) * g.k;
    const cy = (a.y + b.y) / 2 + (b.x - a.x) * g.k;
    const u = 1 - e;
    r.cur = { x: u * u * a.x + 2 * u * e * cx + e * e * b.x, y: u * u * a.y + 2 * u * e * cy + e * e * b.y };
    if (p >= 1) r.glide = null;
  } else if (r.anchor) {
    r.cur = anchorPoint(r.anchor) || r.cur; // stay on the element if the page shifts under it
  }
}

function anchorPoint({ el, fx, fy }) {
  if (!el.isConnected) return null;
  const b = el.getBoundingClientRect();
  if (!b.width && !b.height) return null;
  return { x: clamp(b.left + b.width * fx, 6, innerWidth - 6), y: clamp(b.top + b.height * fy, 6, innerHeight - 6) };
}

function glideTo(to, dur) {
  const r = run;
  const from = { ...r.cur };
  const end = to();
  dur ??= clamp(360 + Math.hypot(end.x - from.x, end.y - from.y) * 0.55, 380, 1050);
  r.bend = -r.bend;
  r.glide = { from, to, t0: r.time, dur: reduced() ? 1 : dur, k: r.bend };
  return wait(r.glide.dur);
}

function glide(x, y, dur) {
  run.anchor = null;
  return glideTo(() => ({ x, y }), dur);
}

async function hover(el, fx = 0.5, fy = 0.5, dur) {
  if (!el?.isConnected) return;
  const a = { el, fx, fy };
  let last = anchorPoint(a) || run.cur;
  run.anchor = null;
  await glideTo(() => (last = anchorPoint(a) || last), dur);
  run.anchor = a;
}

/** Move to `el`, press, then run `action` (a real click by default, so the app's own handlers do the work). */
async function press(el, action, fx, fy) {
  if (!el?.isConnected) return;
  await hover(el, fx, fy);
  await wait(140);
  const r = run;
  r.cursor.classList.add('down');
  if (el.matches('button, .btn, select, input')) el.classList.add('tour-press');
  ripple();
  await wait(120);
  r.cursor.classList.remove('down');
  el.classList.remove('tour-press');
  (action || (() => el.click()))();
  await wait(240);
}

function ripple() {
  const s = document.createElement('span');
  s.className = 'tour-ripple';
  s.style.setProperty('--x', `${run.cur.x}px`);
  s.style.setProperty('--y', `${run.cur.y}px`);
  run.layer.appendChild(s);
  setTimeout(() => s.remove(), 700);
}

/** Pick up `src`, carry a copy of it to `dst` and let go there. */
async function drag(src, dst, onDrop) {
  await hover(src, 0.25, 0.5);
  await wait(150);
  const r = run;
  r.cursor.classList.add('down');
  await wait(120);
  const b = src.getBoundingClientRect();
  const ghost = src.cloneNode(true);
  ghost.classList.add('tour-ghost');
  ghost.removeAttribute('draggable');
  ghost.style.width = `${b.width}px`;
  r.layer.appendChild(ghost);
  r.ghost = { el: ghost, dx: b.left - r.cur.x, dy: b.top - r.cur.y };
  src.classList.add('tour-src');
  document.body.classList.add('dragging-file');
  await hover(dst, 0.45, 0.5, 950);
  dst.classList.add('over');
  await wait(350);
  r.cursor.classList.remove('down');
  r.ghost = null;
  ghost.classList.add('dropped');
  setTimeout(() => ghost.remove(), 320);
  document.body.classList.remove('dragging-file');
  dst.classList.remove('over');
  onDrop();
  await wait(300);
}

/** Drop through the app's real drop handler; fall back to its file picker if the browser can't fake a drop. */
function dropOn(row, reqId, fileId) {
  try {
    const dt = new DataTransfer();
    dt.setData(FILE_MIME, fileId);
    row.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
  } catch {}
  if (app.project.matches[reqId] !== fileId) pick(row.querySelector('select'), fileId);
}

function pick(field, value) {
  if (!field) return;
  field.value = value;
  field.dispatchEvent(new Event('change', { bubbles: true }));
}

// ---------------- Finding things, scrolling, spotlight ----------------

function find(sel) {
  for (const el of document.querySelectorAll(sel)) if (el.getClientRects().length) return el;
  return null;
}

function unionRect(els) {
  let l = Infinity, t = Infinity, r = -Infinity, b = -Infinity;
  for (const el of els) {
    if (!el?.isConnected || !el.getClientRects().length) continue;
    const x = el.getBoundingClientRect();
    l = Math.min(l, x.left);
    t = Math.min(t, x.top);
    r = Math.max(r, x.right);
    b = Math.max(b, x.bottom);
  }
  return l === Infinity ? null : { left: l, top: t, right: r, bottom: b, height: b - t };
}

/** The band of the viewport the tour can show things in (below the phone nav bar, above the caption card). */
function viewBand(els = []) {
  const v = app.isDesktop() ? { top: 24, bottom: innerHeight - 24 } : { top: 72, bottom: run.card.getBoundingClientRect().top - 12 };
  // rows under the sticky file tray would scroll in behind it
  const tray = find('.file-tray');
  const under = (el) => tray.parentElement.contains(el) && tray.compareDocumentPosition(el) === Node.DOCUMENT_POSITION_FOLLOWING;
  if (tray && getComputedStyle(tray).position === 'sticky' && els.some(under)) v.top = Math.max(v.top, parseFloat(getComputedStyle(tray).top) + tray.offsetHeight + 12);
  return v;
}

function inView(el) {
  const b = el.getBoundingClientRect();
  const v = viewBand([el]);
  return b.top >= v.top - 4 && b.bottom <= v.bottom + 4;
}

function spot(...els) {
  run.spotEls = els.filter(Boolean);
  run.spotAt = performance.now();
}

async function show(...els) {
  spot(...els);
  await ensureVisible(...els);
}

/** Scroll so the elements sit comfortably in view, then wait for the page to stop moving. */
async function ensureVisible(...els) {
  const live = els.filter((el) => el && !el.closest('.rail, .tabbar, .mtop, .notices, .modal'));
  const u = unionRect(live);
  if (!u) return;
  const v = viewBand(live);
  if (u.top >= v.top && u.bottom <= v.bottom) return;
  const room = v.bottom - v.top;
  const top = app.isDesktop() && u.height < room ? v.top + (room - u.height) / 2 : v.top + 8;
  const y = clamp(scrollY + u.top - top, 0, document.documentElement.scrollHeight - innerHeight);
  if (Math.abs(y - scrollY) < 2) return;
  run.anchor = null; // the cursor stays put while the page moves under it
  window.scrollTo({ top: y, behavior: reduced() ? 'auto' : 'smooth' });
  await settle();
}

async function settle() {
  let last = NaN;
  let still = 0;
  const end = performance.now() + 1600;
  while (still < 6 && performance.now() < end) {
    await nextFrame();
    still = Math.abs(scrollY - last) < 0.5 ? still + 1 : 0;
    last = scrollY;
  }
}

/** Click a step in the side rail (desktop) or tab bar (phones), like a person would. */
async function nav(tab) {
  const b = find(`.rail [data-tab="${tab}"]`) || find(`.tabbar [data-tab="${tab}"]`);
  if (!b) return;
  spot(b);
  await press(b, null, b.closest('.tabbar') ? 0.5 : 0.3, 0.5);
  await settle();
  await wait(200);
}

function measureSpot(r) {
  const vw = innerWidth;
  const vh = innerHeight;
  const u = unionRect(r.spotEls);
  r.spotRect = null;
  if (u) {
    const pad = 8;
    const x = Math.max(6, u.left - pad);
    const y = Math.max(6, u.top - pad);
    const w = Math.min(vw - 6, u.right + pad) - x;
    const h = Math.min(vh - 6, u.bottom + pad) - y;
    if (w > 4 && h > 4) r.spotRect = { x, y, w, h };
  }
  return r.spotRect || { x: vw / 2, y: vh / 2, w: 0, h: 0 };
}

/** Desktop: put the card beside the spotlight where it covers the least of it; stay put unless moving clearly helps. */
function place(s, w, h, prev) {
  const vw = innerWidth;
  const vh = innerHeight;
  const m = 16;
  const g = 18;
  if (!s) return { side: -1, x: (vw - w) / 2, y: (vh - h) / 2 };
  const X = (x) => clamp(x, m, vw - w - m);
  const Y = (y) => clamp(y, m, vh - h - m);
  const spots = [
    [s.x + s.w + g, s.y], [s.x - g - w, s.y], [s.x, s.y + s.h + g], [s.x, s.y - g - h], // right, left, below, above
    [m, vh - h], [vw - w, vh - h], [m, m], [vw - w, m], // corners
  ].map(([x, y]) => [X(x), Y(y)]);
  const cover = ([x, y]) =>
    Math.max(0, Math.min(x + w, s.x + s.w) - Math.max(x, s.x)) * Math.max(0, Math.min(y + h, s.y + s.h) - Math.max(y, s.y));
  let best = 0;
  spots.forEach((p, i) => cover(p) < cover(spots[best]) && (best = i));
  if (prev >= 0 && cover(spots[prev]) <= cover(spots[best]) + 1) best = prev;
  return { side: best, x: spots[best][0], y: spots[best][1] };
}

// ---------------- Tour UI ----------------

function mount() {
  const r = run;
  const layer = document.createElement('div');
  layer.className = 'tour-layer';
  layer.innerHTML = `
    <div class="tour-shield"></div>
    <div class="tour-spot none"></div>
    <section class="tour-card" role="dialog" aria-label="Live tour · লাইভ ট্যুর">
      <div class="tc-top">
        <div class="tc-bars"></div>
        <button class="tc-x" data-tour="stop" aria-label="End tour · ট্যুর বন্ধ করুন">${I_X}</button>
      </div>
      <div class="tc-meta">
        <span class="tc-count"></span>
        <span class="tc-live"><i></i><span class="s-live">Live demo · <span lang="bn">লাইভ ডেমো</span></span><span class="s-paused">Paused · <span lang="bn">থামানো</span></span><span class="s-end">Tour complete · <span lang="bn">ট্যুর শেষ</span></span></span>
      </div>
      <div class="tc-body" aria-live="polite"></div>
      <div class="tc-foot">
        <button class="tc-btn icon" data-tour="pause" aria-label="Pause · থামান"><span class="i-pause">${I_PAUSE}</span><span class="i-play">${I_PLAY}</span></button>
        <button class="tc-btn ghost" data-tour="stop">Skip · <span lang="bn">এড়িয়ে যান</span></button>
        <button class="tc-btn primary" data-tour="next">Next · <span lang="bn">পরের</span>${I_NEXT}</button>
        <button class="tc-btn ghost" data-tour="replay">${I_REPLAY}Replay · <span lang="bn">আবার দেখুন</span></button>
        <button class="tc-btn primary" data-tour="done">Start using · <span lang="bn">শুরু করুন</span></button>
      </div>
    </section>
    <div class="tour-cursor">${CURSOR}<span class="tour-tag">Guide · <span lang="bn">গাইড</span></span></div>`;
  document.body.appendChild(layer);
  Object.assign(r, {
    layer,
    spotEl: layer.querySelector('.tour-spot'),
    card: layer.querySelector('.tour-card'),
    body: layer.querySelector('.tc-body'),
    count: layer.querySelector('.tc-count'),
    bars: layer.querySelector('.tc-bars'),
    cursor: layer.querySelector('.tour-cursor'),
  });
  // Clicks on the dimmed page are blocked; nudge the card so it's clear where the controls are.
  layer.querySelector('.tour-shield').addEventListener('pointerdown', () => {
    r.card.classList.remove('nudge');
    void r.card.offsetWidth;
    r.card.classList.add('nudge');
  });
  r.card.addEventListener('click', (e) => {
    const act = e.target.closest('[data-tour]')?.dataset.tour;
    if (act === 'pause') togglePause();
    else if (act === 'next') next();
    else if (act === 'stop') stop();
    else if (act === 'replay' || act === 'done') r.decide?.(act);
  });
  requestAnimationFrame(() => layer.classList.add('on'));
  focusCard();
}

function focusCard() {
  const end = run.card.classList.contains('end');
  run.card.querySelector(end ? '[data-tour="done"]' : '[data-tour="next"]').focus({ preventScroll: true });
}

/** Show a step's copy, the visitor's language first, and advance the progress segments. */
function caption(s, i, n) {
  const r = run;
  const copy = { en: typeof s.en === 'function' ? s.en() : s.en, bn: typeof s.bn === 'function' ? s.bn() : s.bn };
  const order = app.getLang() === 'bn' ? ['bn', 'en'] : ['en', 'bn'];
  r.body.innerHTML = order.map((l) => `<div class="tc-copy" lang="${l}"><h3>${copy[l][0]}</h3><p>${copy[l][1]}</p></div>`).join('');
  r.body.classList.remove('swap');
  void r.body.offsetWidth;
  r.body.classList.add('swap');
  r.count.textContent = `${String(i + 1).padStart(2, '0')} / ${String(n).padStart(2, '0')}`;
  [...r.bars.children].forEach((b, j) => (b.firstElementChild.style.transform = `scaleX(${j < i || s.last ? 1 : 0})`));
  r.fill = s.last ? null : r.bars.children[i].firstElementChild;
  r.card.classList.toggle('end', !!s.last);
  if (s.last) focusCard();
  return copy;
}

function togglePause() {
  const r = run;
  if (!r || r.stopped) return;
  r.paused = !r.paused;
  r.card.classList.toggle('paused', r.paused);
  r.card.querySelector('[data-tour="pause"]').setAttribute('aria-label', r.paused ? 'Play · চালান' : 'Pause · থামান');
}

function next() {
  if (!run || run.stopped) return;
  if (run.paused) togglePause();
  run.skip = true;
}

function onKey(e) {
  if (!run || run.stopped) return;
  const onTourButton = e.target.closest?.('.tour-card button');
  if (e.key === 'Escape') {
    e.preventDefault();
    e.stopPropagation();
    stop();
  } else if (e.key === ' ' && !onTourButton && !run.card.classList.contains('end')) {
    e.preventDefault();
    togglePause();
  } else if (e.key === 'ArrowRight' && !run.card.classList.contains('end')) {
    e.preventDefault();
    next();
  } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
    e.preventDefault();
    e.stopPropagation(); // no undoing the guide's work mid-tour
  }
}
