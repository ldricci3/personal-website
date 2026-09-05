import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assignRosterSlots,
  buildTeamOptions,
  filterAndSortPlayers,
  isValidSleeperId,
  loadCachedPicks,
  nextPickStatus,
  normalizeName,
  normalizePosition,
  normalizeTeam,
  pickMatchesPlayer,
  pickNumberForRound,
  resolveTeamSelection,
  saveCachedPicks,
  selectDraftId,
  storageGet,
  storageSet,
} from '../site/fantasy/draft-core.js';
import { draft, picks, players, users } from './fixtures/draft-fixtures.mjs';

function memoryStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => values.set(key, String(value)),
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

test('filters by position and search, then sorts by selected value', () => {
  const byPosition = filterAndSortPlayers(players, { position: 'WR' });
  assert.deepEqual(byPosition.map((player) => player.name), ['Alpha Receiver']);

  const bySearch = filterAndSortPlayers(players, { search: 'det' });
  assert.deepEqual(bySearch.map((player) => player.name), ['Beta Runner Jr.']);

  const byKeeper = filterAndSortPlayers(players, { sortBy: 'keeperTotal' });
  assert.deepEqual(byKeeper.map((player) => player.name), [
    'Gamma Quarterback', 'Alpha Receiver', 'Beta Runner Jr.', 'Delta Tight End',
  ]);

  const byRoundThree = filterAndSortPlayers(players, { sortBy: 'keeperR3' });
  const byRoundFour = filterAndSortPlayers(players, { sortBy: 'keeperR4' });
  assert.deepEqual(byRoundThree.map((player) => player.name), byKeeper.map((player) => player.name));
  assert.deepEqual(byRoundFour.map((player) => player.name), byKeeper.map((player) => player.name));
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
  assert.equal(pickMatchesPlayer({ metadata: { ...pick.metadata, team: 'NYJ' } }, players[1]), false);
  assert.equal(
    pickMatchesPlayer(
      { metadata: { player_name: 'Alias Example', position: 'WR', team: 'JAX' } },
      { name: 'Alias Example', position: 'WR', team: 'JAC' },
    ),
    true,
  );
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

test('keeps unmatched K and DEF picks in the roster without model values', () => {
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
  assert.equal(defense.modelCoverage, 'not_in_value_model');
});

test('builds user and slot choices and resolves persisted selection', () => {
  const options = buildTeamOptions(users, draft);
  assert.equal(options.userOptions[0].label, 'Leo · Slot 1');
  assert.equal(options.slotOptions.length, 4);
  assert.deepEqual(resolveTeamSelection('user:user-1', users, draft), options.userOptions[0]);
  assert.equal(resolveTeamSelection('slot:3', users, draft).draftSlot, 3);
  assert.equal(resolveTeamSelection('missing', users, draft).draftSlot, null);
});

test('selects a persisted draft when present, otherwise prefers active drafts', () => {
  const drafts = [
    { draft_id: '1', status: 'complete' },
    { draft_id: '2', status: 'pre_draft' },
    { draft_id: '3', status: 'drafting' },
  ];
  assert.equal(selectDraftId(drafts, '1'), '1');
  assert.equal(selectDraftId(drafts, '9'), '3');
  assert.equal(selectDraftId([], ''), '');
});

test('calculates snake pick positions and next-pick status', () => {
  assert.equal(pickNumberForRound(1, 2, 4, 'snake'), 2);
  assert.equal(pickNumberForRound(2, 2, 4, 'snake'), 7);
  assert.equal(pickNumberForRound(2, 2, 4, 'linear'), 6);
  const status = nextPickStatus(picks.slice(0, 3), draft, { draftSlot: 1 });
  assert.deepEqual(status, { complete: false, currentPick: 3, nextPick: 8, picksAway: 4, onClock: false });
});

test('storage helpers persist preferences and cache valid picks safely', () => {
  const storage = memoryStorage();
  assert.equal(storageGet(storage, 'league', 'fallback'), 'fallback');
  assert.equal(storageSet(storage, 'league', '123'), true);
  assert.equal(storageGet(storage, 'league'), '123');

  assert.equal(saveCachedPicks(storage, 'draft-1', picks, 42), true);
  assert.deepEqual(loadCachedPicks(storage, 'draft-1'), { picks, savedAt: 42 });
  storage.setItem('fantasyDraft.cache.invalid', '{bad json');
  assert.equal(loadCachedPicks(storage, 'invalid'), null);
});
