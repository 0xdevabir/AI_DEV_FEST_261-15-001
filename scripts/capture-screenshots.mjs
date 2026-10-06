/**
 * Capture README screenshots against the current TenderNest UI.
 *   SHOT_URL=https://tendernest.devabir.me/ node scripts/capture-screenshots.mjs
 *
 * Uses a fixed viewport (sidebar + one step visible), not full-page scroll shots.
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, '..', 'screenshots');
const BASE = process.env.SHOT_URL || 'http://localhost:5173/';
mkdirSync(OUT, { recursive: true });

const shot = async (page, name) => {
  await page.evaluate(() => window.scrollTo({ top: 0, left: 0, behavior: 'instant' }));
  await page.waitForTimeout(120);
  await page.screenshot({ path: join(OUT, name), fullPage: false, animations: 'disabled' });
  console.log('wrote', name);
};

const tab = async (page, name) => {
  const btn = page.locator(`[data-act="tab"][data-tab="${name}"]`).first();
  if (await btn.count()) await btn.click();
  await page.waitForTimeout(350);
};

const shotStep = async (page, step, name) => {
  await tab(page, step);
  await page.locator(`#sec-${step}`).scrollIntoViewIfNeeded().catch(() => {});
  await page.waitForTimeout(280);
  await shot(page, name);
};

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 1.5,
    reducedMotion: 'reduce',
    locale: 'en-US',
  });
  const page = await context.newPage();
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForSelector('#app', { timeout: 20000 });
  await page.evaluate(() => {
    const intro = document.getElementById('intro');
    if (intro) {
      intro.setAttribute('data-done', '');
      intro.style.display = 'none';
    }
    document.documentElement.style.removeProperty('--intro-offset');
    try {
      localStorage.setItem('tpb_lang', 'en');
    } catch {}
  });
  await page.waitForTimeout(500);

  await shotStep(page, 'tender', '00_home_empty.png');

  await page.locator('[data-act="sample"]').first().click();
  await page.waitForTimeout(2800);
  await shotStep(page, 'tender', '01_sample_loaded_all_missing.png');

  await shotStep(page, 'files', '01b_files_uploaded.png');

  await shotStep(page, 'match', '01c_match_before.png');

  await page.locator('[data-act="auto"]').first().click();
  await page.waitForTimeout(1000);
  await shotStep(page, 'match', '02_after_auto_match.png');

  const useBtns = page.locator('[data-act="use-expiry"]');
  const nUse = await useBtns.count();
  for (let i = 0; i < nUse; i++) {
    await useBtns.nth(i).click().catch(() => {});
    await page.waitForTimeout(150);
  }

  const selects = page.locator('select[data-in="match"]');
  const sc = await selects.count();
  for (let i = 0; i < sc; i++) {
    const sel = selects.nth(i);
    const val = await sel.inputValue().catch(() => '');
    if (val) continue;
    const options = await sel.locator('option').evaluateAll((opts) =>
      opts
        .map((o) => ({ value: o.value, disabled: o.disabled, text: o.textContent }))
        .filter((o) => o.value && !o.disabled)
    );
    if (options.length) {
      await sel.selectOption(options[0].value).catch(() => {});
      await page.waitForTimeout(120);
    }
  }
  await page.waitForTimeout(500);
  await shotStep(page, 'match', '07_all_ok_drag_match_summary.png');

  await shotStep(page, 'package', '03_expired_blocks_generate.png');

  const gen = page.locator('[data-act="generate"]').first();
  const canGen = (await gen.count()) && !(await gen.isDisabled());
  if (canGen) {
    await shotStep(page, 'package', '04_all_ok_ready_en.png');
    await gen.click();
    await page.waitForTimeout(5000);
    await shotStep(page, 'package', '05_generated_en.png');
  } else {
    console.log('Generate still disabled — capturing current package/match as ready fallback');
    await shotStep(page, 'match', '04_all_ok_ready_en.png');
    await shotStep(page, 'package', '05_generated_en.png');
  }

  await page.locator('[data-act="lang"][data-lang="bn"]').first().click();
  await page.waitForTimeout(500);
  await shotStep(page, 'match', '06_bangla_ui.png');
  await shotStep(page, 'package', '08_bangla_all_ok.png');

  await page.locator('[data-act="lang"][data-lang="en"]').first().click();
  await page.waitForTimeout(300);
  await page.locator('[data-act="help"]').first().click();
  await page.waitForTimeout(400);
  await shotStep(page, 'tender', '09_confirm_dialog.png');

  await browser.close();
  console.log('done →', OUT);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
