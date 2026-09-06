import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const dataUrl = new URL('../site/fantasy/data/player-values.json', import.meta.url);
const data = JSON.parse(await readFile(dataUrl, 'utf8'));

const numericFields = [
  'overallRank',
  'positionRank',
  'beerPlus',
  'fantasyProsId',
  'fantasyProsDynastyEcr2026',
  'keeperRound3RankEdgeMin',
  'keeperRound3RankEdgeMax',
  'keeperRound4RankEdgeMin',
  'keeperRound4RankEdgeMax',
];

const removedSyntheticFields = [
  'predicted2027RankMedian',
  'predicted2028RankMedian',
  'keeperProbabilityRound3',
  'keeperProbabilityRound4',
  'keeperSurplus2027Round3',
  'keeperSurplus2027Round4',
  'keeperSurplus2028Round3',
  'keeperSurplus2028Round4',
  'keeperSurplusTotalRound3',
  'keeperSurplusTotalRound4',
  'keeperOption2027',
  'keeperOption2028',
  'keeperOptionTotal',
  'keeperOptionTotalDiscount40',
  'keeperOptionTotalDiscount80',
  'secondYearProbabilityGivenRound3',
  'secondYearProbabilityGivenRound4',
];

function expectedComparison(rank, [firstPick, lastPick]) {
  if (rank < firstPick) return 'aheadOfRound';
  if (rank <= lastPick) return 'withinRound';
  return 'behindRound';
}

test('contains the complete 219-player board with unique source identities', () => {
  assert.equal(data.metadata.rowCount, 219);
  assert.equal(data.players.length, 219);
  assert.equal(new Set(data.players.map(({ modelKey }) => modelKey)).size, 219);
  assert.equal(new Set(data.players.map(({ fantasyProsId }) => fantasyProsId)).size, 219);
  assert.ok(data.players.every(({ name }) => typeof name === 'string' && name.length > 0));
  assert.ok(data.players.every(({ position }) => ['QB', 'RB', 'WR', 'TE'].includes(position)));
  assert.deepEqual(
    data.players.map(({ overallRank }) => overallRank).sort((a, b) => a - b),
    Array.from({ length: 219 }, (_, index) => index + 1),
  );
});

test('all current and direct dynasty fields are populated and finite', () => {
  for (const player of data.players) {
    for (const field of numericFields) {
      assert.equal(typeof player[field], 'number', `${player.name} has a non-numeric ${field}`);
      assert.ok(Number.isFinite(player[field]), `${player.name} has a non-finite ${field}`);
    }
  }
});

test('keeper comparisons are deterministic functions of visible ranks', () => {
  const round3 = data.metadata.keeperComparison.round3PickRange;
  const round4 = data.metadata.keeperComparison.round4PickRange;
  assert.deepEqual(round3, [25, 36]);
  assert.deepEqual(round4, [37, 48]);

  for (const player of data.players) {
    const rank = player.fantasyProsDynastyEcr2026;
    assert.equal(player.keeperRound3RankEdgeMin, Number((round3[0] - rank).toFixed(2)));
    assert.equal(player.keeperRound3RankEdgeMax, Number((round3[1] - rank).toFixed(2)));
    assert.equal(player.keeperRound4RankEdgeMin, Number((round4[0] - rank).toFixed(2)));
    assert.equal(player.keeperRound4RankEdgeMax, Number((round4[1] - rank).toFixed(2)));
    assert.equal(player.keeperRound3Comparison, expectedComparison(rank, round3));
    assert.equal(player.keeperRound4Comparison, expectedComparison(rank, round4));
  }
});

test('direct dynasty source and scoring-format limitation are explicit', () => {
  const source = data.metadata.sources.dynastyRanking;
  assert.equal(source.provider, 'FantasyPros');
  assert.equal(source.dataset, 'DynastyProcess db_fpecr_latest.csv');
  assert.equal(source.pageType, 'dynasty-overall');
  assert.equal(source.sourcePage, '/nfl/rankings/dynasty-overall.php');
  assert.equal(source.snapshotDate, '2026-09-04');
  assert.equal(source.matchedPlayers, 219);
  assert.match(source.scoringFormat, /not identified/i);
  assert.match(data.metadata.keeperComparison.method, /No forecast, simulation, probability, or multi-year weighting/i);
});

test('synthetic future-rank and Monte Carlo outputs are removed for every player', () => {
  assert.equal(Object.hasOwn(data.metadata, 'model'), false);
  for (const player of data.players) {
    for (const field of removedSyntheticFields) {
      assert.equal(Object.hasOwn(player, field), false, `${player.name} still has ${field}`);
    }
  }
});

test('top-24 players retain direct dynasty keeper comparisons', () => {
  const top24 = data.players.filter(({ overallRank }) => overallRank <= 24);
  assert.equal(top24.length, 24);
  assert.deepEqual(
    top24.map(({ overallRank }) => overallRank).sort((a, b) => a - b),
    Array.from({ length: 24 }, (_, index) => index + 1),
  );
  for (const player of top24) {
    assert.ok(Number.isFinite(player.fantasyProsDynastyEcr2026));
    assert.ok(Number.isFinite(player.keeperRound3RankEdgeMin));
    assert.ok(Number.isFinite(player.keeperRound4RankEdgeMin));
  }
});

test('Sleeper ID coverage is exactly reported', () => {
  const matched = data.players.filter(({ sleeperId }) => sleeperId !== null).length;
  const unmatched = data.players.filter(({ sleeperId }) => sleeperId === null);
  const coverage = data.metadata.sleeperIdCoverage;

  assert.equal(matched, 219);
  assert.equal(unmatched.length, 0);
  assert.equal(coverage.matched, matched);
  assert.equal(coverage.unmatched, unmatched.length);
  assert.equal(coverage.percent, 100);
  assert.deepEqual(coverage.matchMethods, { fantasyProsId: 219 });
  assert.deepEqual(coverage.matchSeasons, { 2026: 219 });
  assert.deepEqual(coverage.unmatchedPlayers, []);
  assert.ok(data.players.every(({ sleeperMatchSeason }) => sleeperMatchSeason === 2026));
  assert.equal(new Set(data.players.map(({ sleeperId }) => sleeperId)).size, 219);
});
