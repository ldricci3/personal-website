import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const dataUrl = new URL('../site/fantasy/data/player-values.json', import.meta.url);
const data = JSON.parse(await readFile(dataUrl, 'utf8'));

const modelNumericFields = [
  'overallRank',
  'positionRank',
  'beerPlus',
  'fantasyProsRedraftEcr2026',
  'fantasyProsDynastyEcr2026',
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

const probabilityFields = [
  'keeperProbabilityRound3',
  'keeperProbabilityRound4',
  'secondYearProbabilityGivenRound3',
  'secondYearProbabilityGivenRound4',
];

test('contains the complete 219-player model output with unique keys', () => {
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

test('all calibrated numeric model columns are populated and finite', () => {
  for (const player of data.players) {
    for (const field of modelNumericFields) {
      assert.equal(
        typeof player[field],
        'number',
        `${player.name} has a non-numeric ${field}`,
      );
      assert.ok(Number.isFinite(player[field]), `${player.name} has a non-finite ${field}`);
    }
  }
});

test('all probability outputs are bounded', () => {
  for (const player of data.players) {
    for (const field of probabilityFields) {
      assert.ok(
        player[field] >= 0 && player[field] <= 1,
        `${player.name} has out-of-range ${field}: ${player[field]}`,
      );
    }
  }
});

test('the original top 24 all have full forecast and surplus outputs', () => {
  const top24 = data.players.filter(({ overallRank }) => overallRank <= 24);
  assert.equal(top24.length, 24);
  assert.deepEqual(
    top24.map(({ overallRank }) => overallRank).sort((a, b) => a - b),
    Array.from({ length: 24 }, (_, index) => index + 1),
  );
  for (const player of top24) {
    for (const field of modelNumericFields) {
      assert.ok(Number.isFinite(player[field]), `${player.name} is missing ${field}`);
    }
    assert.notEqual(player.modelCoverage, 'ineligible_rounds_1_2');
    assert.notEqual(player.modelConfidence, 'not_applicable');
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
