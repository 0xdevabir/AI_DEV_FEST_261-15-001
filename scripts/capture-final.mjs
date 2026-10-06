import { chromium } from 'playwright';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'screenshots');
const shot = (page, name) =>
  page.screenshot({ path: join(OUT, name), fullPage: true, animations: 'disabled' }).then(() => console.log('wrote', name));

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await (
    await browser.newContext({ viewport: { width: 1440, height: 960 }, deviceScaleFactor: 2, reducedMotion: 'reduce' })
  ).newPage();

  await page.goto('http://localhost:5173/', { waitUntil: 'networkidle' });
  await page.evaluate(() => {
    const i = document.getElementById('intro');
    if (i) {
      i.setAttribute('data-done', '');
      i.style.display = 'none';
    }
    localStorage.setItem('tpb_lang', 'en');
  });
  await page.reload({ waitUntil: 'networkidle' });
  await page.evaluate(() => {
    const i = document.getElementById('intro');
    if (i) {
      i.setAttribute('data-done', '');
      i.style.display = 'none';
    }
  });
  await page.waitForTimeout(400);

  // Empty home hero
  await page.locator('[data-act="tab"][data-tab="tender"]').first().click();
  await page.waitForTimeout(300);
  await shot(page, '00_home_empty.png');

  await page.locator('[data-act="sample"]').first().click();
  await page.waitForTimeout(3000);
  await shot(page, '01_sample_loaded_all_missing.png');

  await page.locator('[data-act="tab"][data-tab="files"]').first().click();
  await page.waitForTimeout(400);
  await shot(page, '01b_files_uploaded.png');

  await page.locator('[data-act="tab"][data-tab="match"]').first().click();
  await page.waitForTimeout(400);
  await page.locator('[data-act="auto"]').first().click();
  await page.waitForTimeout(1000);
  await shot(page, '02_after_auto_match.png');

  // Accept expiry suggestions
  while (await page.locator('[data-act="use-expiry"]').count()) {
    await page.locator('[data-act="use-expiry"]').first().click();
    await page.waitForTimeout(350);
  }

  // Match Signed Declaration (R10) to scan_0042.pdf by option text
  const r10 = page.locator('select[data-in="match"][data-req="R10"]');
  const scanVal = await r10.locator('option').evaluateAll((opts) => {
    const o = opts.find((x) => /scan_0042/i.test(x.textContent || ''));
    return o ? o.value : null;
  });
  if (scanVal) {
    await r10.selectOption(scanVal);
    await page.waitForTimeout(500);
  }

  await shot(page, '07_all_ok_drag_match_summary.png');

  // Package ready / blockers
  await page.locator('[data-act="tab"][data-tab="package"]').first().click();
  await page.waitForTimeout(500);
  const gen = page.locator('[data-act="generate"]').first();
  const disabled = await gen.isDisabled();
  console.log('generate disabled?', disabled);
  const status = await page.locator('.blocked, .ready').first().innerText().catch(() => '');
  console.log(status.slice(0, 250));

  if (disabled) {
    await shot(page, '03_expired_blocks_generate.png');
  } else {
    // intentional blocker shot: temporarily clear an expiry? skip — use earlier after-auto as blocker story
    await shot(page, '04_all_ok_ready_en.png');
    await gen.click();
    await page.waitForSelector('a[download], iframe.pdf-preview, .pdf-preview', { timeout: 90000 });
    await page.waitForTimeout(1500);
    await shot(page, '05_generated_en.png');
  }

  // Bangla
  await page.locator('[data-act="lang"][data-lang="bn"]').first().click();
  await page.waitForTimeout(500);
  await page.locator('[data-act="tab"][data-tab="match"]').first().click();
  await page.waitForTimeout(400);
  await shot(page, '06_bangla_ui.png');
  await page.locator('[data-act="tab"][data-tab="package"]').first().click();
  await page.waitForTimeout(400);
  await shot(page, '08_bangla_all_ok.png');

  // Help
  await page.locator('[data-act="lang"][data-lang="en"]').first().click();
  await page.waitForTimeout(300);
  await page.locator('[data-act="help"]').first().click();
  await page.waitForTimeout(400);
  await page.locator('[data-act="tab"][data-tab="tender"]').first().click();
  await page.waitForTimeout(300);
  await shot(page, '09_confirm_dialog.png');

  // Capture a dedicated blocker shot from a fresh run path mid-way
  // (already have 02 showing blockers in package area on full page)

  await browser.close();
  console.log('done');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
