import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../storybook-static');
const output = path.resolve(root, '../test-results/vis11');
const mime: Record<string, string> = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2' };
const server = createServer(async (req, res) => {
  try {
    const target = path.resolve(root, '.' + decodeURIComponent(new URL(req.url ?? '/', 'http://localhost').pathname));
    if (!target.startsWith(root + path.sep)) { res.writeHead(403).end(); return; }
    const data = await readFile(target);
    res.setHeader('Content-Type', mime[path.extname(target)] ?? 'application/octet-stream');
    res.end(data);
  } catch { res.writeHead(404).end(); }
});
await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
const address = server.address();
if (!address || typeof address === 'string') throw new Error('Missing server address');
const origin = `http://127.0.0.1:${address.port}`;
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
const source = { commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: path.resolve(root, '../../..'), encoding: 'utf8' }).trim(), dirty: !!execFileSync('git', ['status', '--porcelain', '--', '.', ':!.ai'], { cwd: path.resolve(root, '../../..'), encoding: 'utf8' }).trim() };
const checks: { locale: string; width: number; zoom: number; screenshot: string }[] = [];
try {
  await mkdir(output, { recursive: true });
  await writeFile(path.join(output, 'report.json'), JSON.stringify({ passed: false, source, checks }, null, 2));
  browser = await chromium.launch();
  const stories = ['home-screen--empty', 'home-screen--many', 'home-screen--english', 'home-navigation--customer', 'home-navigation--approved', 'home-navigation--english', 'booking-compact-controls--available', 'booking-compact-controls--closed-calendar', 'booking-compact-controls--interactive-calendar', 'booking-compact-controls--service-selection', 'booking-advisory-review--hebrew', 'booking-advisory-review--first-occurrence', 'home-upcoming-appointment--hebrew-long-text'];
  for (const story of stories) for (const [width, zoom] of [[320, 1], [390, 1], [1280, 1], [640, 2]]) {
    if (width === undefined || zoom === undefined) throw new Error('Invalid viewport fixture');
    const page = await browser.newPage({ viewport: { width, height: 1000 }, reducedMotion: 'reduce', timezoneId: 'America/New_York' });
    const errors: string[] = [], external: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => {
      if (route.request().url().startsWith(origin + '/')) return route.continue();
      external.push(route.request().url()); return route.abort();
    });
    await page.goto(`${origin}/iframe.html?id=${story}&viewMode=story`);
    await page.locator('#storybook-root').waitFor();
    await page.waitForFunction(() => document.querySelector('#storybook-root')?.textContent?.trim());
    await page.evaluate(value => { document.documentElement.style.zoom = String(value); }, zoom);
    if (story.includes('navigation')) {
      const trigger = page.getByRole('button', { name: /Open menu|פתיחת תפריט/ });
      await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label')?.match(/Open menu|פתיחת תפריט/) && document.activeElement.getAttribute('aria-expanded') === 'false');
      await trigger.click();
      await page.getByTestId('menu-panel').waitFor();
      const panel = page.getByTestId('menu-panel');
      const buttons = panel.getByRole('button');
      await buttons.last().focus(); await page.keyboard.press('Tab');
      await page.waitForFunction(() => document.querySelector('[data-testid="menu-panel"]')?.contains(document.activeElement));
      assert.equal(await panel.evaluate(node => node.contains(document.activeElement)), true, `${story}: focus escaped drawer`);
      await buttons.first().focus(); await page.keyboard.press('Shift+Tab');
      await page.waitForFunction(() => document.querySelector('[data-testid="menu-panel"]')?.contains(document.activeElement));
      assert.equal(await panel.evaluate(node => node.contains(document.activeElement)), true, `${story}: reverse focus escaped drawer`);
    }
    if (story.includes('interactive-calendar')) {
      await page.waitForFunction(() => document.querySelector('[data-testid="booking-date-trigger"]')?.getAttribute('aria-label')?.includes('2026-10-29') && !document.querySelector('[data-testid="booking-day-2026-10-29"]'));
      await page.getByTestId('booking-date-trigger').click();
      const day = page.getByTestId('booking-day-2026-10-29');
      await day.waitFor(); await day.focus();
      const box = await day.boundingBox();
      assert.ok(box && box.x >= 0 && box.y >= 0 && box.x + box.width <= width && box.y + box.height <= 1000, `${story}: keyboard-focused date is clipped`);
      await page.keyboard.press('Escape');
      assert.equal(await page.getByTestId('booking-date-trigger').evaluate(node => node === document.activeElement), true);
      await page.getByTestId('booking-date-trigger').click(); await day.focus();
    }
    const contrast = await page.evaluate(() => {
      const scope = document.querySelector('[aria-modal="true"]') ?? document.querySelector('#storybook-root');
      if (!scope) return [];
      return Array.from(scope.querySelectorAll('*')).filter(node => node.childNodes.length && Array.from(node.childNodes).some(child => child.nodeType === Node.TEXT_NODE && child.textContent?.trim()) && node.getBoundingClientRect().height > 0 && !node.closest('[aria-disabled="true"]')).map(node => {
        let parent: Element | null = node, background = 'rgb(255, 255, 255)';
        while (parent) { const value = getComputedStyle(parent).backgroundColor; if (value !== 'rgba(0, 0, 0, 0)' && value !== 'transparent') { background = value; break; } parent = parent.parentElement; }
        const values = [getComputedStyle(node).color, background].map(color => {
          const channels = color.match(/[\d.]+/g)?.slice(0, 3).map(Number);
          if (!channels || channels.length !== 3) throw new Error(`Unsupported color ${color}`);
          return channels.reduce((sum, channel, index) => { const c = channel / 255; return sum + (c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4) * ([.2126, .7152, .0722][index] ?? 0); }, 0);
        });
        const foreground = values[0] ?? 0, back = values[1] ?? 0;
        return { text: node.textContent, ratio: (Math.max(foreground, back) + .05) / (Math.min(foreground, back) + .05) };
      });
    });
    assert.ok(contrast.length > 0, `${story}: no rendered contrast samples`);
    assert.deepEqual(contrast.filter(sample => sample.ratio < 4.5), [], `${story}: rendered text contrast`);
    const layout = await page.evaluate(() => ({
      overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
      styled: Array.from(document.querySelectorAll('[class]')).some(node => getComputedStyle(node).borderRadius === '16px' || getComputedStyle(node).borderRadius === '24px'),
      buttons: Array.from(document.querySelectorAll('button')).filter(node => node.getBoundingClientRect().height > 0 && !node.disabled).map(node => ({ name: node.getAttribute('aria-label'), width: node.offsetWidth, height: node.offsetHeight })),
    }));
    assert.equal(layout.overflow, false, `${story}/${width}/${zoom}: page overflow`);
    assert.equal(layout.styled, true, `${story}: NativeWind styles missing`);
    assert.ok(layout.buttons.every(button => button.width >= 44 && button.height >= 44), `${story}/${width}: undersized targets ${JSON.stringify(layout.buttons.filter(button => button.width < 44 || button.height < 44))}`);
    assert.deepEqual(errors, [], story); assert.deepEqual(external, [], `${story}: external network request`);
    const screenshot = `${story}-${width}-zoom-${zoom}.png`;
    await page.screenshot({ path: path.join(output, screenshot), fullPage: true });
    checks.push({ locale: story, width, zoom, screenshot });
    await page.close();
  }
  await writeFile(path.join(output, 'report.json'), JSON.stringify({ passed: true, source, checks }, null, 2));
  console.log(`VIS-11 isolated layout: ${checks.length} Hebrew/English, mobile/desktop/200% zoom checks passed; screenshots in test-results/vis11.`);
} finally { await browser?.close(); await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
