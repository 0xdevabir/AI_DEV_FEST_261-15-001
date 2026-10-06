// Pure business logic: no DOM, no PDF libraries. Unit-tested in tests/logic.test.js.

export const STATUS = {
  MISSING: 'missing',
  EXPIRY_NEEDED: 'expiry_needed',
  EXPIRED: 'expired',
  NOT_PROVIDED: 'not_provided',
  OK: 'ok',
};

export const BLOCKING = new Set([STATUS.MISSING, STATUS.EXPIRY_NEEDED, STATUS.EXPIRED]);

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Validate and normalise a parsed requirements.json. Throws Error(code) on bad input. */
export function parseRequirements(json) {
  if (!json || typeof json !== 'object') throw new Error('req_invalid');
  const t = json.tender;
  if (!t || typeof t !== 'object') throw new Error('req_no_tender');
  if (!Array.isArray(json.requirements) || json.requirements.length === 0) throw new Error('req_no_list');
  const deadline = String(t.submission_deadline ?? '').trim();
  if (!DATE_RE.test(deadline)) throw new Error('req_bad_deadline');

  const seen = new Set();
  const requirements = json.requirements.map((r, i) => {
    if (!r || typeof r !== 'object') throw new Error('req_invalid');
    const id = String(r.id ?? `R${i + 1}`);
    if (seen.has(id)) throw new Error('req_dup_id');
    seen.add(id);
    return {
      id,
      order: Number.isFinite(Number(r.order)) ? Number(r.order) : i + 1,
      title_en: String(r.title_en ?? r.title_bn ?? id),
      title_bn: String(r.title_bn ?? r.title_en ?? id),
      mandatory: r.mandatory === true || r.mandatory === 'true',
      has_expiry: r.has_expiry === true || r.has_expiry === 'true',
    };
  });
  // Stable sort by order (ties keep file order).
  requirements.sort((a, b) => a.order - b.order);

  return {
    tender: {
      tender_id: String(t.tender_id ?? 'TENDER').trim() || 'TENDER',
      title: String(t.title ?? ''),
      procuring_entity: String(t.procuring_entity ?? ''),
      bidder: String(t.bidder ?? ''),
      submission_deadline: deadline,
    },
    requirements,
  };
}

/**
 * Status of a single requirement.
 * matches: { [reqId]: fileId }, expiries: { [reqId]: 'YYYY-MM-DD' }
 * Dates are compared as ISO strings, which sort correctly and avoid timezone bugs.
 */
export function statusOf(req, matches, expiries, deadline) {
  const fileId = matches[req.id];
  if (!fileId) return req.mandatory ? STATUS.MISSING : STATUS.NOT_PROVIDED;
  if (req.has_expiry) {
    const exp = expiries[req.id];
    if (!exp || !DATE_RE.test(exp)) return STATUS.EXPIRY_NEEDED;
    if (exp < deadline) return STATUS.EXPIRED;
  }
  return STATUS.OK;
}

export function allStatuses(project) {
  const { requirements, tender } = project.reqs;
  const out = {};
  for (const r of requirements) out[r.id] = statusOf(r, project.matches, project.expiries, tender.submission_deadline);
  return out;
}

export function blockingProblems(project) {
  const st = allStatuses(project);
  return project.reqs.requirements.filter((r) => BLOCKING.has(st[r.id])).map((r) => ({ req: r, status: st[r.id] }));
}

/** Group files by content hash; returns { [fileId]: [otherFileIds...] } for files that have twins. */
export function duplicateGroups(files) {
  const byHash = new Map();
  for (const f of files) {
    if (!byHash.has(f.hash)) byHash.set(f.hash, []);
    byHash.get(f.hash).push(f.id);
  }
  const out = {};
  for (const ids of byHash.values()) {
    if (ids.length < 2) continue;
    for (const id of ids) out[id] = ids.filter((x) => x !== id);
  }
  return out;
}

/** Which requirement (if any) a file is matched to. */
export function reqOfFile(matches, fileId) {
  for (const [reqId, fid] of Object.entries(matches)) if (fid === fileId) return reqId;
  return null;
}

/**
 * Check whether fileId may be matched to reqId. Returns null if allowed or an error code.
 * Rule 4.6: identical files may not be matched to different documents.
 */
export function canMatch(project, reqId, fileId) {
  const dups = duplicateGroups(project.files)[fileId] || [];
  for (const twin of dups) {
    const twinReq = reqOfFile(project.matches, twin);
    if (twinReq && twinReq !== reqId) return 'dup_conflict';
  }
  return null;
}

/**
 * Match a file to a requirement, keeping 1:1. Moving a file off another requirement
 * clears that requirement's match. Returns a new matches object (or throws error code).
 */
export function applyMatch(project, reqId, fileId) {
  const matches = { ...project.matches };
  const expiries = { ...project.expiries };
  if (!fileId) {
    delete matches[reqId];
    delete expiries[reqId];
    return { matches, expiries };
  }
  const err = canMatch(project, reqId, fileId);
  if (err) throw new Error(err);
  const prevReq = reqOfFile(matches, fileId);
  if (prevReq && prevReq !== reqId) {
    delete matches[prevReq];
    delete expiries[prevReq];
  }
  if (matches[reqId] !== fileId) delete expiries[reqId]; // new file → old expiry no longer applies
  matches[reqId] = fileId;
  return { matches, expiries };
}

// ---------- Auto-match by file name (bonus) ----------

const STOP = new Set(['certificate', 'cert', 'the', 'of', 'and', 'a', 'letter', 'pdf', 'copy', 'final', 'doc', 'document']);
const SYNONYMS = {
  tin: ['tin', 'tax', 'taxpayer', 'etin'],
  vat: ['vat', 'bin', 'mushak'],
  trade: ['trade', 'tl'],
  license: ['license', 'licence', 'tl'],
  bank: ['bank', 'solvency'],
  solvency: ['solvency', 'solvent'],
  experience: ['experience', 'exp', 'completion', 'work'],
  audited: ['audited', 'audit'],
  financial: ['financial', 'finance', 'price', 'boq'],
  statement: ['statement', 'statements', 'balance', 'audit'],
  manufacturer: ['manufacturer', 'manufacturers', 'maf', 'oem'],
  authorization: ['authorization', 'authorisation', 'maf', 'auth'],
  technical: ['technical', 'tech'],
  proposal: ['proposal', 'offer', 'bid'],
  signed: ['signed', 'sign'],
  declaration: ['declaration', 'declare', 'affidavit', 'undertaking'],
  registration: ['registration', 'reg'],
};

export function tokens(s) {
  return String(s)
    .toLowerCase()
    .replace(/\.pdf$/i, '')
    .replace(/'s\b/g, 's')
    .split(/[^a-z0-9]+/)
    .filter((w) => w && !STOP.has(w) && !/^\d+$/.test(w));
}

/** Score 0..1 of how well a text (file name, optionally plus extracted text) fits a requirement title. */
export function scoreName(text, title) {
  const ft = new Set(tokens(text));
  const tt = tokens(title);
  if (!tt.length || !ft.size) return 0;
  let hit = 0;
  for (const w of tt) {
    const alts = SYNONYMS[w] || [w];
    if (alts.some((a) => ft.has(a))) hit++;
  }
  return hit / tt.length;
}

/**
 * Suggest matches for unmatched requirements. Uses file name first, then extracted
 * PDF text (first page) as a weaker signal. Skips duplicates already used and prefers
 * files whose detected expiry is valid on the deadline.
 * Returns { [reqId]: fileId } for new suggestions only.
 */
export function suggestMatches(project) {
  const { requirements, tender } = project.reqs;
  const used = new Set(Object.values(project.matches));
  const dups = duplicateGroups(project.files);
  const usedHashes = new Set(project.files.filter((f) => used.has(f.id)).map((f) => f.hash));
  const candidates = [];
  for (const r of requirements) {
    if (project.matches[r.id]) continue;
    for (const f of project.files) {
      if (used.has(f.id) || usedHashes.has(f.hash)) continue;
      const byName = scoreName(f.name, r.title_en);
      const byText = f.textTitle ? scoreName(f.textTitle, r.title_en) : 0;
      let score = Math.max(byName, byText * 0.9);
      if (score < 0.5) continue;
      if (r.has_expiry && f.detectedExpiry) {
        score += f.detectedExpiry >= tender.submission_deadline ? 0.2 : -0.3;
      }
      if (dups[f.id] && /\(\d+\)|copy/i.test(f.name)) score -= 0.01; // prefer the original over "name (1).pdf"
      candidates.push({ reqId: r.id, fileId: f.id, hash: f.hash, score });
    }
  }
  candidates.sort((a, b) => b.score - a.score);
  const out = {};
  for (const c of candidates) {
    if (out[c.reqId] || used.has(c.fileId) || usedHashes.has(c.hash) || c.score < 0.5) continue;
    out[c.reqId] = c.fileId;
    used.add(c.fileId);
    usedHashes.add(c.hash);
  }
  return out;
}

/** Find an expiry date in extracted PDF text. Returns 'YYYY-MM-DD' or null. */
export function detectExpiry(text) {
  if (!text) return null;
  // Bangla digits → ASCII, so "৩০/০৬/২০২৭" is read like "30/06/2027".
  const t = text.replace(/\s+/g, ' ').replace(/[০-৯]/g, (d) => String('০১২৩৪৫৬৭৮৯'.indexOf(d)));
  const kw = /(valid\s+(until|till|upto|up to|through|thru)|expiry\s+date|expiration(\s+date)?|expires?\s+(on)?|date\s+of\s+expiry|validity|মেয়াদ|মেয়াদ)/i;
  const m = kw.exec(t);
  if (!m) return null;
  const tail = t.slice(m.index, m.index + 160);
  const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
  const month = (s) => MONTHS.indexOf(s.slice(0, 3).toLowerCase()) + 1;
  // Every date shape we know, as [regex, (match) => [y, m, d]]. The one closest to the keyword wins.
  const shapes = [
    [/(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/, (x) => [x[1], x[2], x[3]]], // 2027-06-30, 2027/06/30
    [/(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]{3,9})\.?,?\s+(\d{4})/, (x) => [x[3], month(x[2]), x[1]]], // 30 June 2027
    [/([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})/, (x) => [x[3], month(x[1]), x[2]]], // June 30, 2027
    [/(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/, (x) => [x[3], x[2], x[1]]], // 30/06/2027, 30-06-2027 (day first)
  ];
  let best = null;
  for (const [re, parts] of shapes) {
    const x = re.exec(tail);
    if (!x || (best && best.index <= x.index)) continue;
    const [y, mo, d] = parts(x).map(Number);
    if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) best = { index: x.index, date: `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}` };
  }
  return best?.date ?? null;
}

/** How well a file (name or first-page text) fits a requirement, 0..1. */
function fileFit(f, r) {
  return Math.max(scoreName(f.name, r.title_en), f.textTitle ? scoreName(f.textTitle, r.title_en) * 0.9 : 0);
}

/**
 * Content checks for matched files. They never change a status (Section 5 stays exact) — they are
 * "please double-check" hints for a wrong file in the right row.
 * Returns { [reqId]: [{ key: 'warn_tender', found } | { key: 'warn_looks_like', reqId }] }.
 */
export function contentWarnings(project) {
  const out = {};
  if (!project.reqs) return out;
  const { requirements, tender } = project.reqs;
  const id = tender.tender_id;
  // Same shape as our tender id (letters kept, each digit → any digit), e.g. T-2026-0417 → T-\d\d\d\d-\d\d\d\d.
  const idRe = (id.match(/\d/g) || []).length >= 3
    ? new RegExp(`(?<![A-Za-z0-9])${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\d/g, '\\d')}(?![0-9])`, 'gi')
    : null;
  for (const r of requirements) {
    const f = project.files.find((x) => x.id === project.matches[r.id]);
    if (!f) continue;
    const list = [];
    const text = f.textSample || f.textTitle || '';
    const other = idRe && [...text.matchAll(idRe)].map((m) => m[0]).find((s) => s.toLowerCase() !== id.toLowerCase());
    if (other) list.push({ key: 'warn_tender', found: other });
    if (fileFit(f, r) < 0.5) {
      const better = requirements.find((o) => o.id !== r.id && fileFit(f, o) >= 0.99);
      if (better) list.push({ key: 'warn_looks_like', reqId: better.id });
    }
    if (list.length) out[r.id] = list;
  }
  return out;
}

/** Parse a page selection like "1, 3-5" against total pages → sorted unique 1-based numbers. "all" or empty → all. */
export function parsePageList(spec, total) {
  const s = String(spec || '').trim().toLowerCase();
  if (!s || s === 'all') return Array.from({ length: total }, (_, i) => i + 1);
  const out = new Set();
  for (const part of s.split(',')) {
    const p = part.trim();
    if (!p) continue;
    const m = /^(\d+)\s*-\s*(\d+)$/.exec(p);
    if (m) {
      const a = Math.max(1, +m[1]);
      const b = Math.min(total, +m[2]);
      for (let i = a; i <= b; i++) out.add(i);
    } else if (/^\d+$/.test(p)) {
      const n = +p;
      if (n >= 1 && n <= total) out.add(n);
    } else {
      throw new Error('bad_pages');
    }
  }
  return [...out].sort((a, b) => a - b);
}

export function csvEscape(v) {
  const s = String(v ?? '');
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
