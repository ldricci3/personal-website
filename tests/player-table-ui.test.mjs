import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);

test('renders a compact semantic player table with three sortable columns', async () => {
  const [html, app] = await Promise.all([
    readFile(new URL('site/fantasy/index.html', root), 'utf8'),
    readFile(new URL('site/fantasy/app.js', root), 'utf8'),
  ]);

  assert.match(html, /<table id="player-table" class="player-table">/);
  assert.match(html, /<tbody id="player-list" aria-busy="true"><\/tbody>/);
  assert.deepEqual([...html.matchAll(/data-sort="([^"]+)"/g)].map((match) => match[1]), [
    'player', 'beer', 'dynasty',
  ]);
  assert.match(html, />Player<span class="sort-indicator"/);
  assert.match(html, />Value<span class="sort-indicator"/);
  assert.match(html, />Dynasty<span class="sort-indicator"/);
  assert.doesNotMatch(html, /id="sort-by"|value-legend|value-help|How values work/);

  assert.match(app, /createElement\('tr', `player-row/);
  assert.match(app, /createElement\('td', 'numeric-column value-number'/);
  assert.match(app, /'numeric-column dynasty-number'/);
  assert.match(app, /header\?\.setAttribute\('aria-sort'/);
  assert.doesNotMatch(app, /createElement\('details'|value-track|expand-indicator|Lower is better/);
});

test('keeps the mobile player rows dense without horizontal table scrolling', async () => {
  const css = await readFile(new URL('site/fantasy/style.css', root), 'utf8');
  assert.match(css, /\.player-table \{[\s\S]*?table-layout: fixed;/);
  assert.match(css, /\.player-table \.numeric-column \{[\s\S]*?width: 5rem;/);
  assert.match(css, /\.player-row td \{[\s\S]*?height: 3rem;/);
  assert.match(css, /\.player-table-wrap \{[\s\S]*?overflow: clip;/);
  assert.doesNotMatch(css, /\.value-track|\.player-details|\.expand-indicator/);
});
