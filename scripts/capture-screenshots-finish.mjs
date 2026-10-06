/** Finish sample pack → ready + generated + bangla shots */
import { chromium } from 'playwright';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'screenshots');
const BASE = process.env.SHOT_URL || 'http://localhost:5173/';

const shot = (page, name) => page.screenshot({ path: join(OUT, name), fullPage: true, animations: 'disabled' }).then(() => console.log('wrote', name));
const tab = async (page, name) => {
  await page.locator(`[data-act="tab"][data-tab="${name}"]`).first().click();
  await page.waitForTimeout(400);
};

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await (await browser.newContext({
    viewport: { width: 1440, height: 960 },
    deviceScaleFactor: 2,
    reducedMotion: 'reduce',
  })).newPage();

  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.evaluate(() => {
    const intro = document.getElementById('intro');
    if (intro) { intro.setAttribute('data-done', ''); intro.style.display = 'none'; }
    localStorage.setItem('tpb_lang', 'en');
  });
  await page.reload({ waitUntil: 'networkidle' });
  await page.evaluate(() => {
    const intro = document.getElementById('intro');
    if (intro) { intro.setAttribute('data-done', ''); intro.style.display = 'none'; }
  });
  await page.waitForTimeout(500);

  await tab(page, 'tender');
  await page.locator('[data-act="sample"]').click();
  await page.waitForTimeout(3000);
  await tab(page, 'match');
  await page.locator('[data-act="auto"]').click();
  await page.waitForTimeout(1200);

  // Click all Use it expiry suggestions (re-query each time after re-render)
  for (let i = 0; i < 8; i++) {
    const btn = page.locator('[data-act="use-expiry"]').first();
    if (!(await btn.count())) break;
    await btn.click();
    await page.waitForTimeout(350);
  }

  // Fill unmatched selects — re-query after each change
  for (let round = 0; round < 12; round++) {
    const empty = page.locator('select[data-in="match"]');
    const count = await empty.count();
    let changed = false;
    for (let i = 0; i < count; i++) {
      const sel = empty.nth(i);
      const val = await sel.inputValue();
      if (val) continue;
      const pick = await sel.locator('option').evaluateAll((opts) => {
        const ok = opts.find((o) => o.value && !o.disabled);
        return ok ? ok.value : null;
      });
      if (!pick) continue;
      await sel.selectOption(pick);
      await page.waitForTimeout(400);
      changed = true;
      break; // DOM remorphs — restart
    }
    if (!changed) break;
  }

  // Any remaining use-expiry
  for (let i = 0; i < 6; i++) {
    const btn = page.locator('[data-act="use-expiry"]').first();
    if (!(await btn.count())) break;
    await btn.click();
    await page.waitForTimeout(350);
  }

  await page.waitForTimeout(600);
  await shot(page, '07_all_ok_drag_match_summary.png');

  await tab(page, 'package');
  await page.waitForTimeout(500);
  const gen = page.locator('[data-act="generate"]');
  const disabled = await gen.isDisabled();
  console.log('generate disabled?', disabled);

  if (disabled) {
    // Debug blockers visible
    const txt = await page.locator('.blocked, .ready').first().innerText().catch(() => 'none');
    console.log('package status:', txt.slice(0, 300));
    await shot(page, '03_expired_blocks_generate.png');
  } else {
    await shot(page, '04_all_ok_ready_en.png');
    await gen.click();
    await page.waitForSelector('a[download], .pdf-preview, iframe.pdf-preview', { timeout: 60000 }).catch(() => {});
    await page.waitForTimeout(2000);
    await shot(page, '05_generated_en.png');
    // also keep a clean ready without needing regenerate — scroll to package ready area
  }

  // Bangla tour
  await page.locator('[data-act="lang"][data-lang="bn"]').click();
  await page.waitForTimeout(500);
  await tab(page, 'match');
  await shot(page, '06_bangla_ui.png');
  await tab(page, 'package');
  await shot(page, '08_bangla_all_ok.png');

  await page.locator('[data-act="lang"][data-lang="en"]').click();
  await page.waitForTimeout(300);
  await page.locator('[data-act="help"]').first().click();
  await page.waitForTimeout(400);
  await tab(page, 'tender');
  await shot(page, '09_help_panel.png');
  // keep 09_confirm_dialog name for README compatibility
  await shot(page, '09_confirm_dialog.png');

  // Hero empty for README top (fresh)
  await page.locator('[data-act="reset"]').click().catch(() => {});
  // may confirm
  page.once('dialog', (d) => d.accept());
  await page.locator('[data-act="reset"]').click().catch(() => {});
  await page.waitForTimeout(800);
  await tab(page, 'tender');
  await shot(page, '00_home_empty.png');

  await browser.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
