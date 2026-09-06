import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);

test('wires account discovery, league selection, active mock discovery, and a manual fallback', async () => {
  const [html, app] = await Promise.all([
    readFile(new URL('site/fantasy/index.html', root), 'utf8'),
    readFile(new URL('site/fantasy/app.js', root), 'utf8'),
  ]);

  for (const id of [
    'sleeper-account', 'load-account', 'league-select', 'draft-select', 'mock-select', 'manual-draft-id', 'load-manual-draft',
  ]) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  assert.match(html, /Sleeper username or user ID/);
  assert.match(html, /Active mock drafts/);
  assert.match(html, /Sleeper does not tie them back to a league/);
  assert.match(html, /manual fallback/);
  assert.match(app, /\/user\/\$\{encodeURIComponent\(accountInput\)\}/);
  assert.match(app, /\/user\/\$\{account\.user_id\}\/leagues\/nfl\/\$\{SEASON\}/);
  assert.match(app, /\/user\/\$\{account\.user_id\}\/drafts\/nfl\/\$\{SEASON\}/);
  assert.match(app, /\/user\/\$\{accountId\}\/drafts\/nfl\/\$\{SEASON\}/);
  assert.match(app, /\/league\/\$\{leagueId\}\/drafts/);
  assert.match(app, /loadDraft\(selectedDraftId, \{ source: 'league' \}\)/);
  assert.match(app, /loadDraft\(preferredMockId, \{ source: 'account-mock' \}\)/);
  assert.match(app, /loadDraft\('', \{ source: 'manual' \}\)/);
  assert.match(app, /MOCK_DISCOVERY_INTERVAL_MS = 15_000/);
  assert.match(app, /state\.mockDiscoveryRefreshing/);
  assert.match(app, /String\(state\.account\?\.user_id \?\? ''\) !== accountId/);
  assert.match(app, /if \(document\.hidden\) \{\s+stopPolling\(\);\s+stopMockDiscovery\(\);/);
});
