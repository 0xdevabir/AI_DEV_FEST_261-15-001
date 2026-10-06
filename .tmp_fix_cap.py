from pathlib import Path
p = Path('scripts/capture-screenshots.mjs')
t = p.read_text()
t = t.replace(
    "await page.locator('[data-act=\"lang\"][data-lang=\"bn\"]').click();",
    "await page.locator('[data-act=\"lang\"][data-lang=\"bn\"]').first().click();",
)
t = t.replace(
    "await page.locator('[data-act=\"lang\"][data-lang=\"en\"]').click();",
    "await page.locator('[data-act=\"lang\"][data-lang=\"en\"]').first().click();",
)
p.write_text(t)
print('ok')
