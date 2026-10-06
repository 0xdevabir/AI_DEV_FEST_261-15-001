import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  STATUS, parseRequirements, statusOf, blockingProblems, duplicateGroups, canMatch,
  applyMatch, suggestMatches, detectExpiry, parsePageList, csvEscape, contentWarnings,
}from '../src/logic.js';

const sample = JSON.parse(readFileSync(new URL('../public/sample-pack/requirements.json', import.meta.url)));
const reqs = parseRequirements(sample);
const DL = reqs.tender.submission_deadline;
const R = (id) => reqs.requirements.find((r) => r.id === id);

const file = (id, name, hash = id, extra = {}) => ({ id, name, hash, pages: 1, ...extra });
const proj = (files = [], matches = {}, expiries = {}) => ({ reqs, files, matches, expiries });

test('sample requirements load and sort by order', () => {
  assert.equal(reqs.tender.tender_id, 'T-2026-0417');
  const orders = reqs.requirements.map((r) => r.order);
  assert.deepEqual(orders, [...orders].sort((a, b) => a - b));
});

test('bad requirements are rejected with clear codes', () => {
  assert.throws(() => parseRequirements(null), /req_invalid/);
  assert.throws(() => parseRequirements({ requirements: [] }), /req_no_tender/);
  assert.throws(() => parseRequirements({ tender: { submission_deadline: '2026-01-01' } }), /req_no_list/);
  assert.throws(() => parseRequirements({ tender: { submission_deadline: '20/10/2026' }, requirements: [{}] }), /req_bad_deadline/);
});

test('status rules', () => {
  const mand = { id: 'a', mandatory: true, has_expiry: false };
  const opt = { id: 'a', mandatory: false, has_expiry: false };
  const exp = { id: 'a', mandatory: true, has_expiry: true };
  assert.equal(statusOf(mand, {}, {}, DL), STATUS.MISSING);
  assert.equal(statusOf(opt, {}, {}, DL), STATUS.NOT_PROVIDED);
  assert.equal(statusOf(opt, { a: 'f' }, {}, DL), STATUS.OK);
  assert.equal(statusOf(exp, { a: 'f' }, {}, DL), STATUS.EXPIRY_NEEDED);
  assert.equal(statusOf(exp, { a: 'f' }, { a: '2025-06-30' }, DL), STATUS.EXPIRED);
  assert.equal(statusOf(exp, { a: 'f' }, { a: DL }, DL), STATUS.OK, 'expiry on the deadline day is OK');
  assert.equal(statusOf(exp, { a: 'f' }, { a: '2027-06-30' }, DL), STATUS.OK);
});

test('optional documents never block; mandatory ones do', () => {
  const blocking = blockingProblems(proj()).map((p) => p.req.id);
  for (const r of reqs.requirements) assert.equal(blocking.includes(r.id), r.mandatory);
});

test('duplicates by content cannot go to different documents', () => {
  const files = [file('x', 'experience_cert.pdf', 'H'), file('y', 'experience_cert (1).pdf', 'H')];
  assert.deepEqual(duplicateGroups(files), { x: ['y'], y: ['x'] });
  const p = proj(files, { R05: 'x' });
  assert.equal(canMatch(p, 'R02', 'y'), 'dup_conflict');
  assert.throws(() => applyMatch(p, 'R02', 'y'), /dup_conflict/);
  assert.equal(canMatch(p, 'R05', 'y'), null, 'swapping copies on the same document is fine');
});

test('matching is 1:1, moving clears old match and expiry, undo works', () => {
  const p = proj([file('a', 'a.pdf'), file('b', 'b.pdf')], { R01: 'a' }, { R01: '2027-01-01' });
  let r = applyMatch(p, 'R04', 'a');
  assert.deepEqual(r.matches, { R04: 'a' });
  assert.deepEqual(r.expiries, {});
  r = applyMatch({ ...p, ...r }, 'R04', '');
  assert.deepEqual(r.matches, {});
});

test('auto-match on the sample file names', () => {
  const files = [
    file('tl25', 'trade_license_2025.pdf', 'h1', { detectedExpiry: '2025-06-30' }),
    file('tl26', 'trade_license_2026.pdf', 'h2', { detectedExpiry: '2027-06-30' }),
    file('tin', '03_tin_certificate.pdf', 'h3'),
    file('vat', '04_vat_certificate.pdf', 'h4'),
    file('bank', 'bank_solvency.pdf', 'h5'),
        file('e2', 'experience_cert (1).pdf', 'h6'),
        file('e1', 'experience_cert.pdf', 'h6'),
    file('fin', '01_financial_proposal.pdf', 'h7'),
    file('tech', '02_technical_proposal.pdf', 'h8'),
    file('scan', 'scan_0042.pdf', 'h9'),
  ];
  const s = suggestMatches(proj(files));
  const byTitle = (word) => reqs.requirements.find((r) => r.title_en.toLowerCase().includes(word)).id;
  assert.equal(s[byTitle('trade')], 'tl26', 'valid licence beats expired one');
  assert.equal(s[byTitle('technical')], 'tech');
  assert.equal(s[byTitle('financial proposal')], 'fin');
  assert.equal(s[byTitle('experience')], 'e1');
  assert.ok(!Object.values(s).includes('e2'), 'duplicate copy not used twice');
  assert.ok(!Object.values(s).includes('scan'), 'meaningless name is left for the user');
});

test('expiry detection', () => {
  assert.equal(detectExpiry('Valid until: 30 June 2025'), '2025-06-30');
  assert.equal(detectExpiry('Expiry Date 2027-06-30'), '2027-06-30');
  assert.equal(detectExpiry('validity 31/12/2026'), '2026-12-31');
  assert.equal(detectExpiry('Issued 2024-01-01'), null);
  assert.equal(detectExpiry('Valid through June 30, 2027'), '2027-06-30');
  assert.equal(detectExpiry('Expiry date: 30-06-2027'), '2027-06-30');
  assert.equal(detectExpiry('Valid until 2027/06/30'), '2027-06-30');
  assert.equal(detectExpiry('Valid until the 5th March 2027'), '2027-03-05');
  assert.equal(detectExpiry('মেয়াদ: ৩০/০৬/২০২৭'), '2027-06-30');
  assert.equal(detectExpiry('Valid until 45/13/2027'), null, 'impossible dates are ignored');
});

test('content warnings: other tender id and a file that looks like another document', () => {
  const p = proj([
    file('f1', 'TIN Certificate.pdf', 'h1', { textSample: 'Ref T-2026-0981 and T-2026-0417' }),
    file('f2', 'scan.pdf', 'h2', { textSample: 'For tender T-2026-0417 only' }),
  ], { R01: 'f1', R02: 'f2' });
  const w = contentWarnings(p);
  assert.deepEqual(w.R01.map((x) => x.key).sort(), ['warn_looks_like', 'warn_tender']);
  assert.equal(w.R01.find((x) => x.key === 'warn_tender').found, 'T-2026-0981');
  assert.equal(w.R01.find((x) => x.key === 'warn_looks_like').reqId, 'R02');
  assert.equal(w.R02, undefined, 'own tender id and a vague name are fine');
});

test('page list parsing and CSV escaping', () => {
  assert.deepEqual(parsePageList('all', 3), [1, 2, 3]);
  assert.deepEqual(parsePageList('1, 3-5, 9', 6), [1, 3, 4, 5]);
  assert.throws(() => parsePageList('abc', 5), /bad_pages/);
  assert.equal(csvEscape('a,"b"'), '"a,""b"""');
});
