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
  assert.match(html, /id="curve-depth-toggle"[^>]*aria-pressed="false"[^>]*aria-describedby="curve-depth-note"/);
  assert.match(html, />Show deeper players<\/button>/);
});

test('renders discrete points, selectable drafted styling, and snake-pick markers', async () => {
  const app = await readFile(new URL('site/fantasy/app.js', root), 'utf8');

  assert.match(app, /buildValueCurve\(state\.players/);
  assert.match(app, /createSvgElement\('polyline'/);
  assert.doesNotMatch(app, /bezier|spline|curveBasis/);
  assert.match(app, /curve-point \$\{player\.drafted \? 'drafted' : 'available'/);
  assert.match(app, /role: 'button'/);
  assert.match(app, /tabindex: '0'/);
  assert.match(app, /'aria-pressed': String\(selected\)/);
  assert.match(app, /event\.key === 'Enter' \|\| event\.key === ' '/);
  assert.match(app, /nearestCurvePoint\(plotted, x, y, 26\)/);
  assert.match(app, /snakeDraftPickNumbers\(state\.draft \?\? \{}, selection\)/);
  assert.match(app, /class: 'curve-pick-marker'/);
});

test('cross-selects rows and graph points, persists across views, and offers clear paths', async () => {
  const app = await readFile(new URL('site/fantasy/app.js', root), 'utf8');
  const setView = app.slice(app.indexOf('function setWorkspaceView'), app.indexOf('function updateCurvePlayerDetails'));

  assert.match(app, /row\.addEventListener\('click', \(\) => selectPlayer\(player, \{ source: 'table' \}\)\)/);
  assert.match(app, /selectPlayer\(nearest, \{ source: 'curve' \}\)/);
  assert.match(app, /row\.setAttribute\('aria-selected', String\(Boolean\(selected\)\)\)/);
  assert.match(app, /class: `curve-point[\s\S]*?'aria-pressed': String\(selected\)/);
  assert.match(app, /togglePlayerSelection\(state\.selectedPlayerKey, key\)/);
  assert.match(app, /curvePositionForSelectedPlayer\(state\.curvePosition, player\.position\)/);
  assert.match(app, /filtersForSelectedPlayer\(state\.filters, player\)/);
  assert.match(app, /clear\.addEventListener\('click', clearPlayerSelection\)/);
  assert.match(app, /event\.key === 'Escape' && state\.selectedPlayerKey/);
  assert.match(app, /else clearPlayerSelection\(\)/);
  assert.doesNotMatch(setView, /selectedPlayerKey\s*=/);
});

test('limits the default curve to the loaded draft and can reveal deeper players without changing the table', async () => {
  const app = await readFile(new URL('site/fantasy/app.js', root), 'utf8');
  const renderPlayers = app.slice(app.indexOf('function renderPlayers'), app.indexOf('function renderRosterPlayer'));

  assert.match(app, /const cutoff = draftPlayerCutoff\(state\.draft, state\.league\)/);
  assert.match(app, /fullCurve\.filter\(\(player\) => player\.rank <= cutoff\)/);
  assert.match(app, /state\.showDeeperPlayers = !state\.showDeeperPlayers/);
  assert.match(app, /Number\(player\.overallRank\) > draftPlayerCutoff[\s\S]*?state\.showDeeperPlayers = true/);
  assert.match(app, /the 12-team, 15-round fallback/);
  assert.match(app, /Showing players through \$\{rangeLabel\}/);
  assert.doesNotMatch(renderPlayers, /showDeeperPlayers/);
});

test('keeps the chart responsive and touch-friendly without horizontal page overflow', async () => {
  const css = await readFile(new URL('site/fantasy/style.css', root), 'utf8');

  assert.match(css, /body \{[\s\S]*?overflow-x: hidden;/);
  assert.match(css, /\.curve-panel \{[\s\S]*?min-width: 0;[\s\S]*?overflow: hidden;/);
  assert.match(css, /\.value-curve-chart \{[\s\S]*?width: 100%;[\s\S]*?max-width: 100%;[\s\S]*?min-height: 290px;[\s\S]*?touch-action: manipulation;/);
  assert.match(css, /\.curve-controls \{[\s\S]*?flex-wrap: wrap;/);
  assert.match(css, /\.curve-position-tabs \{[\s\S]*?overflow-x: auto;/);
  assert.match(css, /\.curve-depth-toggle \{[\s\S]*?min-height: 2\.75rem;/);
  assert.match(css, /\.curve-clear-selection \{[\s\S]*?min-height: 2\.75rem;/);
});
