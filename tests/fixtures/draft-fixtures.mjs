export const players = [
  {
    playerKey: 'alpha-wr', sleeperId: '101', name: 'Alpha Receiver', position: 'WR', team: 'BUF',
    overallRank: 3, beerPlus: 8.5, keeperOptionTotal: 1.4, keeperSurplusTotalRound3: 1.1, keeperSurplusTotalRound4: 1.7,
  },
  {
    playerKey: 'beta-rb', sleeperId: '102', name: 'Beta Runner Jr.', aliases: ['Beta Runner'], position: 'RB', team: 'DET',
    overallRank: 1, beerPlus: 9.2, keeperOptionTotal: 0.8, keeperSurplusTotalRound3: 0.5, keeperSurplusTotalRound4: 1.1,
  },
  {
    playerKey: 'gamma-qb', sleeperId: '103', name: 'Gamma Quarterback', position: 'QB', team: 'KC',
    overallRank: 2, beerPlus: 5.1, keeperOptionTotal: 2.1, keeperSurplusTotalRound3: 1.8, keeperSurplusTotalRound4: 2.4,
  },
  {
    playerKey: 'delta-te', sleeperId: '104', name: 'Delta Tight End', position: 'TE', team: 'SF',
    overallRank: 4, beerPlus: 4.2, keeperOptionTotal: 0.4, keeperSurplusTotalRound3: 0.2, keeperSurplusTotalRound4: 0.6,
  },
];

export const picks = [
  { pick_no: 1, draft_slot: 2, picked_by: 'user-2', player_id: '102', metadata: { first_name: 'Beta', last_name: 'Runner', position: 'RB', team: 'DET' } },
  { pick_no: 2, draft_slot: 1, picked_by: 'user-1', player_id: '103', metadata: { first_name: 'Gamma', last_name: 'Quarterback', position: 'QB', team: 'KC' } },
  { pick_no: 3, draft_slot: 1, picked_by: 'user-1', player_id: '201', metadata: { first_name: 'Test', last_name: 'Kicker', position: 'K', team: 'NE' } },
  { pick_no: 4, draft_slot: 1, picked_by: 'user-1', player_id: '104', metadata: { first_name: 'Delta', last_name: 'Tight End', position: 'TE', team: 'SF' } },
  { pick_no: 5, draft_slot: 1, picked_by: 'user-1', player_id: '101', metadata: { first_name: 'Alpha', last_name: 'Receiver', position: 'WR', team: 'BUF' } },
];

export const users = [
  { user_id: 'user-1', display_name: 'Leo' },
  { user_id: 'user-2', display_name: 'Opponent' },
];

export const draft = {
  draft_id: '123456789',
  status: 'drafting',
  type: 'snake',
  settings: { teams: 4, rounds: 4 },
  draft_order: { 'user-1': 1, 'user-2': 2 },
};
