export const players = [
  {
    playerKey: 'alpha-wr', sleeperId: '101', name: 'Alpha Receiver', position: 'WR', team: 'BUF',
    overallRank: 3, beerPlus: 8.5, fantasyProsDynastyEcr2026: 2.5,
  },
  {
    playerKey: 'beta-rb', sleeperId: '102', name: 'Beta Runner Jr.', aliases: ['Beta Runner'], position: 'RB', team: 'DET',
    overallRank: 1, beerPlus: 9.2, fantasyProsDynastyEcr2026: 18.2,
  },
  {
    playerKey: 'gamma-qb', sleeperId: '103', name: 'Gamma Quarterback', position: 'QB', team: 'KC',
    overallRank: 2, beerPlus: 5.1, fantasyProsDynastyEcr2026: 1.4,
  },
  {
    playerKey: 'delta-te', sleeperId: '104', name: 'Delta Tight End', position: 'TE', team: 'SF',
    overallRank: 4, beerPlus: 4.2, fantasyProsDynastyEcr2026: 42.7,
  },
];

export const picks = [
  { pick_no: 1, draft_slot: 2, roster_id: 22, picked_by: 'user-2', player_id: '102', metadata: { first_name: 'Beta', last_name: 'Runner', position: 'RB', team: 'DET' } },
  { pick_no: 2, draft_slot: 1, roster_id: 11, picked_by: 'user-1', player_id: '103', metadata: { first_name: 'Gamma', last_name: 'Quarterback', position: 'QB', team: 'KC' } },
  { pick_no: 3, draft_slot: 1, roster_id: 11, picked_by: 'user-1', player_id: '201', metadata: { first_name: 'Test', last_name: 'Kicker', position: 'K', team: 'NE' } },
  { pick_no: 4, draft_slot: 1, roster_id: 11, picked_by: 'user-1', player_id: '104', metadata: { first_name: 'Delta', last_name: 'Tight End', position: 'TE', team: 'SF' } },
  { pick_no: 5, draft_slot: 1, roster_id: 11, picked_by: 'user-1', player_id: '101', metadata: { first_name: 'Alpha', last_name: 'Receiver', position: 'WR', team: 'BUF' } },
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
  slot_to_roster_id: { 1: 11, 2: 22, 3: 33, 4: 44 },
};


// Reduced copies of the live September 6, 2026 responses that exposed two
// separate API behaviors: account drafts omit standalone mocks, while direct
// draft lookup returns them normally.
export const accountDraftsWithoutStandaloneMock = [
  {
    draft_id: '1399079538746503168',
    league_id: '1399079538184421376',
    season: '2026',
    sport: 'nfl',
    status: 'pre_draft',
  },
  {
    draft_id: '1389358867212664832',
    league_id: '1389358867208470528',
    season: '2026',
    sport: 'nfl',
    status: 'pre_draft',
  },
];

export const standaloneLeagueMock = {
  draft_id: '1402187277609803776',
  league_id: null,
  metadata: {
    league_id: '1389358867208470528',
    name: 'DSig All Stars',
    type: 'league_mock',
  },
  season: '2026',
  sport: 'nfl',
  status: 'drafting',
  settings: { teams: 12, rounds: 15 },
};
