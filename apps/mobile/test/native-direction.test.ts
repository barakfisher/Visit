import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { physicalDrawing, startAlignment } from '../src/design/nativeDirection';

const appRoot = path.resolve(__dirname, '..');
const sources = ['app', 'components', 'src'].flatMap(folder => readdirSync(path.join(appRoot, folder), { recursive: true, encoding: 'utf8' })
  .filter(file => /\.tsx?$/.test(file) && !file.includes('.stories.')).map(file => path.join(folder, file)));
const lines = sources.flatMap(file => readFileSync(path.join(appRoot, file), 'utf8').split('\n').map((line, index) => ({ at: `${file}:${index + 1}`, line })));

test('text follows its language: named on web, left to the layout on native', () => {
  assert.deepEqual(startAlignment('web', 'rtl'), { textAlign: 'right' });
  assert.deepEqual(startAlignment('web', 'ltr'), { textAlign: 'left' });
  for (const platform of ['ios', 'android']) for (const direction of ['rtl', 'ltr'] as const) assert.deepEqual(startAlignment(platform, direction), {});
});

test('no screen aligns text right by hand, because native turns it left under RTL', () => {
  assert.deepEqual(lines.filter(({ at, line }) => !at.includes('nativeDirection.ts') && /textAlign:[^,}]*'right'/.test(line)).map(({ at }) => at), []);
});

test('a shape with a border on one side only is drawn left to right, because native swaps the side under RTL', () => {
  const oneSided = ({ line }: { line: string }) => /borderLeftWidth/.test(line) !== /borderRightWidth/.test(line);
  const unguarded = lines.filter(item => oneSided(item) && !item.line.includes('...physicalDrawing')).map(({ at }) => at);
  assert.deepEqual(unguarded, []);
  assert.equal(physicalDrawing.direction, 'ltr');
});
