import './style.css';
import { t, setLang, getLang, reqTitle, num, dict } from './i18n.js';
import {
  STATUS, BLOCKING, parseRequirements, allStatuses, blockingProblems, duplicateGroups,
  reqOfFile, canMatch, applyMatch, suggestMatches, parsePageList, csvEscape,
} from './logic.js';
import { sha256, looksLikePdf, inspectPdf, thumbnail, buildPackage } from './pdf.js';
import { saveProject, loadProject, clearProject, exportProjectFile, importProjectFile } from './storage.js';
import { logoMark } from './logo.js';

const MAX_FILES = 30;
const MAX_MB = 50;

/** The whole app state. `project` is persisted; the rest is per-session UI state. */
const emptyProject = () => ({ reqs: null, files: [], matches: {}, expiries: {}, seal: null, includeIndex: true });
let project = emptyProject();
const ui = {
  notices: [], // { kind: 'error'|'info'|'ok', key, vars }
  busy: false,
  output: null, // { url, name, total }
  thumbs: {}, // fileId -> dataURL
  showHelp: false,
  aiText: '',
  aiBusy: false,
  preview: null, // object URL of file being previewed
  history: [], // undo stack of { matches, expiries } snapshots
  tab: 'tender', // active step: the only section shown on phones, the scroll target on desktop
};

const $app = document.getElementById('app');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const uid = () => Math.random().toString(36).slice(2, 10);
const fmtSize = (b) => (b > 1048576 ? `${num((b / 1048576).toFixed(1))} MB` : `${num(Math.max(1, Math.round(b / 1024)))} KB`);

function notify(kind, key, vars = {}) {
  const id = uid();
  ui.notices.push({ kind, key, vars, id });
  if (ui.notices.length > 6) ui.notices.shift();
  // Errors stay until closed; other toasts fade out so they never sit on top of buttons.
  if (kind !== 'error') {
    setTimeout(() => {
      ui.notices = ui.notices.filter((n) => n.id !== id);
      // Remove just the toast (no full re-render, so typing focus is kept).
      $app.querySelector(`[data-act="dismiss"][data-id="${id}"]`)?.closest('.notice')?.remove();
      if (!ui.notices.length) $app.querySelector('.notices')?.remove();
    }, 6000);
  }
}

/** Remember the current matches/expiries so the next change can be undone. */
function remember() {
  ui.history.push({ matches: { ...project.matches }, expiries: { ...project.expiries } });
  if (ui.history.length > 50) ui.history.shift();
}

function undo() {
  const prev = ui.history.pop();
  if (!prev) return;
  // A file may have been removed since; never restore a match to a file that is gone.
  const ids = new Set(project.files.map((f) => f.id));
  const keep = Object.entries(prev.matches).filter(([, fid]) => ids.has(fid));
  project.matches = Object.fromEntries(keep);
  project.expiries = Object.fromEntries(Object.entries(prev.expiries).filter(([r]) => project.matches[r]));
  notify('info', 'undone');
  changed();
}

let saveTimer;
function changed() {
  if (ui.output) {
    URL.revokeObjectURL(ui.output.url);
    ui.output = null; // any change makes an old package stale
  }
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => saveProject(project), 300);
  render();
}

// ---------------- Loading inputs ----------------

function loadRequirementsJson(text) {
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    notify('error', 'err_json');
    return render();
  }
  try {
    const reqs = parseRequirements(json);
    // Keep files that are already uploaded; drop matches to requirement ids that no longer exist.
    const ids = new Set(reqs.requirements.map((r) => r.id));
    const keep = (o) => Object.fromEntries(Object.entries(o).filter(([k]) => ids.has(k)));
    project = { ...project, reqs, matches: keep(project.matches), expiries: keep(project.expiries) };
    changed();
  } catch (e) {
    notify('error', `err_${e.message}`);
    render();
  }
}

/** Add files: reject non-PDFs, damaged and password-protected PDFs, respect limits. */
async function addFiles(fileList) {
  ui.busy = true;
  render();
  let added = 0;
  let total = project.files.reduce((s, f) => s + f.size, 0);
  for (const file of fileList) {
    const name = file.name;
    try {
      const buf = await file.arrayBuffer();
      const isPdfName = /\.pdf$/i.test(name) || file.type === 'application/pdf';
      if (!isPdfName || !looksLikePdf(new Uint8Array(buf))) {
        notify('error', 'err_not_pdf', { name });
        continue;
      }
      if (project.files.length >= MAX_FILES) {
        notify('error', 'err_too_many', { n: MAX_FILES, name });
        continue;
      }
      if (total + buf.byteLength > MAX_MB * 1048576) {
        notify('error', 'err_too_big', { mb: MAX_MB, name });
        continue;
      }
      const hash = await sha256(buf);
      if (project.files.some((f) => f.hash === hash && f.name === name)) {
        notify('info', 'err_same_file', { name });
        continue;
      }
      let info;
      try {
        info = await inspectPdf(buf);
      } catch (e) {
        if (e.message !== 'encrypted') console.warn('could not open PDF', name, e);
        notify('error', e.message === 'encrypted' ? 'err_encrypted' : 'err_damaged', { name });
        continue;
      }
      project.files.push({ id: uid(), name, size: buf.byteLength, hash, buf, ...info });
      total += buf.byteLength;
      added++;
    } catch (e) {
      console.warn('could not read file', name, e);
      notify('error', 'err_damaged', { name });
    }
  }
  ui.busy = false;
  if (added) notify('ok', 'added', { n: added });
  if (Object.keys(duplicateGroups(project.files)).length) {
    if (!ui.notices.some((n) => n.key === 'dup_found')) notify('info', 'dup_found');
  }
  changed();
  loadThumbs();
}

async function loadThumbs() {
  for (const f of project.files) {
    if (ui.thumbs[f.id]) continue;
    try {
      ui.thumbs[f.id] = await thumbnail(f.buf);
      const img = document.querySelector(`img[data-thumb="${f.id}"]`);
      if (img) img.src = ui.thumbs[f.id];
      else render();
    } catch {
      ui.thumbs[f.id] = 'x';
    }
  }
}

async function loadSamplePack() {
  ui.busy = true;
  render();
  try {
    const base = `${import.meta.env.BASE_URL}sample-pack/`;
    const manifest = await (await fetch(`${base}manifest.json`)).json();
    const reqText = await (await fetch(`${base}${manifest.requirements}`)).text();
    project = emptyProject();
    ui.notices = [];
    ui.thumbs = {};
    ui.history = [];
    loadRequirementsJson(reqText);
    const files = [];
    for (const name of manifest.documents) {
      const res = await fetch(`${base}documents/${encodeURIComponent(name)}`);
      if (!res.ok) continue;
      const blob = await res.blob();
      files.push(new File([blob], name, { type: name.endsWith('.pdf') ? 'application/pdf' : blob.type }));
    }
    await addFiles(files);
    notify('info', 'sample_loaded');
  } catch (e) {
    console.error(e);
    notify('error', 'err_sample');
  }
  ui.busy = false;
  render();
}

// ---------------- Actions ----------------

function setMatch(reqId, fileId) {
  if ((project.matches[reqId] || '') === (fileId || '')) return;
  try {
    const r = applyMatch(project, reqId, fileId);
    remember();
    project.matches = r.matches;
    project.expiries = r.expiries;
  } catch (e) {
    notify('error', `err_${e.message}`);
  }
  changed();
}

/**
 * In-app confirmation (bilingual, styled, keyboard friendly) instead of the browser's confirm().
 * Lives outside #app so re-renders never close it. Resolves true only on the confirm button.
 */
function askConfirm(message, okLabel) {
  return new Promise((resolve) => {
    const dlg = document.createElement('dialog');
    dlg.className = 'confirm';
    dlg.innerHTML = `<form method="dialog">
      <p class="confirm-msg">${esc(message)}</p>
      <div class="row confirm-actions">
        <button class="btn" value="cancel" autofocus>${t('cancel')}</button>
        <button class="btn danger" value="ok">${esc(okLabel)}</button>
      </div></form>`;
    dlg.addEventListener('click', (e) => e.target === dlg && dlg.close('cancel')); // backdrop click
    dlg.addEventListener('close', () => {
      resolve(dlg.returnValue === 'ok');
      dlg.remove();
    });
    document.body.appendChild(dlg);
    dlg.showModal();
  });
}

async function removeFile(fileId) {
  const f = project.files.find((x) => x.id === fileId);
  if (!f || !(await askConfirm(t('confirm_remove', { name: f.name }), t('remove')))) return;
  const reqId = reqOfFile(project.matches, fileId);
  if (reqId) {
    delete project.matches[reqId];
    delete project.expiries[reqId];
  }
  project.files = project.files.filter((x) => x.id !== fileId);
  delete ui.thumbs[fileId];
  changed();
}

function autoMatch() {
  const sug = suggestMatches(project);
  const n = Object.keys(sug).length;
  if (n) remember(); // one undo step reverts the whole auto-match
  for (const [reqId, fileId] of Object.entries(sug)) {
    const r = applyMatch(project, reqId, fileId);
    project.matches = r.matches;
    project.expiries = r.expiries;
  }
  notify(n ? 'ok' : 'info', n ? 'auto_matched' : 'auto_none', { n });
  changed();
}

function includedDocs() {
  return project.reqs.requirements
    .filter((r) => project.matches[r.id])
    .map((r) => ({ req: r, file: project.files.find((f) => f.id === project.matches[r.id]) }))
    .filter((d) => d.file);
}

/** Bonus: index page drawn on a canvas so Bangla text is shaped correctly by the browser. */
async function renderIndexPng(docs, startPages) {
  try {
    await document.fonts.load('28px "Noto Sans Bengali"', 'অআ');
  } catch {}
  const W = 1240;
  const H = 1754; // layout units: A4 at 150 dpi
  const SCALE = 2; // drawn at 300 dpi so the text stays sharp when printed
  const c = document.createElement('canvas');
  c.width = W * SCALE;
  c.height = H * SCALE;
  const g = c.getContext('2d');
  g.scale(SCALE, SCALE);
  g.fillStyle = '#fff';
  g.fillRect(0, 0, W, H);
  const F = '"Noto Sans Bengali", "Noto Sans", Arial, sans-serif';
  g.fillStyle = '#0f3354';
  g.font = `bold 46px ${F}`;
  g.fillText('Index  ·  সূচিপত্র', 110, 160);
  g.font = `28px ${F}`;
  g.fillStyle = '#555';
  g.fillText(`${project.reqs.tender.tender_id} — ${project.reqs.tender.title}`, 110, 210);
  let y = 300;
  g.font = `bold 26px ${F}`;
  g.fillStyle = '#555';
  g.fillText('#', 110, y);
  g.fillText('Document / ডকুমেন্ট', 170, y);
  g.textAlign = 'right';
  g.fillText('Pages', 960, y);
  g.fillText('Page / পৃষ্ঠা', 1130, y);
  g.textAlign = 'left';
  y += 18;
  g.fillRect(110, y, 1020, 2);
  // Shrink rows (and their text) only when needed, so long lists never run past the footer band.
  const k = Math.min(1, (H - 140 - y) / Math.max(1, docs.length) / 96);
  y += 50 * k;
  const fs = (px) => `${Math.round(px * k)}px ${F}`;
  docs.forEach((d, i) => {
    const end = startPages[i] + d.file.pages - 1;
    g.fillStyle = '#111';
    g.font = fs(28);
    g.fillText(String(i + 1), 110, y);
    g.fillText(d.req.title_en, 170, y, 680);
    g.fillStyle = '#444';
    g.font = fs(26);
    g.fillText(d.req.title_bn, 170, y + 38 * k, 680);
    g.textAlign = 'right';
    g.fillStyle = '#111';
    g.font = fs(28);
    g.fillText(String(d.file.pages), 960, y);
    g.fillText(startPages[i] === end ? String(startPages[i]) : `${startPages[i]}–${end}`, 1130, y);
    g.textAlign = 'left';
    y += 96 * k;
    g.fillStyle = '#e3e8ee';
    g.fillRect(110, y - 54 * k, 1020, 1);
  });
  const blob = await new Promise((res) => c.toBlob(res, 'image/png'));
  return new Uint8Array(await blob.arrayBuffer());
}

async function generate() {
  if (blockingProblems(project).length || ui.busy) return;
  ui.busy = true;
  render();
  try {
    const docs = includedDocs();
    const opts = {};
    if (project.includeIndex) opts.renderIndex = (startPages) => renderIndexPng(docs, startPages);
    if (project.seal) {
      // We need the total to resolve "all" — compute it up front.
      const total = 1 + (project.includeIndex ? 1 : 0) + docs.reduce((s, d) => s + d.file.pages, 0);
      try {
        opts.seal = {
          png: project.seal.png,
          pos: project.seal.pos,
          size: project.seal.size,
          pageNumbers: parsePageList(project.seal.pages, total),
        };
      } catch {
        notify('error', 'err_bad_pages');
        ui.busy = false;
        return render();
      }
    }
    const { bytes, total } = await buildPackage(project.reqs.tender, docs, opts);
    const name = `${project.reqs.tender.tender_id}_Package.pdf`;
    const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
    ui.output = { url, name, total };
    notify('ok', 'generated', { pages: total });
  } catch (e) {
    console.error(e);
    notify('error', 'err_build', { msg: e.message || String(e) });
  }
  ui.busy = false;
  render();
}

function download(blob, name) {
  const a = document.createElement('a');
  a.href = typeof blob === 'string' ? blob : URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

function exportCsv() {
  const st = allStatuses(project);
  const rows = [['Order', 'Document', 'Document (Bangla)', 'Mandatory', 'File name', 'Pages', 'Expiry date', 'Status', 'Status (Bangla)']];
  for (const r of project.reqs.requirements) {
    const f = project.files.find((x) => x.id === project.matches[r.id]);
    rows.push([
      r.order, r.title_en, r.title_bn, r.mandatory ? 'Yes' : 'No', f?.name || '', f?.pages ?? '',
      r.has_expiry ? project.expiries[r.id] || '' : 'N/A', dict.en[`st_${st[r.id]}`], dict.bn[`st_${st[r.id]}`],
    ]);
  }
  const csv = '﻿' + rows.map((r) => r.map(csvEscape).join(',')).join('\r\n'); // BOM so Excel shows Bangla
  download(new Blob([csv], { type: 'text/csv;charset=utf-8' }), `${project.reqs.tender.tender_id}_Checklist.csv`);
}

async function askAi() {
  const key = document.getElementById('ai-key')?.value.trim();
  if (!key) {
    notify('error', 'ai_need_key');
    return render();
  }
  ui.aiBusy = true;
  ui.aiText = '';
  render();
  try {
    const { default: Anthropic } = await import('@anthropic-ai/sdk');
    const client = new Anthropic({ apiKey: key, dangerouslyAllowBrowser: true });
    const st = allStatuses(project);
    const lines = project.reqs.requirements.map((r) => {
      const f = project.files.find((x) => x.id === project.matches[r.id]);
      return `- ${r.id} ${r.title_en} (${r.mandatory ? 'mandatory' : 'optional'}${r.has_expiry ? ', has expiry' : ''}): status=${st[r.id]}; file=${f ? `${f.name}, ${f.pages} pages, first text: "${(f.textTitle || '').slice(0, 160)}"` : 'none'}; expiry=${project.expiries[r.id] || '-'}`;
    });
    const unused = project.files.filter((f) => !reqOfFile(project.matches, f.id)).map((f) => `${f.name}: "${(f.textTitle || '(no text, maybe a scan)').slice(0, 160)}"`);
    const response = await client.messages.create({
      model: 'claude-opus-5-5',
      max_tokens: 2000,
      output_config: { effort: 'low' },
      system: 'You help office staff check a tender submission package. Be brief, practical and use short bullet points. Answer in ' + (getLang() === 'bn' ? 'Bangla' : 'English') + '.',
      messages: [{
        role: 'user',
        content: `Tender ${project.reqs.tender.tender_id} "${project.reqs.tender.title}", deadline ${project.reqs.tender.submission_deadline}.\nRequirements:\n${lines.join('\n')}\nUploaded but unused files:\n${unused.join('\n') || 'none'}\n\nCheck whether any file seems matched to the wrong document, which unused file could fill a missing document, and anything else to fix before submission.`,
      }],
    });
    if (response.stop_reason === 'refusal') throw new Error('refused');
    ui.aiText = response.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n');
  } catch (e) {
    notify('error', 'ai_failed', { msg: e.message || String(e) });
  }
  ui.aiBusy = false;
  render();
}

// ---------------- Rendering ----------------

const statusClass = { missing: 'bad', expiry_needed: 'warn', expired: 'bad', not_provided: 'muted', ok: 'good' };
const statusIcon = { missing: '✕', expiry_needed: '!', expired: '✕', not_provided: '–', ok: '✓' };

const TABS = ['tender', 'files', 'match', 'package'];

/** SF Symbols-like line icons, inline so they follow currentColor. */
const ICONS = {
  tender: '<path d="M7 3h7l5 5v12a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z"/><path d="M14 3v5h5M9 13h6M9 17h4"/>',
  files: '<path d="M4 7a2 2 0 0 1 2-2h3.6l2 2H18a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2Z"/><path d="M12 10.5v5M9.8 12.7 12 10.5l2.2 2.2"/>',
  match: '<path d="M4 6.5h9M4 12h6M4 17.5h9"/><path d="m15 12 2.2 2.2L21 10"/>',
  package: '<path d="M12 3 20 7.3v9.4L12 21l-8-4.3V7.3Z"/><path d="M4 7.3 12 11.6l8-4.3M12 11.6V21"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.6 9.3a2.5 2.5 0 0 1 4.8.9c0 1.7-2.4 2.1-2.4 3.6"/><path d="M12 17h.01"/>',
  lock: '<rect x="5" y="11" width="14" height="10" rx="2.5"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
  check: '<path d="m5 12.5 4.2 4.2L19 7"/>',
};
const icon = (name, cls = 'ico') => `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`;

/** Shared numbers for the rail, tab bar and step 3 summary. */
function stats() {
  const counts = { block: 0, np: 0, mok: 0, mtotal: 0 };
  if (!project.reqs) return { counts, st: {} };
  const st = allStatuses(project);
  for (const r of project.reqs.requirements) {
    const s = st[r.id];
    if (BLOCKING.has(s)) counts.block++;
    else if (s === STATUS.NOT_PROVIDED) counts.np++;
    if (r.mandatory) {
      counts.mtotal++;
      if (s === STATUS.OK) counts.mok++;
    }
  }
  return { counts, st };
}

/** Per-step state: done flag and a one-line status for the rail. */
function stepInfo() {
  const { counts } = stats();
  const hasReq = !!project.reqs;
  return {
    tender: { done: hasReq, note: hasReq ? esc(project.reqs.tender.tender_id) : t('rail_none') },
    files: { done: project.files.length > 0, note: t('rail_files', { n: project.files.length }) },
    match: {
      done: hasReq && !counts.block,
      bad: hasReq && counts.block > 0,
      note: !hasReq ? '—' : counts.block ? t('rail_block', { n: counts.block }) : t('rail_clear'),
    },
    package: {
      done: !!ui.output,
      note: ui.output ? t('rail_done') : hasReq && !counts.block ? t('rail_ready') : t('rail_waiting'),
    },
    counts,
  };
}

function langSwitch() {
  const l = getLang();
  return `<div class="seg" role="group" aria-label="Language">
    <button class="${l === 'en' ? 'on' : ''}" data-act="lang" data-lang="en" lang="en" aria-pressed="${l === 'en'}">EN</button>
    <button class="${l === 'bn' ? 'on' : ''}" data-act="lang" data-lang="bn" lang="bn" aria-pressed="${l === 'bn'}">বাং</button>
  </div>`;
}

function ring(ok, total) {
  const p = total ? ok / total : 0;
  const C = 2 * Math.PI * 26;
  return `<svg class="ring" viewBox="0 0 64 64" aria-hidden="true">
    <circle cx="32" cy="32" r="26" class="ring-track"/>
    <circle cx="32" cy="32" r="26" class="ring-fill${p === 1 ? ' full' : ''}" stroke-dasharray="${C}" stroke-dashoffset="${C * (1 - p)}"/>
  </svg>`;
}

/** Desktop: sticky side rail with brand, step navigation and live readiness. */
function viewRail() {
  const info = stepInfo();
  const { mok, mtotal } = info.counts;
  return `
  <aside class="rail">
    <div class="rail-brand">${logoMark({ className: 'brand-mark', size: 40 })}<span>${t('app_title')}</span></div>
    <nav class="steps" aria-label="${t('steps_nav')}">
      ${TABS.map((k, i) => {
        const s = info[k];
        return `<button class="step${ui.tab === k ? ' on' : ''}${s.done ? ' done' : ''}${s.bad ? ' bad' : ''}" data-act="tab" data-tab="${k}">
          <span class="step-dot">${s.done ? icon('check') : num(i + 1)}</span>
          <span class="step-txt"><b>${t(`tab_${k}`)}</b><small>${s.note}</small></span>
        </button>`;
      }).join('')}
    </nav>
    <div class="ready-card">
      <div class="ring-wrap">${ring(mok, mtotal)}<span class="ring-num">${num(mok)}<i>/${num(mtotal)}</i></span></div>
      <p>${t('readiness')}</p>
    </div>
    <div class="rail-foot">
      ${langSwitch()}
      <button class="icon-btn" data-act="help" aria-expanded="${ui.showHelp}" aria-label="${t('help')}" title="${t('help')}">${icon('help')}</button>
    </div>
  </aside>`;
}

/** Phones/tablets: iOS navigation bar (compact title appears once the large title scrolls away). */
function viewMobileTop() {
  const i = TABS.indexOf(ui.tab);
  return `
  <header class="mtop">
    <div class="mbar">
      ${logoMark({ className: 'mbar-mark', size: 30 })}
      <span class="mbar-title">${t(`tab_${ui.tab}`)}</span>
      <div class="mbar-actions">
        <button class="icon-btn" data-act="help" aria-expanded="${ui.showHelp}" aria-label="${t('help')}">${icon('help')}</button>
        ${langSwitch()}
      </div>
    </div>
  </header>
  <div class="mlarge">
    <p class="eyebrow">${t('step_of', { n: i + 1 })}</p>
    <h1 class="large-title">${t(`tab_${ui.tab}`)}</h1>
  </div>`;
}

/** Desktop hero above the steps. */
function viewHero() {
  return `
  <header class="hero">
    <p class="eyebrow">${t('app_title')} · AI DevFest 2026</p>
    <h1>${t('hero_a')} <em>${t('hero_b')}</em></h1>
    <p class="hero-sub">${t('app_sub')}</p>
    <p class="privacy">${icon('lock')} ${t('privacy')}</p>
  </header>`;
}

function viewHelp() {
  return ui.showHelp ? `<ol class="help">${t('help_steps').map((s) => `<li>${esc(s)}</li>`).join('')}</ol>` : '';
}

/** Phones/tablets: floating glass tab bar. */
function viewTabbar() {
  const info = stepInfo();
  const i = TABS.indexOf(ui.tab);
  const from = ui.tabFrom ?? i; // the active pill slides only right after a tab switch
  const badge = {
    files: project.files.length ? `<span class="tb-badge">${num(project.files.length)}</span>` : '',
    match: info.match.bad ? `<span class="tb-badge bad">${num(info.counts.block)}</span>` : '',
    package: info.match.done ? '<span class="tb-dot"></span>' : '',
  };
  return `
  <nav class="tabbar" aria-label="${t('steps_nav')}" style="--i:${i};--from:${from}">
    <span class="tb-pill${from !== i ? ' slide' : ''}" aria-hidden="true"></span>
    ${TABS.map((k) => `<button class="tb${ui.tab === k ? ' on' : ''}" data-act="tab" data-tab="${k}" aria-current="${ui.tab === k ? 'page' : 'false'}">
      <span class="tb-ico">${icon(k)}${badge[k] || ''}</span><span class="tb-lbl">${t(`tab_${k}`)}</span>
    </button>`).join('')}
  </nav>`;
}

/** Section header: big step numeral, eyebrow, title, optional actions. */
function secHead(n, actions = '') {
  const [step, title] = t(`step${n}`).split(' · ');
  return `<div class="sec-head">
    <div class="sec-titles"><span class="sec-num">0${n}</span><div><p class="eyebrow">${step}</p><h2>${title || step}</h2></div></div>
    ${actions ? `<div class="row sec-actions">${actions}</div>` : ''}
  </div>`;
}
const secAttrs = (k) => `class="card sec${ui.tab === k ? ' on' : ''}" data-sec="${k}" id="sec-${k}"`;

/** Shown on phones when a later step is opened before requirements exist. */
function viewNeedReq(k, n) {
  return `<section ${secAttrs(k)} data-only-m>
    ${secHead(n)}
    <div class="empty-state">${icon('tender', 'ico lg')}<p>${t('need_req')}</p>
      <button class="btn primary" data-act="tab" data-tab="tender">${t('go_tender')}</button></div>
  </section>`;
}

function viewNotices() {
  if (!ui.notices.length) return '';
  return `<div class="notices" role="status" aria-live="polite">${ui.notices
    .map((n) => `<div class="notice ${n.kind}"><span>${esc(t(n.key, n.vars))}</span><button class="x" data-act="dismiss" data-id="${n.id}" aria-label="${t('close')}">×</button></div>`)
    .join('')}</div>`;
}

function viewTender() {
  const r = project.reqs;
  const body = r
    ? `<dl class="tender">
        <div><dt>${t('tender_id')}</dt><dd>${esc(r.tender.tender_id)}</dd></div>
        <div><dt>${t('tender_title')}</dt><dd>${esc(r.tender.title)}</dd></div>
        <div><dt>${t('procuring_entity')}</dt><dd>${esc(r.tender.procuring_entity)}</dd></div>
        <div><dt>${t('bidder')}</dt><dd>${esc(r.tender.bidder)}</dd></div>
        <div><dt>${t('deadline')}</dt><dd><strong>${esc(r.tender.submission_deadline)}</strong></dd></div>
      </dl>
      <p class="muted-text">${t('req_count', { n: r.requirements.length, m: r.requirements.filter((x) => x.mandatory).length })}</p>`
    : `<p class="empty">${t('no_req')}</p>`;
  return `
  <section ${secAttrs('tender')}>
    ${secHead(1)}
    <div class="row wrap">
      <label class="btn primary">📄 ${t('open_req')}<input type="file" accept=".json,application/json" data-in="req" hidden></label>
      <button class="btn" data-act="sample" ${ui.busy ? 'disabled' : ''}>🧪 ${t('load_sample')}</button>
    </div>
    ${body}
  </section>`;
}

function viewFiles() {
  const dups = duplicateGroups(project.files);
  const nameOf = (id) => project.files.find((f) => f.id === id)?.name;
  const rows = project.files
    .map((f) => {
      const reqId = reqOfFile(project.matches, f.id);
      const req = project.reqs?.requirements.find((r) => r.id === reqId);
      const thumb = ui.thumbs[f.id] && ui.thumbs[f.id] !== 'x' ? ui.thumbs[f.id] : '';
      return `<tr class="${dups[f.id] ? 'dup-row' : ''}" draggable="true" data-file="${f.id}" title="${esc(t('drag_hint'))}">
        <td class="thumb c-thumb"><img data-thumb="${f.id}" src="${thumb}" alt="" ${thumb ? '' : 'class="blank"'}></td>
        <td class="c-name">
          <div class="fname">${esc(f.name)}</div>
          <div class="meta">${fmtSize(f.size)}<span class="m-only"> · ${num(f.pages)} ${t('pages')}</span></div>
          ${dups[f.id] ? `<div class="badge warn">⧉ ${t('duplicate')}</div> <span class="dupnote">${esc(t('duplicate_of', { names: dups[f.id].map(nameOf).join(', ') }))}</span>` : ''}
        </td>
        <td class="num c-pages">${num(f.pages)}</td>
        <td class="c-match">${req ? `<span class="badge good">${esc(reqTitle(req))}</span>` : `<span class="muted-text">${t('not_matched')}</span>`}</td>
        <td class="actions c-act">
          <button class="small" data-act="preview" data-id="${f.id}">👁 ${t('preview')}</button>
          <button class="small danger" data-act="remove" data-id="${f.id}">🗑 ${t('remove')}</button>
        </td>
      </tr>`;
    })
    .join('');
  return `
  <section ${secAttrs('files')}>
    ${secHead(2)}
    <label class="drop" data-drop>
      <span class="drop-ico">${icon('files', 'ico lg')}</span>
      <span class="drop-txt">${t('drop_here')}</span>
      <span class="btn primary">${t('choose_files')}</span>
      <input type="file" multiple accept="application/pdf,.pdf" data-in="files" hidden>
      <small>${t('limits', { files: MAX_FILES, mb: MAX_MB })}</small>
    </label>
    ${ui.busy ? `<p class="loading">⏳ ${t('loading')}</p>` : ''}
    ${project.files.length
      ? `<div class="table-wrap"><table class="files">
          <thead><tr><th></th><th>${t('file_name')}</th><th class="num">${t('pages')}</th><th>${t('matched_to')}</th><th></th></tr></thead>
          <tbody>${rows}</tbody></table></div>
         <button class="small ghost" data-act="remove-all">${t('remove_all')}</button>`
      : `<p class="empty">${t('no_files')}</p>`}
  </section>`;
}

function fileOptions(req) {
  const dups = duplicateGroups(project.files);
  const current = project.matches[req.id];
  const opts = [`<option value="">${t('choose_file')}</option>`];
  for (const f of project.files) {
    const usedBy = reqOfFile(project.matches, f.id);
    const conflict = canMatch(project, req.id, f.id);
    let label = `${f.name} · ${num(f.pages)} ${t('pages')}`;
    if (dups[f.id]) label += ` · ${t('duplicate')}`;
    if (usedBy && usedBy !== req.id) {
      const other = project.reqs.requirements.find((r) => r.id === usedBy);
      label += ` (→ ${reqTitle(other)})`;
    }
    opts.push(`<option value="${f.id}" ${f.id === current ? 'selected' : ''} ${conflict ? 'disabled' : ''}>${esc(label)}</option>`);
  }
  return opts.join('');
}

/** Unmatched files as draggable chips, kept in view above the requirement rows. */
function viewFileTray() {
  if (!project.files.length) return '';
  const dups = duplicateGroups(project.files);
  const free = project.files.filter((f) => !reqOfFile(project.matches, f.id));
  const chips = free
    .map((f) => `<span class="chip${dups[f.id] ? ' dup' : ''}" draggable="true" data-file="${f.id}" title="${esc(t('drag_hint'))}">⠿ ${esc(f.name)} · ${num(f.pages)} ${t('pages')}</span>`)
    .join('');
  return `<div class="file-tray">
    <p class="muted-text drag-tip">${t('drag_tip')}</p>
    ${free.length ? `<div class="chips">${chips}</div>` : `<p class="muted-text">${t('all_files_used')}</p>`}
  </div>`;
}

function viewRequirements() {
  if (!project.reqs) return viewNeedReq('match', 3);
  const { st, counts } = stats();
  const deadline = project.reqs.tender.submission_deadline;
  const rows = project.reqs.requirements
    .map((r) => {
      const s = st[r.id];
      const fileId = project.matches[r.id];
      const file = project.files.find((f) => f.id === fileId);
      let expiryCell = `<span class="muted-text">${t('expiry_na')}</span>`;
      if (r.has_expiry) {
        expiryCell = fileId
          ? `<input type="date" data-in="expiry" data-req="${r.id}" value="${esc(project.expiries[r.id] || '')}" aria-label="${t('expiry')}">`
          : `<span class="muted-text">—</span>`;
        if (fileId && file?.detectedExpiry && file.detectedExpiry !== project.expiries[r.id]) {
          expiryCell += `<div class="hint">${t('detected', { date: esc(file.detectedExpiry) })} <button class="link" data-act="use-expiry" data-req="${r.id}" data-date="${esc(file.detectedExpiry)}">${t('use_it')}</button></div>`;
        }
      }
      const why = s === STATUS.EXPIRED ? t('why_expired', { date: project.expiries[r.id], deadline }) : '';
      return `<tr class="st-${s}" data-req-drop="${r.id}">
        <td class="num c-order">${num(r.order)}</td>
        <td class="c-doc">
          <div class="rtitle">${esc(reqTitle(r))}</div>
          <div class="meta">${esc(getLang() === 'bn' ? r.title_en : r.title_bn)}</div>
          <span class="tag ${r.mandatory ? 'm' : 'o'}">${r.mandatory ? t('mandatory') : t('optional')}</span>
        </td>
        <td class="c-file">
          <select data-in="match" data-req="${r.id}" aria-label="${t('file')}">${fileOptions(r)}</select>
          ${fileId ? `<button class="link" data-act="unmatch" data-req="${r.id}">↺ ${t('unmatch')}</button>` : ''}
        </td>
        <td class="c-exp"${r.has_expiry ? '' : ' data-na'}>${expiryCell}</td>
        <td class="c-status"><span class="badge ${statusClass[s]}">${statusIcon[s]} ${t(`st_${s}`)}</span>${why ? `<div class="why">${esc(why)}</div>` : ''}</td>
      </tr>`;
    })
    .join('');
  return `
  <section ${secAttrs('match')}>
    ${secHead(3, `
        <button class="btn" data-act="undo" ${ui.history.length ? '' : 'disabled'} title="Ctrl/⌘ + Z">↶ ${t('undo')}</button>
        <button class="btn primary" data-act="auto" ${project.files.length ? '' : 'disabled'}>✨ ${t('auto_match')}</button>`)}
    <p class="summary ${counts.block ? 'has-block' : 'all-clear'}">${t('summary', counts)}</p>
    ${viewFileTray()}
    <div class="table-wrap"><table class="reqs">
      <thead><tr><th class="num">${t('order')}</th><th>${t('document')}</th><th>${t('file')}</th><th>${t('expiry')}</th><th>${t('status')}</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>
  </section>`;
}

function viewGenerate() {
  if (!project.reqs) return viewNeedReq('package', 4);
  const problems = blockingProblems(project);
  const deadline = project.reqs.tender.submission_deadline;
  const why = (p) =>
    p.status === STATUS.EXPIRED
      ? t('why_expired', { date: project.expiries[p.req.id], deadline })
      : t(`why_${p.status}`);
  const seal = project.seal;
  const positions = ['bottom_right', 'bottom_left', 'bottom_center', 'top_right', 'top_left'];
  return `
  <section ${secAttrs('package')}>
    ${secHead(4)}
    ${problems.length
      ? `<div class="blocked"><strong>⛔ ${t('blocked_title')}</strong><ul>${problems
          .map((p) => `<li><b>${esc(reqTitle(p.req))}</b> — ${t(`st_${p.status}`)}: ${esc(why(p))}</li>`)
          .join('')}</ul></div>`
      : `<div class="ready">✅ ${t('ready')}</div>`}
    <label class="check"><input type="checkbox" data-in="index" ${project.includeIndex ? 'checked' : ''}> ${t('include_index')}</label>
    <details class="seal" ${seal ? 'open' : ''}>
      <summary>🖋 ${t('seal_title')}</summary>
      <div class="row wrap">
        <label class="btn small">${t('seal_upload')}<input type="file" accept="image/png" data-in="seal" hidden></label>
        ${seal
          ? `<img class="seal-prev" src="${seal.dataUrl}" alt="">
             <label>${t('seal_pages')} <input type="text" data-in="seal-pages" value="${esc(seal.pages)}" size="10"></label>
             <label>${t('seal_pos')} <select data-in="seal-pos">${positions.map((p) => `<option value="${p.replace('_', '-')}" ${seal.pos === p.replace('_', '-') ? 'selected' : ''}>${t(`pos_${p}`)}</option>`).join('')}</select></label>
             <label>${t('seal_size')} <input type="number" min="30" max="300" data-in="seal-size" value="${seal.size}"></label>
             <button class="small danger" data-act="seal-remove">${t('seal_remove')}</button>`
          : ''}
      </div>
    </details>
    <div class="row gen">
      <button class="btn primary big" data-act="generate" ${problems.length || ui.busy ? 'disabled' : ''} title="${problems.length ? esc(t('blocked_title')) : ''}">
        ${ui.busy ? `⏳ ${t('generating')}` : `📦 ${t('generate')}`}
      </button>
      ${ui.output ? `<a class="btn success big" href="${ui.output.url}" download="${esc(ui.output.name)}">⬇️ ${t('download', { name: esc(ui.output.name) })}</a>` : ''}
    </div>
    ${ui.output ? `<iframe class="pdf-preview" src="${ui.output.url}" title="${esc(ui.output.name)}"></iframe>` : ''}
    <hr>
    <div class="row wrap">
      <button class="btn" data-act="csv">📊 ${t('export_csv')}</button>
      <button class="btn" data-act="save">💾 ${t('save_project')}</button>
      <label class="btn">📂 ${t('open_project')}<input type="file" accept=".json,application/json" data-in="project" hidden></label>
      <button class="btn danger" data-act="reset">${t('start_over')}</button>
    </div>
    <p class="muted-text">${t('autosave')}</p>
  </section>
  <section class="card sec ai${ui.tab === 'package' ? ' on' : ''}" data-sec="package">
    <details>
      <summary>🤖 ${t('ai_title')}</summary>
      <p class="muted-text">${t('ai_note')}</p>
      <div class="row wrap">
        <input type="password" id="ai-key" placeholder="sk-ant-…" autocomplete="off" aria-label="${t('ai_key')}" value="${esc(sessionKey())}">
        <button class="btn" data-act="ai" ${ui.aiBusy ? 'disabled' : ''}>${ui.aiBusy ? t('ai_thinking') : t('ai_ask')}</button>
        ${sessionKey() ? `<button class="btn danger" data-act="ai-clear">${t('ai_clear')}</button>` : ''}
      </div>
      <small class="muted-text">${t('ai_key')}</small>
      ${ui.aiText ? `<pre class="ai-out">${esc(ui.aiText)}</pre>` : ''}
    </details>
  </section>`;
}

function sessionKey() {
  try {
    return localStorage.getItem('tpb_ai_key') || '';
  } catch {
    return '';
  }
}

function viewPreview() {
  if (!ui.preview) return '';
  return `<div class="modal" data-act="close-preview"><div class="modal-box">
    <button class="btn small" data-act="close-preview">✕ ${t('close')}</button>
    <iframe src="${ui.preview}" title="${t('preview')}"></iframe></div></div>`;
}

function render() {
  document.documentElement.lang = getLang();
  document.title = t('app_title');
  const scroll = window.scrollY;
  $app.dataset.tab = ui.tab;
  $app.innerHTML = `<div class="shell">${viewRail()}
    <div class="main">${viewMobileTop()}${viewHero()}${viewHelp()}
      ${viewTender()}${viewFiles()}${viewRequirements()}${viewGenerate()}
      <footer class="site-foot">
        <div class="foot-brand">${logoMark({ className: 'foot-mark', size: 22 })} <span>${t('app_title')}</span></div>
        <p class="foot-note">${t('footer')}</p>
      </footer>
    </div></div>${viewTabbar()}${viewNotices()}${viewPreview()}`;
  window.scrollTo(0, scroll);
  syncStickyTop();
  onScroll();
  if (ui.tabFrom != null) {
    ui.tabFrom = null;
    $app.classList.add('tab-enter');
    clearTimeout(tabEnterTimer);
    tabEnterTimer = setTimeout(() => $app.classList.remove('tab-enter'), 600);
  }
}
let tabEnterTimer;

const isDesktop = () => window.matchMedia('(min-width: 900px)').matches;

/** Keep sticky elements (the file tray) just below the mobile nav bar, whatever its height. */
function syncStickyTop() {
  const bar = $app.querySelector('.mtop');
  const h = bar && bar.offsetParent !== null ? bar.offsetHeight : 0;
  document.documentElement.style.setProperty('--sticky-top', `${Math.ceil(h + 8)}px`);
}
window.addEventListener('resize', syncStickyTop);

/** iOS nav bar collapse on phones; scroll-spy of the step rail on desktop (no re-render). */
function onScroll() {
  const large = $app.querySelector('.mlarge');
  $app.querySelector('.mtop')?.classList.toggle('scrolled', !!large && large.getBoundingClientRect().bottom < 60);
  if (!isDesktop()) return;
  let cur = 'tender';
  for (const k of TABS) {
    const sec = document.getElementById(`sec-${k}`);
    if (sec && sec.offsetParent !== null && sec.getBoundingClientRect().top < window.innerHeight * 0.35) cur = k;
  }
  if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4) {
    cur = [...TABS].reverse().find((k) => document.getElementById(`sec-${k}`)?.offsetParent) || cur;
  }
  if (cur === ui.tab) return;
  ui.tab = cur;
  $app.dataset.tab = cur;
  $app.querySelectorAll('.rail .step').forEach((b) => b.classList.toggle('on', b.dataset.tab === cur));
}
window.addEventListener('scroll', onScroll, { passive: true });

function openTab(k) {
  if (!TABS.includes(k)) return;
  if (k !== ui.tab && !isDesktop()) ui.tabFrom = TABS.indexOf(ui.tab);
  ui.tab = k;
  if (isDesktop()) {
    $app.querySelectorAll('.rail .step').forEach((b) => b.classList.toggle('on', b.dataset.tab === k));
    document.getElementById(`sec-${k}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    return;
  }
  render();
  window.scrollTo(0, 0);
}

// ---------------- Events (delegated) ----------------

$app.addEventListener('click', (e) => {
  const el = e.target.closest('[data-act]');
  if (!el) return;
  const act = el.dataset.act;
  const id = el.dataset.id;
  switch (act) {
    case 'lang':
      setLang(el.dataset.lang || (getLang() === 'en' ? 'bn' : 'en'));
      return render();
    case 'tab':
      return openTab(el.dataset.tab);
    case 'help':
      ui.showHelp = !ui.showHelp;
      return render();
    case 'dismiss':
      ui.notices = ui.notices.filter((n) => n.id !== id);
      return render();
    case 'sample':
      return loadSamplePack();
    case 'remove':
      return removeFile(id);
    case 'remove-all':
      return askConfirm(t('confirm_remove_all', { n: project.files.length }), t('remove_all')).then((ok) => {
        if (!ok) return;
        project.files = [];
        project.matches = {};
        project.expiries = {};
        ui.thumbs = {};
        ui.history = [];
        changed();
      });
    case 'preview': {
      const f = project.files.find((x) => x.id === id);
      if (!f) return;
      ui.preview = URL.createObjectURL(new Blob([f.buf], { type: 'application/pdf' }));
      return render();
    }
    case 'close-preview':
      if (el.classList.contains('modal') && e.target !== el) return; // clicks inside the box
      if (ui.preview) URL.revokeObjectURL(ui.preview);
      ui.preview = null;
      return render();
    case 'unmatch':
      return setMatch(el.dataset.req, '');
    case 'use-expiry':
      remember();
      project.expiries = { ...project.expiries, [el.dataset.req]: el.dataset.date };
      return changed();
    case 'auto':
      return autoMatch();
    case 'undo':
      return undo();
    case 'generate':
      return generate();
    case 'csv':
      return exportCsv();
    case 'save':
      return download(exportProjectFile(project), `${project.reqs?.tender.tender_id || 'tender'}_project.json`);
    case 'seal-remove':
      project.seal = null;
      return changed();
    case 'reset':
      return askConfirm(t('confirm_reset'), t('start_over')).then((ok) => {
        if (!ok) return;
        project = emptyProject();
        ui.notices = [];
        ui.thumbs = {};
        ui.history = [];
        clearProject();
        changed();
      });
    case 'ai':
      return askAi();
    case 'ai-clear':
      try {
        localStorage.removeItem('tpb_ai_key');
      } catch {}
      ui.aiText = '';
      notify('ok', 'ai_cleared');
      return render();
  }
});

$app.addEventListener('change', async (e) => {
  const el = e.target;
  const kind = el.dataset.in;
  if (!kind) return;
  if (kind === 'req' && el.files[0]) {
    loadRequirementsJson(await el.files[0].text());
  } else if (kind === 'files' && el.files.length) {
    await addFiles([...el.files]);
  } else if (kind === 'match') {
    setMatch(el.dataset.req, el.value);
  } else if (kind === 'expiry') {
    const v = el.value;
    remember();
    const exp = { ...project.expiries };
    if (v) exp[el.dataset.req] = v;
    else delete exp[el.dataset.req];
    project.expiries = exp;
    changed();
  } else if (kind === 'index') {
    project.includeIndex = el.checked;
    changed();
  } else if (kind === 'seal' && el.files[0]) {
    const buf = await el.files[0].arrayBuffer();
    const sig = new Uint8Array(buf.slice(0, 8));
    if (!(sig[0] === 0x89 && sig[1] === 0x50 && sig[2] === 0x4e && sig[3] === 0x47)) {
      notify('error', 'err_seal');
      return render();
    }
    const dataUrl = await new Promise((res) => {
      const r = new FileReader();
      r.onload = () => res(r.result);
      r.readAsDataURL(el.files[0]);
    });
    project.seal = { png: buf, dataUrl, pages: 'all', pos: 'bottom-right', size: 90, ...(project.seal ? { pages: project.seal.pages, pos: project.seal.pos, size: project.seal.size } : {}) };
    changed();
  } else if (kind === 'seal-pages') {
    project.seal.pages = el.value;
    changed();
  } else if (kind === 'seal-pos') {
    project.seal.pos = el.value;
    changed();
  } else if (kind === 'seal-size') {
    project.seal.size = Math.min(300, Math.max(30, Number(el.value) || 90));
    changed();
  } else if (kind === 'project' && el.files[0]) {
    try {
      project = importProjectFile(await el.files[0].text());
      ui.thumbs = {};
      ui.history = [];
      changed();
      loadThumbs();
    } catch {
      notify('error', 'err_project');
      render();
    }
  }
});

$app.addEventListener('input', (e) => {
  if (e.target.id === 'ai-key') {
    try {
      localStorage.setItem('tpb_ai_key', e.target.value.trim());
    } catch {}
  }
});

// Drag & drop: PDFs from the computer onto the drop zone, or an uploaded file row onto a requirement row.
const FILE_MIME = 'application/x-tpb-file';
const isFileRowDrag = (e) => e.dataTransfer?.types.includes(FILE_MIME);
$app.addEventListener('dragstart', (e) => {
  const row = e.target.closest?.('[data-file]');
  if (!row) return;
  e.dataTransfer.setData(FILE_MIME, row.dataset.file);
  e.dataTransfer.effectAllowed = 'link';
  document.body.classList.add('dragging-file');
});
$app.addEventListener('dragend', () => document.body.classList.remove('dragging-file'));
$app.addEventListener('dragover', (e) => {
  const target = isFileRowDrag(e) ? e.target.closest('[data-req-drop]') : e.target.closest('[data-drop]');
  if (!target) return;
  e.preventDefault();
  target.classList.add('over');
});
$app.addEventListener('dragleave', (e) => {
  const z = e.target.closest('[data-drop], [data-req-drop]');
  if (z && !z.contains(e.relatedTarget)) z.classList.remove('over');
});
$app.addEventListener('drop', (e) => {
  document.body.classList.remove('dragging-file');
  if (isFileRowDrag(e)) {
    const row = e.target.closest('[data-req-drop]');
    if (!row) return;
    e.preventDefault();
    row.classList.remove('over');
    return setMatch(row.dataset.reqDrop, e.dataTransfer.getData(FILE_MIME));
  }
  const z = e.target.closest('[data-drop]');
  if (!z) return;
  e.preventDefault();
  z.classList.remove('over');
  addFiles([...e.dataTransfer.files]);
});
// Don't let a missed drop open the PDF in the tab and lose work.
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => e.preventDefault());
document.addEventListener('keydown', (e) => {
  // Ctrl/Cmd+Z undoes the last match change, but never steals undo from a text field.
  if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'z' && !e.target.closest('input, textarea, select')) {
    if (ui.history.length) {
      e.preventDefault();
      undo();
    }
    return;
  }
  if (e.key === 'Escape' && ui.preview) {
    URL.revokeObjectURL(ui.preview);
    ui.preview = null;
    render();
  }
});

// ---------------- Boot ----------------
setLang(getLang());
render();
loadProject().then((saved) => {
  if (saved && (saved.reqs || saved.files?.length)) {
    project = { ...emptyProject(), ...saved };
    render();
    loadThumbs();
  }
});
// Expose for automated checks (screenshots/output generation); harmless for users.
window.__tpb = { get project() { return project; }, get ui() { return ui; } };
