import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);

test('wires account discovery, league selection, and a separate mock-draft path', async () => {
  const [html, app] = await Promise.all([
    readFile(new URL('site/fantasy/index.html', root), 'utf8'),
    readFile(new URL('site/fantasy/app.js', root), 'utf8'),
  ]);

  for (const id of ['sleeper-account', 'load-account', 'league-select', 'draft-select', 'manual-draft-id', 'load-manual-draft']) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  assert.match(html, /Sleeper username or user ID/);
  assert.match(html, /for standalone mocks/);
  assert.match(app, /\/user\/\$\{encodeURIComponent\(accountInput\)\}/);
  assert.match(app, /\/user\/\$\{account\.user_id\}\/leagues\/nfl\/\$\{SEASON\}/);
  assert.match(app, /\/league\/\$\{leagueId\}\/drafts/);
  assert.match(app, /loadDraft\(selectedDraftId, \{ source: 'league' \}\)/);
  assert.match(app, /loadDraft\('', \{ source: 'manual' \}\)/);
});
