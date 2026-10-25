import assert from 'node:assert/strict';
import { test } from 'node:test';
import { tokens } from '../src/design/tokens';
import { en, he, translate } from '../src/i18n/messages';
function luminance(hex: string) {
  const channels = hex.slice(1).match(/../g)!.map(part => parseInt(part, 16) / 255).map(c => c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4);
  return channels[0]! * .2126 + channels[1]! * .7152 + channels[2]! * .0722;
}
function contrast(a: string, b: string) { const x = luminance(a), y = luminance(b); return (Math.max(x, y) + .05) / (Math.min(x, y) + .05); }
test('semantic normal text pairs meet 4.5:1 without opacity reductions', () => {
  for (const background of ['surface', 'canvas', 'brandSoft']) for (const foreground of ['ink', 'body', 'brand', 'danger', 'warning', 'success']) {
    assert.ok(contrast(tokens.color[foreground]!, tokens.color[background]!) >= 4.5, `${foreground}/${background}`);
  }
  for (const background of ['surface', 'canvas']) assert.ok(contrast(tokens.color.muted!, tokens.color[background]!) >= 4.5);
  assert.ok(contrast(tokens.color.surface!, tokens.color.brand!) >= 4.5);
  assert.ok(contrast(tokens.color.surface!, tokens.color.brandPressed!) >= 4.5);
  assert.equal(tokens.interaction.disabledOpacity, 1);
});
test('focus ring and interactive boundaries meet 3:1 on adjacent surfaces', () => {
  for (const background of ['surface', 'canvas', 'brandSoft']) for (const foreground of ['focus', 'controlLine']) assert.ok(contrast(tokens.color[foreground]!, tokens.color[background]!) >= 3, `${foreground}/${background}`);
  assert.ok(tokens.interaction.focusWidth >= 2);
  assert.ok(tokens.layout.minTouchTarget >= 44);
  assert.ok(tokens.typography.body >= 16);
  assert.ok(tokens.typography.bodyLineHeight / tokens.typography.body >= 1.5);
});
test('foundation copy is complete in Hebrew and English and interpolates durations', () => {
  assert.deepEqual(Object.keys(en).sort(), Object.keys(he).sort());
  assert.equal(translate('he', 'ui.minutes', { minutes: 45 }), '45 דקות');
  assert.equal(translate('en', 'ui.minutes', { minutes: 45 }), '45 min');
});
