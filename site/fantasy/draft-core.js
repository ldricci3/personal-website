export const ROSTER_SLOTS = Object.freeze([
  { id: 'QB1', label: 'QB', accepts: ['QB'] },
  { id: 'RB1', label: 'RB', accepts: ['RB'] },
  { id: 'RB2', label: 'RB', accepts: ['RB'] },
  { id: 'WR1', label: 'WR', accepts: ['WR'] },
  { id: 'WR2', label: 'WR', accepts: ['WR'] },
  { id: 'TE1', label: 'TE', accepts: ['TE'] },
  { id: 'FLEX1', label: 'FLEX', accepts: ['RB', 'WR', 'TE'] },
  { id: 'FLEX2', label: 'FLEX', accepts: ['RB', 'WR', 'TE'] },
  { id: 'K1', label: 'K', accepts: ['K'] },
  { id: 'DEF1', label: 'DEF', accepts: ['DEF'] },
  ...Array.from({ length: 5 }, (_, index) => ({
    id: `BENCH${index + 1}`,
    label: 'BN',
    accepts: ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'],
  })),
]);

const TEAM_ALIASES = Object.freeze({
  JAX: 'JAC',
  LV: 'LVR',
  OAK: 'LVR',
  SD: 'LAC',
  STL: 'LAR',
  WSH: 'WAS',
});

const SORTERS = Object.freeze({
  rank: (a, b) => numeric(a.overallRank, Number.MAX_SAFE_INTEGER) - numeric(b.overallRank, Number.MAX_SAFE_INTEGER),
  beer: (a, b) => numeric(b.beerPlus) - numeric(a.beerPlus),
  dynasty: (a, b) => numeric(a.fantasyProsDynastyEcr2026, Number.MAX_SAFE_INTEGER)
    - numeric(b.fantasyProsDynastyEcr2026, Number.MAX_SAFE_INTEGER),
});

function numeric(value, fallback = 0) {
  if (value === null || value === undefined || value === '') return fallback;
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

export function normalizePosition(position) {
  const normalized = String(position ?? '').trim().toUpperCase();
  return normalized === 'DST' || normalized === 'D/ST' ? 'DEF' : normalized;
}

export function normalizeTeam(team) {
  const normalized = String(team ?? '').trim().toUpperCase();
  return TEAM_ALIASES[normalized] ?? normalized;
}

export function normalizeName(name) {
  return String(name ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\b(jr|sr|ii|iii|iv)\b\.?/g, '')
    .replace(/[^a-z0-9]/g, '');
}

export function isValidSleeperId(value) {
  return /^\d{1,30}$/.test(String(value ?? '').trim());
}

export function normalizeSleeperAccountInput(value) {
  return String(value ?? '').trim();
}

export function isValidSleeperAccountInput(value) {
  const input = normalizeSleeperAccountInput(value);
  if (!input || input.length > 64) return false;
  if (isValidSleeperId(input)) return true;
  return !/[\s/?#\u0000-\u001f\u007f]/.test(input);
}

export function normalizeSleeperAccount(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload) || !isValidSleeperId(payload.user_id)) {
    throw new TypeError('Sleeper did not find that account.');
  }
  return {
    ...payload,
    user_id: String(payload.user_id),
    username: String(payload.username ?? '').trim(),
    display_name: String(payload.display_name ?? payload.username ?? '').trim(),
  };
}

export function normalizeSleeperLeagues(payload, season = '2026') {
  if (!Array.isArray(payload)) throw new TypeError('Sleeper returned invalid league data.');
  const expectedSeason = String(season);
  return payload
    .filter((league) => league && typeof league === 'object' && !Array.isArray(league))
    .filter((league) => isValidSleeperId(league.league_id))
    .filter((league) => !league.sport || String(league.sport).toLowerCase() === 'nfl')
    .filter((league) => !league.season || String(league.season) === expectedSeason)
    .map((league) => ({ ...league, league_id: String(league.league_id) }));
}

export function selectLeagueId(leagues, savedLeagueId = '') {
  const saved = String(savedLeagueId ?? '');
  if (saved && leagues.some((league) => String(league.league_id) === saved)) return saved;
  return leagues.length === 1 ? String(leagues[0].league_id) : '';
}

export function normalizeSleeperDrafts(payload) {
  if (!Array.isArray(payload)) throw new TypeError('Sleeper returned invalid draft data.');
  return payload
    .filter((draft) => draft && typeof draft === 'object' && !Array.isArray(draft))
    .filter((draft) => isValidSleeperId(draft.draft_id))
    .map((draft) => ({ ...draft, draft_id: String(draft.draft_id) }));
}

export function freshSleeperPath(path, nonce = null) {
  const normalizedPath = String(path ?? '');
  if (nonce === null || nonce === undefined || nonce === '') return normalizedPath;
  const separator = normalizedPath.includes('?') ? '&' : '?';
  return `${normalizedPath}${separator}_=${encodeURIComponent(String(nonce))}`;
}

export function isStandaloneDraft(draft) {
  return Boolean(draft && typeof draft === 'object' && !Array.isArray(draft))
    && (draft.league_id === undefined || draft.league_id === null || String(draft.league_id).trim() === '');
}

export function accountLeagueStorageKey(accountId) {
  return isValidSleeperId(accountId) ? `fantasyDraft.account.${accountId}.leagueId` : '';
}

export function leagueDraftStorageKey(leagueId) {
  return isValidSleeperId(leagueId) ? `fantasyDraft.league.${leagueId}.draftId` : '';
}

export function chooseInitialConnection({ accountInput = '', manualDraftId = '', preferredMode = '' } = {}) {
  const account = normalizeSleeperAccountInput(accountInput);
  const mock = String(manualDraftId ?? '').trim();
  const hasAccount = isValidSleeperAccountInput(account);
  const hasMock = isValidSleeperId(mock);
  if (preferredMode === 'manual' && hasMock) return { mode: 'manual', value: mock };
  if (preferredMode === 'account' && hasAccount) return { mode: 'account', value: account };
  if (hasAccount) return { mode: 'account', value: account };
  if (hasMock) return { mode: 'manual', value: mock };
  return { mode: 'none', value: '' };
}

export function createContextGate() {
  let generation = 0;
  return Object.freeze({
    begin() {
      generation += 1;
      return generation;
    },
    isCurrent(candidate) {
      return candidate === generation;
    },
  });
}

export function isValidDraftPick(pick) {
  if (!pick || typeof pick !== 'object' || Array.isArray(pick)) return false;
  const pickNumber = Number(pick.pick_no);
  const playerId = String(pick.player_id ?? '').trim();
  return Number.isInteger(pickNumber) && pickNumber > 0 && playerId.length > 0 && playerId.length <= 64;
}

export function normalizeDraftPicks(payload) {
  if (!Array.isArray(payload)) throw new TypeError('Sleeper returned invalid pick data.');
  const picks = payload.filter(isValidDraftPick);
  if (payload.length > 0 && picks.length === 0) throw new TypeError('Sleeper returned invalid pick data.');
  return { picks, invalidCount: payload.length - picks.length };
}

export function draftPicksSignature(picks = []) {
  return picks
    .map((pick) => [pick.pick_no, pick.player_id, pick.roster_id, pick.picked_by, pick.draft_slot]
      .map((value) => String(value ?? '')).join(':'))
    .sort()
    .join('|');
}

export function metadataName(pick) {
  const metadata = pick?.metadata ?? {};
  return metadata.player_name
    || metadata.full_name
    || [metadata.first_name, metadata.last_name].filter(Boolean).join(' ')
    || pick?.player_name
    || '';
}

export function pickMatchesPlayer(pick, player) {
  const pickId = String(pick?.player_id ?? '').trim();
  const sleeperId = String(player?.sleeperId ?? '').trim();
  if (pickId && sleeperId) return pickId === sleeperId;

  const pickName = normalizeName(metadataName(pick));
  if (!pickName) return false;
  const aliases = [player?.name, ...(player?.aliases ?? [])].map(normalizeName);
  if (!aliases.includes(pickName)) return false;

  const pickPosition = normalizePosition(pick?.metadata?.position ?? pick?.position);
  const playerPosition = normalizePosition(player?.position);
  if (pickPosition && playerPosition && pickPosition !== playerPosition) return false;

  const pickTeam = normalizeTeam(pick?.metadata?.team ?? pick?.team);
  const playerTeam = normalizeTeam(player?.team);
  return !pickTeam || !playerTeam || pickTeam === playerTeam;
}

export function playerKey(player) {
  return player?.playerKey
    || player?.modelKey
    || (player?.sleeperId ? `sleeper:${player.sleeperId}` : `${normalizeName(player?.name)}:${normalizePosition(player?.position)}`);
}

export function getPickedPlayerKeys(players, picks) {
  const picked = new Set();
  const playersBySleeperId = new Map(
    players.filter((player) => player?.sleeperId).map((player) => [String(player.sleeperId), player]),
  );
  const playersWithoutIds = players.filter((player) => !player?.sleeperId);

  for (const pick of picks) {
    const pickId = String(pick?.player_id ?? '').trim();
    if (pickId) {
      const player = playersBySleeperId.get(pickId);
      if (player) picked.add(playerKey(player));
      for (const playerWithoutId of playersWithoutIds) {
        if (pickMatchesPlayer(pick, playerWithoutId)) picked.add(playerKey(playerWithoutId));
      }
      continue;
    }
    for (const player of players) {
      if (pickMatchesPlayer(pick, player)) picked.add(playerKey(player));
    }
  }
  return picked;
}

export function filterAndSortPlayers(players, options = {}) {
  const {
    search = '',
    position = 'ALL',
    sortBy = 'rank',
    showDrafted = false,
    picks = [],
    pickedKeys: suppliedPickedKeys = null,
  } = options;
  const query = normalizeName(search);
  const pickedKeys = suppliedPickedKeys instanceof Set ? suppliedPickedKeys : getPickedPlayerKeys(players, picks);

  return players
    .filter((player) => position === 'ALL' || normalizePosition(player.position) === normalizePosition(position))
    .filter((player) => !query || normalizeName(`${player.name} ${player.team} ${player.position}`).includes(query))
    .map((player) => ({ ...player, drafted: pickedKeys.has(playerKey(player)) }))
    .filter((player) => showDrafted || !player.drafted)
    .sort((a, b) => {
      const primary = (SORTERS[sortBy] ?? SORTERS.rank)(a, b);
      return primary || SORTERS.rank(a, b) || String(a.name).localeCompare(String(b.name));
    });
}

export function playerFromPick(pick, playerIndex = new Map(), players = []) {
  const sleeperId = String(pick?.player_id ?? '');
  const modelPlayer = playerIndex.get(sleeperId)
    ?? players.find((player) => pickMatchesPlayer(pick, player));
  if (modelPlayer) {
    return { ...modelPlayer, pickNumber: numeric(pick.pick_no), rawPick: pick };
  }

  const metadata = pick?.metadata ?? {};
  return {
    playerKey: `sleeper:${sleeperId || `pick-${pick?.pick_no ?? 'unknown'}`}`,
    sleeperId: sleeperId || null,
    name: metadataName(pick) || 'Unknown player',
    position: normalizePosition(metadata.position ?? pick?.position),
    team: String(metadata.team ?? pick?.team ?? '').toUpperCase(),
    beerPlus: null,
    fantasyProsDynastyEcr2026: null,
    valueCoverage: 'not_in_player_values',
    pickNumber: numeric(pick?.pick_no),
    rawPick: pick,
  };
}

export function pickBelongsToSelection(pick, selection = {}) {
  const selectedRosterId = String(selection.rosterId ?? '').trim();
  const pickRosterId = String(pick?.roster_id ?? '').trim();
  if (selectedRosterId && pickRosterId) return selectedRosterId === pickRosterId;

  // Older/mock payloads may omit roster_id. Fall back only when one side lacks it.
  if (selection.userId && pick?.picked_by) {
    return String(pick.picked_by) === String(selection.userId);
  }
  if (selection.draftSlot && pick?.draft_slot !== undefined && pick?.draft_slot !== null) {
    return numeric(pick.draft_slot) === numeric(selection.draftSlot);
  }
  return false;
}

export function assignRosterSlots(picks, selection = {}, players = []) {
  const playerIndex = new Map(
    players.filter((player) => player.sleeperId).map((player) => [String(player.sleeperId), player]),
  );
  const selectedPicks = picks
    .filter((pick) => pickBelongsToSelection(pick, selection))
    .sort((a, b) => numeric(a.pick_no) - numeric(b.pick_no));
  const slots = ROSTER_SLOTS.map((slot) => ({ ...slot, player: null }));
  const extras = [];

  for (const pick of selectedPicks) {
    const player = playerFromPick(pick, playerIndex, players);
    const position = normalizePosition(player.position);
    const openSlot = slots.find((slot) => !slot.player && slot.accepts.includes(position));
    if (openSlot) openSlot.player = player;
    else extras.push(player);
  }

  return { slots, extras, pickCount: selectedPicks.length };
}

export function selectDraftId(drafts, savedDraftId = '') {
  const saved = String(savedDraftId ?? '');
  const savedDraft = saved ? drafts.find((draft) => String(draft.draft_id) === saved) : null;
  const drafting = drafts.find((draft) => draft.status === 'drafting');
  if (drafting) return String(drafting.draft_id);
  if (savedDraft?.status === 'pre_draft') return saved;
  const upcoming = drafts.find((draft) => draft.status === 'pre_draft');
  if (upcoming) return String(upcoming.draft_id);
  if (savedDraft) return saved;
  return drafts[0] ? String(drafts[0].draft_id) : '';
}

export function buildTeamOptions(users = [], draft = {}) {
  const order = draft?.draft_order ?? {};
  const slotToRoster = draft?.slot_to_roster_id ?? {};
  const teams = numeric(draft?.settings?.teams, Math.max(Object.keys(order).length, 12));
  const rosterIdForSlot = (slot) => {
    const rosterId = slot ? slotToRoster[String(slot)] ?? slotToRoster[slot] : null;
    return rosterId === undefined || rosterId === null || rosterId === '' ? null : String(rosterId);
  };
  const userOptions = users.map((user) => {
    const slot = numeric(order[user.user_id]) || null;
    const displayName = user.display_name || user.username || `User ${user.user_id}`;
    return {
      value: `user:${user.user_id}`,
      label: slot ? `${displayName} · Slot ${slot}` : displayName,
      userId: String(user.user_id),
      draftSlot: slot,
      rosterId: rosterIdForSlot(slot),
    };
  });
  const slotOptions = Array.from({ length: teams }, (_, index) => ({
    value: `slot:${index + 1}`,
    label: `Draft slot ${index + 1}`,
    userId: null,
    draftSlot: index + 1,
    rosterId: rosterIdForSlot(index + 1),
  }));
  return { userOptions, slotOptions };
}

export function resolveTeamSelection(value, users = [], draft = {}) {
  const { userOptions, slotOptions } = buildTeamOptions(users, draft);
  return [...userOptions, ...slotOptions].find((option) => option.value === value)
    ?? { value: '', label: '', userId: null, draftSlot: null, rosterId: null };
}

export function pickNumberForRound(round, slot, teams, draftType = 'snake') {
  const roundNumber = numeric(round);
  const slotNumber = numeric(slot);
  const teamCount = numeric(teams);
  if (roundNumber < 1 || slotNumber < 1 || slotNumber > teamCount || teamCount < 1) return null;
  const roundOffset = (roundNumber - 1) * teamCount;
  const isSnakeReverse = draftType === 'snake' && roundNumber % 2 === 0;
  return roundOffset + (isSnakeReverse ? teamCount - slotNumber + 1 : slotNumber);
}

export function nextPickStatus(picks, draft = {}, selection = {}) {
  const slot = numeric(selection.draftSlot);
  const teams = numeric(draft?.settings?.teams);
  const rounds = numeric(draft?.settings?.rounds);
  if (!slot || !teams || !rounds) return null;
  const status = String(draft?.status ?? '').toLowerCase();
  if (status === 'pre_draft') {
    return { unsupported: true, reason: 'draft has not started' };
  }
  const type = String(draft?.type || 'snake').toLowerCase();
  if (!['snake', 'linear'].includes(type)) {
    return { unsupported: true, reason: `${type || 'unknown'} draft` };
  }
  if (numeric(draft?.settings?.reversal_round) > 0) {
    return { unsupported: true, reason: 'custom reversal draft' };
  }
  const currentPick = picks.reduce((max, pick) => Math.max(max, numeric(pick.pick_no)), 0);
  const future = [];
  for (let round = 1; round <= rounds; round += 1) {
    const pickNumber = pickNumberForRound(round, slot, teams, type);
    if (pickNumber > currentPick) future.push(pickNumber);
  }
  if (!future.length) return { complete: true, currentPick, nextPick: null, picksAway: null };
  const nextPick = future[0];
  return {
    complete: false,
    currentPick,
    nextPick,
    picksAway: Math.max(0, nextPick - currentPick - 1),
    onClock: nextPick === currentPick + 1,
  };
}

export function storageGet(storage, key, fallback = '') {
  try {
    const value = storage.getItem(key);
    return value === null ? fallback : value;
  } catch {
    return fallback;
  }
}

export function storageSet(storage, key, value) {
  try {
    storage.setItem(key, String(value));
    return true;
  } catch {
    return false;
  }
}

export function storageRemove(storage, key) {
  try {
    storage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}

export function loadCachedPicks(storage, draftId) {
  try {
    const raw = storage.getItem(`fantasyDraft.cache.${draftId}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!Number.isFinite(parsed.savedAt)) return null;
    const normalized = normalizeDraftPicks(parsed.picks);
    const draft = parsed.draft && isValidSleeperId(parsed.draft.draft_id) ? parsed.draft : null;
    const users = Array.isArray(parsed.users) ? parsed.users : [];
    return { ...normalized, savedAt: parsed.savedAt, draft, users };
  } catch {
    return null;
  }
}

export function saveCachedPicks(storage, draftId, picks, now = Date.now(), snapshot = {}) {
  try {
    const normalized = normalizeDraftPicks(picks);
    const draft = snapshot.draft && isValidSleeperId(snapshot.draft.draft_id) ? snapshot.draft : null;
    const users = Array.isArray(snapshot.users) ? snapshot.users : [];
    storage.setItem(`fantasyDraft.cache.${draftId}`, JSON.stringify({
      picks: normalized.picks,
      savedAt: now,
      draft,
      users,
    }));
    return true;
  } catch {
    return false;
  }
}
