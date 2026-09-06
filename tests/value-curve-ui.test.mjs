import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);

test('provides a dedicated accessible value-curve view and position switcher', async () => {
  const html = await readFile(new URL('site/fantasy/index.html', root), 'utf8');

  assert.match(html, /data-workspace-view="table"/);
  assert.match(html, /data-workspace-view="curves"/);
  assert.match(html, /<svg id="value-curve-chart"[^>]*role="img"/);
  assert.deepEqual([...html.matchAll(/data-curve-position="([A-Z]+)"/g)].map((match) => match[1]), [
    'ALL', 'QB', 'RB', 'WR', 'TE',
  ]);
  assert.match(html, /Straight segments connect the discrete player rankings/);
  assert.match(html, /id="curve-player-details"[^>]*aria-live="polite"/);
});

test('renders discrete points, drafted styling, selection, and snake-pick markers', async () => {
  const app = await readFile(new URL('site/fantasy/app.js', root), 'utf8');

  assert.match(app, /buildValueCurve\(state\.players/);
  assert.match(app, /createSvgElement\('polyline'/);
  assert.doesNotMatch(app, /bezier|spline|curveBasis/);
  assert.match(app, /curve-point \$\{player\.drafted \? 'drafted' : 'available'/);
  assert.match(app, /if \(!player\.drafted\) \{/);
  assert.match(app, /circle\.setAttribute\('tabindex', '0'\)/);
  assert.match(app, /event\.key === 'Enter' \|\| event\.key === ' '/);
  assert.match(app, /nearestAvailableCurvePoint\(plotted, x, y, 26\)/);
  assert.match(app, /snakeDraftPickNumbers\(state\.draft \?\? \{}, selection\)/);
  assert.match(app, /class: 'curve-pick-marker'/);
});

test('keeps the chart responsive and touch-friendly without horizontal page overflow', async () => {
  const css = await readFile(new URL('site/fantasy/style.css', root), 'utf8');

  assert.match(css, /body \{[\s\S]*?overflow-x: hidden;/);
  assert.match(css, /\.curve-panel \{[\s\S]*?min-width: 0;[\s\S]*?overflow: hidden;/);
  assert.match(css, /\.value-curve-chart \{[\s\S]*?width: 100%;[\s\S]*?max-width: 100%;[\s\S]*?touch-action: manipulation;/);
  assert.match(css, /\.curve-position-tabs \{[\s\S]*?overflow-x: auto;/);
});
