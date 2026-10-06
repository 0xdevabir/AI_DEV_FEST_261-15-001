import './style.css';
import { t, setLang, getLang, reqTitle, num, dict } from './i18n.js';
import {
  STATUS, BLOCKING, parseRequirements, allStatuses, blockingProblems, duplicateGroups,
  reqOfFile, canMatch, applyMatch, suggestMatches, parsePageList, csvEscape,
} from './logic.js';
import { sha256, looksLikePdf, inspectPdf, thumbnail, buildPackage } from './pdf.js';
import { saveProject, loadProject, clearProject, exportProjectFile, importProjectFile } from './storage.js';

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
};

const $app = document.getElementById('app');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const uid = () => Math.random().toString(36).slice(2, 10);
const fmtSize = (b) => (b > 1048576 ? `${num((b / 1048576).toFixed(1))} MB` : `${num(Math.max(1, Math.round(b / 1024)))} KB`);

function notify(kind, key, vars = {}) {
  ui.notices.push({ kind, key, vars, id: uid() });
  if (ui.notices.length > 6) ui.notices.shift();
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
  try {
    const r = applyMatch(project, reqId, fileId);
    project.matches = r.matches;
    project.expiries = r.expiries;
  } catch (e) {
    notify('error', `err_${e.message}`);
  }
  changed();
}

function removeFile(fileId) {
  const f = project.files.find((x) => x.id === fileId);
  if (!f || !confirm(t('confirm_remove', { name: f.name }))) return;
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
  const H = 1754; // A4 at 150 dpi
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d');
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
  y += 50;
  docs.forEach((d, i) => {
    const end = startPages[i] + d.file.pages - 1;
    g.fillStyle = '#111';
    g.font = `28px ${F}`;
    g.fillText(String(i + 1), 110, y);
    g.fillText(d.req.title_en, 170, y, 680);
    g.fillStyle = '#444';
    g.font = `26px ${F}`;
    g.fillText(d.req.title_bn, 170, y + 38, 680);
    g.textAlign = 'right';
    g.fillStyle = '#111';
    g.font = `28px ${F}`;
    g.fillText(String(d.file.pages), 960, y);
    g.fillText(startPages[i] === end ? String(startPages[i]) : `${startPages[i]}–${end}`, 1130, y);
    g.textAlign = 'left';
    y += 96;
    g.fillStyle = '#e3e8ee';
    g.fillRect(110, y - 54, 1020, 1);
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

function viewHeader() {
  return `
  <header class="top">
    <div>
      <h1>${t('app_title')}</h1>
      <p class="sub">${t('app_sub')}</p>
    </div>
    <div class="top-actions">
      <button class="ghost" data-act="help" aria-expanded="${ui.showHelp}">❓ ${t('help')}</button>
      <button class="lang" data-act="lang" lang="${getLang() === 'en' ? 'bn' : 'en'}">🌐 ${t('lang_switch')}</button>
    </div>
  </header>
  ${ui.showHelp ? `<ol class="help">${t('help_steps').map((s) => `<li>${esc(s)}</li>`).join('')}</ol>` : ''}
  <p class="privacy">🔒 ${t('privacy')}</p>`;
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
  <section class="card">
    <h2>${t('step1')}</h2>
    <div class="row">
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
      return `<tr class="${dups[f.id] ? 'dup-row' : ''}">
        <td class="thumb"><img data-thumb="${f.id}" src="${thumb}" alt="" ${thumb ? '' : 'class="blank"'}></td>
        <td>
          <div class="fname">${esc(f.name)}</div>
          <div class="meta">${fmtSize(f.size)}</div>
          ${dups[f.id] ? `<div class="badge warn">⧉ ${t('duplicate')}</div> <span class="dupnote">${esc(t('duplicate_of', { names: dups[f.id].map(nameOf).join(', ') }))}</span>` : ''}
        </td>
        <td class="num">${num(f.pages)}</td>
        <td>${req ? `<span class="badge good">${esc(reqTitle(req))}</span>` : `<span class="muted-text">${t('not_matched')}</span>`}</td>
        <td class="actions">
          <button class="small" data-act="preview" data-id="${f.id}">👁 ${t('preview')}</button>
          <button class="small danger" data-act="remove" data-id="${f.id}">🗑 ${t('remove')}</button>
        </td>
      </tr>`;
    })
    .join('');
  return `
  <section class="card">
    <h2>${t('step2')}</h2>
    <label class="drop" data-drop>
      <span>⬆️ ${t('drop_here')}</span>
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

function viewRequirements() {
  if (!project.reqs) return '';
  const st = allStatuses(project);
  const deadline = project.reqs.tender.submission_deadline;
  const counts = { ok: 0, block: 0, np: 0 };
  for (const s of Object.values(st)) {
    if (s === STATUS.OK) counts.ok++;
    else if (s === STATUS.NOT_PROVIDED) counts.np++;
    else counts.block++;
  }
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
      return `<tr class="st-${s}">
        <td class="num">${num(r.order)}</td>
        <td>
          <div class="rtitle">${esc(reqTitle(r))}</div>
          <div class="meta">${esc(getLang() === 'bn' ? r.title_en : r.title_bn)}</div>
          <span class="tag ${r.mandatory ? 'm' : 'o'}">${r.mandatory ? t('mandatory') : t('optional')}</span>
        </td>
        <td>
          <select data-in="match" data-req="${r.id}" aria-label="${t('file')}">${fileOptions(r)}</select>
          ${fileId ? `<button class="link" data-act="unmatch" data-req="${r.id}">↺ ${t('unmatch')}</button>` : ''}
        </td>
        <td>${expiryCell}</td>
        <td><span class="badge ${statusClass[s]}">${statusIcon[s]} ${t(`st_${s}`)}</span>${why ? `<div class="why">${esc(why)}</div>` : ''}</td>
      </tr>`;
    })
    .join('');
  return `
  <section class="card">
    <div class="card-head">
      <h2>${t('step3')}</h2>
      <button class="btn" data-act="auto" ${project.files.length ? '' : 'disabled'}>✨ ${t('auto_match')}</button>
    </div>
    <p class="summary">${t('summary', counts)}</p>
    <div class="table-wrap"><table class="reqs">
      <thead><tr><th class="num">${t('order')}</th><th>${t('document')}</th><th>${t('file')}</th><th>${t('expiry')}</th><th>${t('status')}</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>
  </section>`;
}

function viewGenerate() {
  if (!project.reqs) return '';
  const problems = blockingProblems(project);
  const deadline = project.reqs.tender.submission_deadline;
  const why = (p) =>
    p.status === STATUS.EXPIRED
      ? t('why_expired', { date: project.expiries[p.req.id], deadline })
      : t(`why_${p.status}`);
  const seal = project.seal;
  const positions = ['bottom_right', 'bottom_left', 'bottom_center', 'top_right', 'top_left'];
  return `
  <section class="card">
    <h2>${t('step4')}</h2>
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
  <section class="card">
    <details>
      <summary>🤖 ${t('ai_title')}</summary>
      <p class="muted-text">${t('ai_note')}</p>
      <div class="row wrap">
        <input type="password" id="ai-key" placeholder="sk-ant-…" autocomplete="off" aria-label="${t('ai_key')}" value="${esc(sessionKey())}">
        <button class="btn" data-act="ai" ${ui.aiBusy ? 'disabled' : ''}>${ui.aiBusy ? t('ai_thinking') : t('ai_ask')}</button>
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
  $app.innerHTML = `${viewHeader()}${viewNotices()}${viewTender()}${viewFiles()}${viewRequirements()}${viewGenerate()}
    <footer>${t('footer')}</footer>${viewPreview()}`;
  window.scrollTo(0, scroll);
}

// ---------------- Events (delegated) ----------------

$app.addEventListener('click', (e) => {
  const el = e.target.closest('[data-act]');
  if (!el) return;
  const act = el.dataset.act;
  const id = el.dataset.id;
  switch (act) {
    case 'lang':
      setLang(getLang() === 'en' ? 'bn' : 'en');
      return render();
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
      if (!confirm(t('confirm_reset'))) return;
      project.files = [];
      project.matches = {};
      project.expiries = {};
      ui.thumbs = {};
      return changed();
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
      project.expiries = { ...project.expiries, [el.dataset.req]: el.dataset.date };
      return changed();
    case 'auto':
      return autoMatch();
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
      if (!confirm(t('confirm_reset'))) return;
      project = emptyProject();
      ui.notices = [];
      ui.thumbs = {};
      clearProject();
      return changed();
    case 'ai':
      return askAi();
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

// Drag & drop anywhere on the drop zone
$app.addEventListener('dragover', (e) => {
  const z = e.target.closest('[data-drop]');
  if (!z) return;
  e.preventDefault();
  z.classList.add('over');
});
$app.addEventListener('dragleave', (e) => e.target.closest('[data-drop]')?.classList.remove('over'));
$app.addEventListener('drop', (e) => {
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
