import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const appRoot = path.resolve(__dirname, '..');
const SOURCE_FOLDERS = ['app', 'components', 'src'];
/** What `accessibilityRole` accepts on Android. Web-only roles such as `status` belong in `role`, which native maps safely. */
const NATIVE_ROLES = new Set(['none', 'button', 'dropdownlist', 'togglebutton', 'link', 'search', 'image', 'keyboardkey', 'text', 'adjustable', 'imagebutton', 'header', 'summary', 'alert', 'checkbox', 'combobox', 'menu', 'menubar', 'menuitem', 'progressbar', 'radio', 'radiogroup', 'scrollbar', 'spinbutton', 'switch', 'tab', 'tabbar', 'tablist', 'timer', 'list', 'toolbar', 'grid', 'pager', 'scrollview', 'horizontalscrollview', 'viewgroup', 'webview', 'drawerlayout', 'slidingdrawer', 'iconmenu']);

const sources = SOURCE_FOLDERS.flatMap(folder => readdirSync(path.join(appRoot, folder), { recursive: true, encoding: 'utf8' })
  .filter(file => file.endsWith('.tsx')).map(file => path.join(folder, file)));

test('accessibilityRole only holds values Android accepts, because any other value crashes the screen', () => {
  assert.ok(sources.length > 0);
  const invalid = sources.flatMap(file => [...readFileSync(path.join(appRoot, file), 'utf8').matchAll(/accessibilityRole=(?:"[^"]+"|\{[^}]+\})/g)]
    .flatMap(([usage]) => [...usage.matchAll(/(?<!=== )["']([a-z]+)["']/g)].map(match => match[1]!).filter(role => !NATIVE_ROLES.has(role)).map(role => `${file}: ${role}`)));
  assert.deepEqual(invalid, []);
});
