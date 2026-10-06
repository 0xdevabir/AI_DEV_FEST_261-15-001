/**
 * Capture README screenshots in the **mobile** UI (tab bar + one step).
 *   SHOT_URL=https://tendernest.devabir.me/ node scripts/capture-screenshots.mjs
 */
import { chromium, devices } from 'playwright';
import { mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, '..', 'screenshots');
const BASE = process.env.SHOT_URL || 'http://localhost:5173/';
mkdirSync(OUT, { recursive: true });

const shot = async (page, name) => {
  await page.evaluate(() => window.scrollTo({ top: 0, left: 0, behavior: 'instant' }));
  await page.waitForTimeout(150);
  await page.screenshot({ path: join(OUT, name), fullPage: false, animations: 'disabled' });
  console.log('wrote', name);
};

const tab = async (page, name) => {
  // Prefer the mobile tab bar (visible <900px); rail steps are hidden on phone.
  const mobile = page.locator(`.tabbar [data-act="tab"][data-tab="${name}"]`);
  const btn = (await mobile.count()) ? mobile.first() : page.locator(`[data-act="tab"][data-tab="${name}"]`).first();
  if (await btn.count()) await btn.click({ force: true });
  await page.waitForTimeout(400);
};

const shotStep = async (page, step, name) => {
  await tab(page, step);
  await page.waitForTimeout(200);
  await shot(page, name);
};

/** Fill remaining matches + expiry dates so Generate unlocks. */
const finishChecks = async (page) => {
  await tab(page, 'match');
  await page.waitForTimeout(300);

  // Prefer "Use it" on detected dates first
  for (let pass = 0; pass < 3; pass++) {
    const useBtns = page.locator('[data-act="use-expiry"]');
    const nUse = await useBtns.count();
    for (let i = 0; i < nUse; i++) {
      const b = useBtns.nth(i);
      await b.scrollIntoViewIfNeeded().catch(() => {});
      await b.click().catch(() => {});
      await page.waitForTimeout(100);
    }
  }

  const selects = page.locator('select[data-in="match"]');
  const sc = await selects.count();
  for (let i = 0; i < sc; i++) {
    const sel = selects.nth(i);
    await sel.scrollIntoViewIfNeeded().catch(() => {});
    const val = await sel.inputValue().catch(() => '');
    if (val) continue;
    const options = await sel.locator('option').evaluateAll((opts) =>
      opts.map((o) => ({ value: o.value, disabled: o.disabled })).filter((o) => o.value && !o.disabled)
    );
    if (options.length) {
      await sel.selectOption(options[0].value);
      await page.waitForTimeout(150);
    }
  }

  // Re-click Use it after new matches, then fill leftovers
  const use2 = page.locator('[data-act="use-expiry"]');
  for (let i = 0; i < await use2.count(); i++) {
    await use2.nth(i).click().catch(() => {});
    await page.waitForTimeout(80);
  }

  // Playwright fill is flaky on iOS date inputs — set value + fire change via the page.
  await page.evaluate(() => {
    document.querySelectorAll('input[type="date"][data-in="expiry"]').forEach((inp) => {
      if (inp.value) return;
      inp.value = '2027-12-31';
      inp.dispatchEvent(new Event('change', { bubbles: true }));
    });
  });
  await page.waitForTimeout(300);

  // One empty select at a time — batching steals files from other rows.
  for (let guard = 0; guard < 8; guard++) {
    const filled = await page.evaluate(() => {
      const sel = [...document.querySelectorAll('select[data-in="match"]')].find((s) => !s.value);
      if (!sel) return false;
      // Prefer scan_0042 for Signed Declaration-style empty rows when available
      const opts = [...sel.options].filter((o) => o.value && !o.disabled);
      const scan = opts.find((o) => /scan/i.test(o.textContent || ''));
      const pick = scan || opts[0];
      if (!pick) return false;
      sel.value = pick.value;
      sel.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    });
    if (!filled) break;
    await page.waitForTimeout(250);
  }

  // Click remaining Use-it hints
  for (const b of await page.locator('[data-act="use-expiry"]').all()) {
    await b.click().catch(() => {});
  }
  await page.waitForTimeout(200);

  await page.evaluate(() => {
    document.querySelectorAll('input[type="date"][data-in="expiry"]').forEach((inp) => {
      if (inp.value) return;
      inp.value = '2027-12-31';
      inp.dispatchEvent(new Event('change', { bubbles: true }));
    });
  });
  await page.waitForTimeout(500);
  const status = await page.locator('.summary').first().innerText().catch(() => '');
  console.log('match summary:', status.slice(0, 200));
};

async function main() {
  const browser = await chromium.launch({ headless: true });
  const iphone = devices['iPhone 13 Pro'];
  const context = await browser.newContext({
    ...iphone,
    // Slightly taller so tab bar + step content read well in README
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
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
  await page.waitForTimeout(3200);
  // Sample pack auto-advances to Files on mobile — snap back for step-1 frame
  await shotStep(page, 'tender', '01_sample_loaded_all_missing.png');

  await shotStep(page, 'files', '01b_files_uploaded.png');

  await shotStep(page, 'match', '01c_match_before.png');

  await page.locator('[data-act="auto"]').first().click();
  await page.waitForTimeout(1200);
  await shotStep(page, 'match', '02_after_auto_match.png');

  await finishChecks(page);
  await shotStep(page, 'match', '07_all_ok_drag_match_summary.png');

  await shotStep(page, 'package', '03_expired_blocks_generate.png');

  const gen = page.locator('[data-act="generate"]').first();
  const canGen = (await gen.count()) && !(await gen.isDisabled());
  if (canGen) {
    await shotStep(page, 'package', '04_all_ok_ready_en.png');
    await gen.click();
    await page.waitForTimeout(6000);
    await shotStep(page, 'package', '05_generated_en.png');
  } else {
    console.log('Generate still disabled — fallback shots');
    await shotStep(page, 'match', '04_all_ok_ready_en.png');
    await shotStep(page, 'package', '05_generated_en.png');
  }

  await page.locator('.mbar-actions [data-act="lang"][data-lang="bn"]').click();
  await page.waitForTimeout(500);
  await shotStep(page, 'match', '06_bangla_ui.png');
  await shotStep(page, 'package', '08_bangla_all_ok.png');

  await page.locator('.mbar-actions [data-act="lang"][data-lang="en"]').click();
  await page.waitForTimeout(300);
  await page.locator('.mbar-actions [data-act="help"]').click();
  await page.waitForTimeout(400);
  await shotStep(page, 'tender', '09_confirm_dialog.png');

  await browser.close();
  console.log('done →', OUT);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
