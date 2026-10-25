import test from 'node:test';
import assert from 'node:assert/strict';
import jsQR from 'jsqr';
import { providerQr } from '../src/lib/providerQr';
test('provider QR export independently decodes to the exact canonical link with a quiet zone', () => {
  for (const url of ['http://127.0.0.1:8082/p/pilot-studio', 'https://booking.example.test/p/' + 'a'.repeat(80)]) {
    const qr = providerQr(url), scale = 8, width = qr.size * scale;
    const rgba = new Uint8ClampedArray(width * width * 4); rgba.fill(255);
    for (const match of qr.path.matchAll(/M(\d+),(\d+)h1v1h-1z/g)) {
      const x = Number(match[1]), y = Number(match[2]); assert.ok(x >= 4 && y >= 4 && x < qr.size - 4 && y < qr.size - 4);
      for (let dy = 0; dy < scale; dy++) for (let dx = 0; dx < scale; dx++) { const i = ((y * scale + dy) * width + x * scale + dx) * 4; rgba[i] = 0; rgba[i + 1] = 0; rgba[i + 2] = 0; }
    }
    assert.equal(jsQR(rgba, width, width)?.data, url);
    assert.ok(qr.svg.includes(`d="${qr.path}"`)); assert.equal(qr.svg.includes(url), false);
  }
});
test('provider QR refuses credentials, non-http schemes and non-canonical routes', () => {
  for (const url of ['javascript:alert(1)', 'https://name:secret@example.test/p/a', 'https://example.test/p/a?token=secret', 'https://example.test/p/a#invite=secret', 'https://example.test/owner/a', 'https://example.test/p/a--b', 'https://example.test/p/' + 'a'.repeat(81)]) assert.throws(() => providerQr(url));
});
