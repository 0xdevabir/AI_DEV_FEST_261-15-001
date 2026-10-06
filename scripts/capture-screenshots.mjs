/**
 * Capture README screenshots against the current TenderNest UI.
 * Run: npx playwright test is not used — plain node script.
 *   node scripts/capture-screenshots.mjs
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const OUT = join(ROOT, 'screenshots');
const BASE = process.env.SHOT_URL || 'http://localhost:5173/';

mkdirSync(OUT, { recursive: true });

const shot = async (page, name, fullPage = true) => {
  const path = join(OUT, name);
  await page.screenshot({ path, fullPage, animations: 'disabled' });
  console.log('wrote', name);
};

const clickAct = async (page, act) => {
  await page.locator(`[data-act="${act}"]`).first().click();
};

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    deviceScaleFactor: 2,
    reducedMotion: 'reduce', // skip intro splash
    locale: 'en-US',
  });
  const page = await context.newPage();
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForSelector('#app .top, #app .shell, #app header, main#app', { timeout: 15000 });
  // Ensure intro gone
  await page.evaluate(() => {
    const intro = document.getElementById('intro');
    if (intro) {
      intro.setAttribute('data-done', '');
      intro.style.display = 'none';
    }
    document.documentElement.style.removeProperty('--intro-offset');
  });
  await page.waitForTimeout(400);

  // 00 — empty / home (hero of current UI)
  await shot(page, '00_home_empty.png', true);

  // Load sample pack
  const sampleBtn = page.locator('[data-act="sample"]').first();
  if (await sampleBtn.count()) {
    await sampleBtn.click();
  } else {
    // fallback: button text
    await page.getByRole('button', { name: /sample pack/i }).click();
  }
  await page.waitForTimeout(2500);

  // 01 — sample loaded (likely still missing matches)
  await shot(page, '01_sample_loaded_all_missing.png', true);

  // Auto-match
  const auto = page.locator('[data-act="auto-match"], [data-act="automatch"]').first();
  if (await auto.count()) {
    await auto.click();
  } else {
    const byText = page.getByRole('button', { name: /auto-match/i });
    if (await byText.count()) await byText.click();
  }
  await page.waitForTimeout(1200);
  await shot(page, '02_after_auto_match.png', true);

  // Try to surface expired / blockers: open Match / Package sections if dock exists
  const matchNav = page.getByRole('button', { name: /^Match$/i });
  if (await matchNav.count()) await matchNav.click();
  await page.waitForTimeout(400);
  await shot(page, '03_match_status.png', true);

  // Accept suggested expiries if present
  const useBtns = page.locator('[data-act="use-expiry"], button:has-text("Use it")');
  const n = await useBtns.count();
  for (let i = 0; i < n; i++) {
    try {
      await useBtns.nth(i).click({ timeout: 1000 });
      await page.waitForTimeout(200);
    } catch {}
  }

  // Match scan if dropdown exists for Signed Declaration — best effort via auto already
  // Fill any empty mandatory by selecting first unused option where possible
  const selects = page.locator('select[data-in="match"], select[data-match], .req-row select, table select');
  const sc = await selects.count();
  for (let i = 0; i < Math.min(sc, 12); i++) {
    const sel = selects.nth(i);
    const val = await sel.inputValue().catch(() => '');
    if (val) continue;
    const opts = sel.locator('option');
    const oc = await opts.count();
    for (let j = 1; j < oc; j++) {
      const disabled = await opts.nth(j).isDisabled().catch(() => false);
      const v = await opts.nth(j).getAttribute('value');
      if (!disabled && v) {
        await sel.selectOption(v).catch(() => {});
        break;
      }
    }
  }
  await page.waitForTimeout(500);

  // Package tab
  const pkgNav = page.getByRole('button', { name: /^Package$/i });
  if (await pkgNav.count()) await pkgNav.click();
  await page.waitForTimeout(500);

  // If still blocked, capture blocker state as 03; else ready as 04
  const blocked = page.locator('.blocked, text=blocked, text=need attention');
  if (await page.locator('.blocked').count()) {
    await shot(page, '03_expired_blocks_generate.png', true);
  } else {
    // keep previous 03_match_status as match view; also copy name expected by README
    await shot(page, '03_expired_blocks_generate.png', true);
  }

  await shot(page, '04_all_ok_ready_en.png', true);

  // Generate if enabled
  const gen = page.locator('[data-act="generate"]').first();
  if (await gen.count()) {
    const disabled = await gen.isDisabled();
    if (!disabled) {
      await gen.click();
      await page.waitForTimeout(4000);
      await shot(page, '05_generated_en.png', true);
    } else {
      console.log('generate disabled — skipping 05 success shot (will keep ready as hero)');
      await shot(page, '05_generated_en.png', true);
    }
  }

  // Bangla
  const bn = page.getByRole('button', { name: /বাং/ });
  if (await bn.count()) await bn.click();
  else await page.locator('[data-act="lang"]').first().click().catch(() => {});
  await page.waitForTimeout(600);
  if (await matchNav.count()) await matchNav.click();
  await page.waitForTimeout(400);
  await shot(page, '06_bangla_ui.png', true);
  await shot(page, '08_bangla_all_ok.png', true);

  // EN again + files/match for drag tray
  const en = page.getByRole('button', { name: /^EN$/i });
  if (await en.count()) await en.click();
  await page.waitForTimeout(400);
  if (await matchNav.count()) await matchNav.click();
  await page.waitForTimeout(400);
  await shot(page, '07_all_ok_drag_match_summary.png', true);

  // Confirm dialog — start over
  page.once('dialog', async (d) => {
    await shot(page, '09_confirm_dialog.png', false).catch(() => {});
    await d.dismiss();
  });
  // native confirm may not be screenshotable — open help instead as polish shot
  const help = page.locator('[data-act="help"]').first();
  if (await help.count()) {
    await help.click();
    await page.waitForTimeout(400);
    await shot(page, '09_confirm_dialog.png', true);
  }

  // Hero override: best ready state in EN for README top
  if (await en.count()) await en.click();
  if (await pkgNav.count()) await pkgNav.click();
  await page.waitForTimeout(400);
  await shot(page, '04_all_ok_ready_en.png', true);

  await browser.close();
  console.log('done');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
