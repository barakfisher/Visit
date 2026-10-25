import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../storybook-static');
const output = path.resolve(root, '../test-results/design');
const mime: Record<string, string> = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2' };
const server = createServer(async (req, res) => {
  try {
    const target = path.resolve(root, '.' + decodeURIComponent(new URL(req.url!, 'http://localhost').pathname));
    if (!target.startsWith(root + path.sep)) { res.writeHead(403).end(); return; }
    const data = await readFile(target);
    res.setHeader('Content-Type', mime[path.extname(target)] ?? 'application/octet-stream');
    res.end(data);
  } catch { res.writeHead(404).end(); }
});
await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
const source = { commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(), dirty: !!execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim() };
const checks: { locale: string; width: number; zoom: number; screenshot: string }[] = [];
try {
  await mkdir(output, { recursive: true });
  await writeFile(path.join(output, 'report.json'), JSON.stringify({ passed: false, source, checks }, null, 2));
  browser = await chromium.launch();
  for (const locale of ['hebrew', 'english']) for (const [width, zoom] of [[320, 1], [390, 1], [1280, 1], [640, 2]]) {
    const page = await browser.newPage({ viewport: { width: width!, height: 1000 }, reducedMotion: 'reduce' });
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => route.request().url().startsWith(origin + '/') ? route.continue() : route.abort());
    await page.goto(`${origin}/iframe.html?id=foundation-responsivecontrols--${locale}-desktop&viewMode=story`);
    const content = page.getByTestId('foundation-content');
    await content.waitFor();
    // Wait for the story's final keyboard-selection assertion to finish.
    await page.waitForFunction(() => Array.from(document.querySelectorAll('button')).some(button => button.getAttribute('aria-label')?.includes('12, 2026') && button.getAttribute('aria-pressed') === 'true'));
    await page.evaluate(value => { document.documentElement.style.zoom = String(value); }, zoom!);
    const layout = await page.evaluate(() => {
      const viewport = document.querySelector('[data-testid="foundation-viewport"]') as HTMLElement;
      const content = document.querySelector('[data-testid="foundation-content"]') as HTMLElement;
      return { overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1, localOverflow: viewport.scrollWidth > viewport.clientWidth + 1, direction: getComputedStyle(content).direction, buttons: Array.from(content.querySelectorAll('button')).map(button => ({ width: button.offsetWidth, height: button.offsetHeight })) };
    });
    assert.equal(layout.overflow, false, `${locale}/${width}/${zoom}: page overflow`);
    assert.equal(layout.localOverflow, false, `${locale}/${width}/${zoom}: content overflow`);
    assert.equal(layout.direction, locale === 'hebrew' ? 'rtl' : 'ltr');
    assert.ok(layout.buttons.every(button => button.width >= 44 && button.height >= 44));
    assert.deepEqual(errors, []);
    const screenshot = `${locale}-${width}-zoom-${zoom}.png`;
    await page.screenshot({ path: path.join(output, screenshot), fullPage: true });
    checks.push({ locale, width: width!, zoom: zoom!, screenshot });
    await page.close();
  }
  await writeFile(path.join(output, 'report.json'), JSON.stringify({ passed: true, source, checks }, null, 2));
  console.log(`Design layout: ${checks.length} Hebrew/English, mobile/desktop/200% zoom checks passed; screenshots in test-results/design.`);
} finally { await browser?.close(); await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
