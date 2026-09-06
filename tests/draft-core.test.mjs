import test from 'node:test';
import assert from 'node:assert/strict';
import {
  accountLeagueStorageKey,
  assignRosterSlots,
  buildTeamOptions,
  chooseInitialConnection,
  createContextGate,
  draftPicksSignature,
  filterAndSortPlayers,
  freshSleeperPath,
  getPickedPlayerKeys,
  isStandaloneDraft,
  isValidDraftPick,
  isValidSleeperAccountInput,
  isValidSleeperId,
  leagueDraftStorageKey,
  loadCachedPicks,
  nextPickStatus,
  normalizeDraftPicks,
  normalizeName,
  normalizePosition,
  normalizeSleeperAccount,
  normalizeSleeperAccountInput,
  normalizeSleeperDrafts,
  normalizeSleeperLeagues,
  normalizeTeam,
  pickBelongsToSelection,
  pickMatchesPlayer,
  pickNumberForRound,
  resolveTeamSelection,
  saveCachedPicks,
  selectDraftId,
  selectLeagueId,
  storageGet,
  storageRemove,
  storageSet,
} from '../site/fantasy/draft-core.js';
import {
  accountDraftsWithoutStandaloneMock,
  draft,
  picks,
  players,
  standaloneLeagueMock,
  users,
} from './fixtures/draft-fixtures.mjs';

function memoryStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
  };
}

test('normalizes names, suffixes, accents, and defense positions', () => {
  assert.equal(normalizeName('D’Andre Swift Jr.'), 'dandreswift');
  assert.equal(normalizeName('José Núñez III'), 'josenunez');
  assert.equal(normalizePosition('D/ST'), 'DEF');
  assert.equal(normalizeTeam('JAX'), 'JAC');
  assert.equal(normalizeTeam('WSH'), 'WAS');
});

test('validates numeric Sleeper IDs before requests', () => {
  assert.equal(isValidSleeperId('123456789012345678'), true);
  assert.equal(isValidSleeperId(12345), true);
  assert.equal(isValidSleeperId(' 12345 '), true);
  assert.equal(isValidSleeperId('123/../../league'), false);
  assert.equal(isValidSleeperId('abc123'), false);
  assert.equal(isValidSleeperId(''), false);
});

test('accepts a Sleeper username or numeric user ID and normalizes the account response', () => {
  assert.equal(normalizeSleeperAccountInput('  ldricci3  '), 'ldricci3');
  assert.equal(isValidSleeperAccountInput('ldricci3'), true);
  assert.equal(isValidSleeperAccountInput('123456789012345678'), true);
  assert.equal(isValidSleeperAccountInput('bad/account'), false);
  assert.equal(isValidSleeperAccountInput('two words'), false);
  assert.deepEqual(normalizeSleeperAccount({
    user_id: 123456789012345678n,
    username: 'ldricci3',
    display_name: 'Leo',
  }), {
    user_id: '123456789012345678',
    username: 'ldricci3',
    display_name: 'Leo',
  });
  assert.throws(() => normalizeSleeperAccount(null), /did not find/);
  assert.throws(() => normalizeSleeperAccount({ username: 'missing-id' }), /did not find/);
});

test('normalizes 2026 NFL leagues and lets persisted or single-league choices resolve by name', () => {
  const leagues = normalizeSleeperLeagues([
    { league_id: '101', name: 'Primary League', sport: 'nfl', season: '2026', status: 'pre_draft' },
    { league_id: '202', name: 'Second League', sport: 'nfl', season: '2026', status: 'in_season' },
    { league_id: '303', name: 'Old League', sport: 'nfl', season: '2025' },
    { league_id: '404', name: 'Basketball', sport: 'nba', season: '2026' },
    { name: 'Missing ID', sport: 'nfl', season: '2026' },
  ]);
  assert.deepEqual(leagues.map(({ league_id, name }) => ({ league_id, name })), [
    { league_id: '101', name: 'Primary League' },
    { league_id: '202', name: 'Second League' },
  ]);
  assert.equal(selectLeagueId(leagues, ''), '');
  assert.equal(selectLeagueId(leagues, '202'), '202');
  assert.equal(selectLeagueId([leagues[0]], ''), '101');
  assert.deepEqual(normalizeSleeperLeagues([], '2026'), []);
  assert.throws(() => normalizeSleeperLeagues({ leagues: [] }), /invalid league data/);
});

test('normalizes multiple drafts and rejects invalid draft payloads', () => {
  const drafts = normalizeSleeperDrafts([
    { draft_id: '555', status: 'complete' },
    { draft_id: 666, status: 'drafting' },
    { draft_id: 'bad-id', status: 'pre_draft' },
    null,
  ]);
  assert.deepEqual(drafts.map((draft) => draft.draft_id), ['555', '666']);
  assert.throws(() => normalizeSleeperDrafts({}), /invalid draft data/i);
});

test('models the real account response that omits an active standalone mock', () => {
  const accountDrafts = normalizeSleeperDrafts(accountDraftsWithoutStandaloneMock);
  assert.equal(accountDrafts.some((item) => item.draft_id === standaloneLeagueMock.draft_id), false);

  const [directMock] = normalizeSleeperDrafts([standaloneLeagueMock]);
  assert.equal(isStandaloneDraft(directMock), true);
  assert.equal(directMock.metadata.type, 'league_mock');
  assert.equal(directMock.metadata.league_id, '1389358867208470528');
  assert.equal(directMock.status, 'drafting');
  assert.equal(isStandaloneDraft({ ...directMock, league_id: directMock.metadata.league_id }), false);
});

test('adds a unique cache-buster to live Sleeper requests', () => {
  const path = '/draft/1402187277609803776/picks';
  assert.equal(freshSleeperPath(path), path);
  assert.equal(freshSleeperPath(path, 1788702265240), `${path}?_=1788702265240`);
  assert.equal(freshSleeperPath(`${path}?source=manual`, 'pick 36'), `${path}?source=manual&_=pick%2036`);
});

test('scopes saved league and league draft choices so accounts cannot mix', () => {
  const storage = memoryStorage();
  const accountOneLeagueKey = accountLeagueStorageKey('111');
  const accountTwoLeagueKey = accountLeagueStorageKey('222');
  const leagueOneDraftKey = leagueDraftStorageKey('333');
  const leagueTwoDraftKey = leagueDraftStorageKey('444');
  storageSet(storage, accountOneLeagueKey, '333');
  storageSet(storage, accountTwoLeagueKey, '444');
  storageSet(storage, leagueOneDraftKey, '555');
  storageSet(storage, leagueTwoDraftKey, '666');
  assert.equal(storageGet(storage, accountOneLeagueKey), '333');
  assert.equal(storageGet(storage, accountTwoLeagueKey), '444');
  assert.equal(storageGet(storage, leagueOneDraftKey), '555');
  assert.equal(storageGet(storage, leagueTwoDraftKey), '666');
  assert.equal(accountLeagueStorageKey('bad-id'), '');
  assert.equal(leagueDraftStorageKey('bad-id'), '');
});

test('invalidates stale account and league responses deterministically', () => {
  const gate = createContextGate();
  const accountRequest = gate.begin();
  assert.equal(gate.isCurrent(accountRequest), true);
  const newerLeagueRequest = gate.begin();
  assert.equal(gate.isCurrent(accountRequest), false);
  assert.equal(gate.isCurrent(newerLeagueRequest), true);
});

test('restores the last successful connection mode and retains a standalone mock fallback', () => {
  assert.deepEqual(chooseInitialConnection({ accountInput: 'ldricci3', manualDraftId: '555' }), {
    mode: 'account', value: 'ldricci3',
  });
  assert.deepEqual(chooseInitialConnection({
    accountInput: 'ldricci3', manualDraftId: '555', preferredMode: 'manual',
  }), {
    mode: 'manual', value: '555',
  });
  assert.deepEqual(chooseInitialConnection({
    accountInput: 'ldricci3', manualDraftId: '555', preferredMode: 'account',
  }), {
    mode: 'account', value: 'ldricci3',
  });
  assert.deepEqual(chooseInitialConnection({ accountInput: '', manualDraftId: '555' }), {
    mode: 'manual', value: '555',
  });
  assert.deepEqual(chooseInitialConnection({ accountInput: '', manualDraftId: 'not-an-id' }), {
    mode: 'none', value: '',
  });
});

test('validates and normalizes Sleeper pick payloads deterministically', () => {
  assert.equal(isValidDraftPick(picks[0]), true);
  assert.equal(isValidDraftPick({ pick_no: 0, player_id: '101' }), false);
  assert.equal(isValidDraftPick({ pick_no: 1, player_id: '' }), false);
  assert.equal(isValidDraftPick(null), false);

  const normalized = normalizeDraftPicks([picks[1], { pick_no: 'bad', player_id: '102' }]);
  assert.deepEqual(normalized, { picks: [picks[1]], invalidCount: 1 });
  assert.throws(() => normalizeDraftPicks({ picks }), /invalid pick data/);
  assert.throws(() => normalizeDraftPicks([{ nope: true }]), /invalid pick data/);
  assert.equal(draftPicksSignature(picks), draftPicksSignature([...picks].reverse()));
});

test('filters by position and search, then sorts by selected value', () => {
  const byPosition = filterAndSortPlayers(players, { position: 'WR' });
  assert.deepEqual(byPosition.map((player) => player.name), ['Alpha Receiver']);

  const bySearch = filterAndSortPlayers(players, { search: 'det' });
  assert.deepEqual(bySearch.map((player) => player.name), ['Beta Runner Jr.']);

  const byDynasty = filterAndSortPlayers(players, { sortBy: 'dynasty' });
  assert.deepEqual(byDynasty.map((player) => player.name), [
    'Gamma Quarterback', 'Alpha Receiver', 'Beta Runner Jr.', 'Delta Tight End',
  ]);

  const withMissingRank = [
    ...players,
    { playerKey: 'missing-def', name: 'Missing Defense', position: 'DEF', overallRank: 5, fantasyProsDynastyEcr2026: null },
  ];
  const byDynastyWithMissing = filterAndSortPlayers(withMissingRank, { sortBy: 'dynasty' });
  assert.equal(byDynastyWithMissing.at(-1).name, 'Missing Defense');

  const staleSavedSort = filterAndSortPlayers(players, { sortBy: 'keeperTotal' });
  assert.deepEqual(staleSavedSort.map((player) => player.name), [
    'Beta Runner Jr.', 'Gamma Quarterback', 'Alpha Receiver', 'Delta Tight End',
  ]);
});

test('excludes picked players by default and crosses them in show mode', () => {
  const available = filterAndSortPlayers(players, { picks: picks.slice(0, 1) });
  assert.equal(available.some((player) => player.sleeperId === '102'), false);

  const all = filterAndSortPlayers(players, { picks: picks.slice(0, 1), showDrafted: true });
  assert.equal(all.find((player) => player.sleeperId === '102').drafted, true);

  const jsonShape = players.map(({ playerKey: key, ...player }) => ({ ...player, modelKey: key }));
  const withModelKeys = filterAndSortPlayers(jsonShape, { picks: picks.slice(0, 1), showDrafted: true });
  assert.equal(withModelKeys.find((player) => player.sleeperId === '102').drafted, true);
});

test('matches a pick by a documented alias fallback when an ID is absent', () => {
  const pick = { metadata: { player_name: 'Beta Runner', position: 'RB', team: 'DET' } };
  assert.equal(pickMatchesPlayer(pick, players[1]), true);
  assert.equal(pickMatchesPlayer({ player_id: '999', metadata: pick.metadata }, players[1]), false);
  assert.equal(pickMatchesPlayer({ metadata: { ...pick.metadata, team: 'NYJ' } }, players[1]), false);
  assert.equal(
    pickMatchesPlayer(
      { metadata: { player_name: 'Alias Example', position: 'WR', team: 'JAX' } },
      { name: 'Alias Example', position: 'WR', team: 'JAC' },
    ),
    true,
  );
});

test('uses ID matching first and metadata only when a pick ID is absent', () => {
  const mismatchedId = { player_id: '999', metadata: { player_name: 'Beta Runner', position: 'RB', team: 'DET' } };
  assert.equal(getPickedPlayerKeys(players, [mismatchedId]).has('beta-rb'), false);
  const missingId = { metadata: { player_name: 'Beta Runner', position: 'RB', team: 'DET' } };
  assert.equal(getPickedPlayerKeys(players, [missingId]).has('beta-rb'), true);
  const modelPlayerWithoutId = { playerKey: 'legacy-rb', name: 'Legacy Runner', position: 'RB', team: 'DET' };
  const pickForLegacyPlayer = { player_id: '555', metadata: { player_name: 'Legacy Runner', position: 'RB', team: 'DET' } };
  assert.equal(getPickedPlayerKeys([modelPlayerWithoutId], [pickForLegacyPlayer]).has('legacy-rb'), true);
});

test('assigns chronological picks to the first eligible roster slots', () => {
  const roster = assignRosterSlots(picks, { userId: 'user-1', draftSlot: 1 }, players);
  assert.equal(roster.pickCount, 4);
  assert.equal(roster.slots.find((slot) => slot.id === 'QB1').player.name, 'Gamma Quarterback');
  assert.equal(roster.slots.find((slot) => slot.id === 'K1').player.name, 'Test Kicker');
  assert.equal(roster.slots.find((slot) => slot.id === 'TE1').player.name, 'Delta Tight End');
  assert.equal(roster.slots.find((slot) => slot.id === 'WR1').player.name, 'Alpha Receiver');
  assert.equal(roster.slots.find((slot) => slot.id === 'WR2').player, null);
});

test('uses roster IDs for ownership and falls back only when an ID is absent', () => {
  const selection = { rosterId: '11', userId: 'user-1', draftSlot: 1 };
  assert.equal(pickBelongsToSelection(picks[1], selection), true);
  assert.equal(pickBelongsToSelection({ ...picks[1], roster_id: 22 }, selection), false);
  assert.equal(pickBelongsToSelection({ ...picks[1], roster_id: undefined }, selection), true);
  assert.equal(pickBelongsToSelection({ ...picks[1], roster_id: undefined, picked_by: 'other' }, selection), false);
});

test('uses the same strict ID and metadata fallback rules for roster values', () => {
  const metadataFallbackPick = {
    pick_no: 6,
    draft_slot: 1,
    roster_id: 11,
    picked_by: 'user-1',
    metadata: { player_name: 'Beta Runner', position: 'RB', team: 'DET' },
  };
  const fallbackRoster = assignRosterSlots([metadataFallbackPick], { rosterId: '11' }, players);
  assert.equal(fallbackRoster.slots.find((slot) => slot.id === 'RB1').player.playerKey, 'beta-rb');

  const conflictingIdPick = { ...metadataFallbackPick, player_id: '999' };
  const conflictingRoster = assignRosterSlots([conflictingIdPick], { rosterId: '11' }, players);
  assert.equal(conflictingRoster.slots.find((slot) => slot.id === 'RB1').player.playerKey, 'sleeper:999');
  assert.equal(conflictingRoster.slots.find((slot) => slot.id === 'RB1').player.beerPlus, null);
});

test('keeps unmatched K and DEF picks in the roster without player values', () => {
  const defensePick = {
    pick_no: 6,
    draft_slot: 1,
    picked_by: 'user-1',
    player_id: 'NE',
    metadata: { player_name: 'New England Patriots', position: 'DEF', team: 'NE' },
  };
  const roster = assignRosterSlots([...picks, defensePick], { userId: 'user-1' }, players);
  const defense = roster.slots.find((slot) => slot.id === 'DEF1').player;
  assert.equal(defense.name, 'New England Patriots');
  assert.equal(defense.valueCoverage, 'not_in_player_values');
});

test('builds user and slot choices and resolves persisted selection', () => {
  const options = buildTeamOptions(users, draft);
  assert.equal(options.userOptions[0].label, 'Leo · Slot 1');
  assert.equal(options.userOptions[0].rosterId, '11');
  assert.equal(options.slotOptions.length, 4);
  assert.equal(options.slotOptions[2].rosterId, '33');
  assert.deepEqual(resolveTeamSelection('user:user-1', users, draft), options.userOptions[0]);
  assert.equal(resolveTeamSelection('slot:3', users, draft).draftSlot, 3);
  assert.equal(resolveTeamSelection('missing', users, draft).draftSlot, null);
});

test('prefers live drafting, then pre-draft, before completed selections', () => {
  const drafts = [
    { draft_id: '1', status: 'complete' },
    { draft_id: '2', status: 'pre_draft' },
    { draft_id: '3', status: 'drafting' },
  ];
  assert.equal(selectDraftId(drafts, '1'), '3');
  assert.equal(selectDraftId(drafts, '2'), '3');
  assert.equal(selectDraftId(drafts, '9'), '3');
  assert.equal(selectDraftId(drafts.filter((item) => item.status !== 'drafting'), ''), '2');
  assert.equal(selectDraftId([
    { draft_id: '1', status: 'complete' },
    { draft_id: '4', status: 'complete' },
  ], '4'), '4');
  assert.equal(selectDraftId([], ''), '');
});

test('calculates snake pick positions and next-pick status', () => {
  assert.equal(pickNumberForRound(1, 2, 4, 'snake'), 2);
  assert.equal(pickNumberForRound(2, 2, 4, 'snake'), 7);
  assert.equal(pickNumberForRound(2, 2, 4, 'linear'), 6);
  const status = nextPickStatus(picks.slice(0, 3), draft, { draftSlot: 1 });
  assert.deepEqual(status, { complete: false, currentPick: 3, nextPick: 8, picksAway: 4, onClock: false });
  assert.deepEqual(nextPickStatus([], { ...draft, status: 'pre_draft' }, { draftSlot: 1 }), {
    unsupported: true,
    reason: 'draft has not started',
  });
  assert.deepEqual(nextPickStatus([], { ...draft, type: 'auction' }, { draftSlot: 1 }), {
    unsupported: true,
    reason: 'auction draft',
  });
  assert.deepEqual(nextPickStatus([], { ...draft, settings: { ...draft.settings, reversal_round: 3 } }, { draftSlot: 1 }), {
    unsupported: true,
    reason: 'custom reversal draft',
  });
});

test('storage helpers persist preferences and cache valid picks safely', () => {
  const storage = memoryStorage();
  assert.equal(storageGet(storage, 'league', 'fallback'), 'fallback');
  assert.equal(storageSet(storage, 'league', '123'), true);
  assert.equal(storageGet(storage, 'league'), '123');

  assert.equal(saveCachedPicks(storage, 'draft-1', picks, 42, { draft, users }), true);
  assert.deepEqual(loadCachedPicks(storage, 'draft-1'), {
    picks,
    invalidCount: 0,
    savedAt: 42,
    draft,
    users,
  });
  storage.setItem('fantasyDraft.cache.partial', JSON.stringify({
    picks: [picks[0], { pick_no: 0, player_id: '' }],
    savedAt: 41,
  }));
  assert.equal(loadCachedPicks(storage, 'partial').invalidCount, 1);
  storage.setItem('fantasyDraft.cache.invalid', '{bad json');
  assert.equal(loadCachedPicks(storage, 'invalid'), null);
  assert.equal(storageRemove(storage, 'league'), true);
  assert.equal(storageGet(storage, 'league', 'gone'), 'gone');
});
