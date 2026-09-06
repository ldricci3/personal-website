import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);

test('wires account-based league discovery and an honest standalone-mock fallback', async () => {
  const [html, app] = await Promise.all([
    readFile(new URL('site/fantasy/index.html', root), 'utf8'),
    readFile(new URL('site/fantasy/app.js', root), 'utf8'),
  ]);

  for (const id of [
    'sleeper-account', 'load-account', 'league-select', 'draft-select', 'manual-draft-id', 'load-manual-draft',
  ]) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  assert.doesNotMatch(html, /id="mock-select"/);
  assert.match(html, /Sleeper username or user ID/);
  assert.match(html, /Standalone mock draft ID/);
  assert.match(html, /does not list standalone mocks by username/);
  assert.doesNotMatch(html, /Active mock drafts/);
  assert.match(app, /\/user\/\$\{encodeURIComponent\(accountInput\)\}/);
  assert.match(app, /\/user\/\$\{account\.user_id\}\/leagues\/nfl\/\$\{SEASON\}/);
  assert.doesNotMatch(app, /\/user\/\$\{account\.user_id\}\/drafts\/nfl\/\$\{SEASON\}/);
  assert.match(app, /\/league\/\$\{leagueId\}\/drafts/);
  assert.match(app, /loadDraft\(selectedDraftId, \{ source: 'league' \}\)/);
  assert.match(app, /loadDraft\('', \{ source: 'manual' \}\)/);
});

test('bypasses Sleeper CDN caching for every initial and polled live-draft read', async () => {
  const app = await readFile(new URL('site/fantasy/app.js', root), 'utf8');
  assert.match(app, /freshSleeperPath\(path, fresh \? Date\.now\(\) : null\)/);
  assert.match(app, /fetchJson\(`\/draft\/\$\{draftId\}`, \{ fresh: true \}\)/);
  assert.match(app, /fetchJson\(`\/draft\/\$\{draftId\}\/picks`, \{ fresh: true \}\)/);
  assert.match(app, /POLL_INTERVAL_MS = 5_000/);
  assert.match(app, /window\.setInterval\(\(\) => refreshPicks\(\), POLL_INTERVAL_MS\)/);
  assert.match(app, /if \(document\.hidden\) \{\s+stopPolling\(\);/);
  assert.match(app, /if \(state\.draft\) \{\s+refreshPicks\(\);\s+startPolling\(\);/);
});
