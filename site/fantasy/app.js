import {
  ROSTER_SLOTS,
  assignRosterSlots,
  buildTeamOptions,
  filterAndSortPlayers,
  isValidSleeperId,
  loadCachedPicks,
  nextPickStatus,
  resolveTeamSelection,
  saveCachedPicks,
  selectDraftId,
  storageGet,
  storageSet,
} from './draft-core.js';

const API_BASE = 'https://api.sleeper.app/v1';
const POLL_INTERVAL_MS = 5_000;
const FETCH_TIMEOUT_MS = 8_000;
const STORAGE = Object.freeze({
  leagueId: 'fantasyDraft.leagueId',
  draftId: 'fantasyDraft.draftId',
  teamSelection: 'fantasyDraft.teamSelection',
  showDrafted: 'fantasyDraft.showDrafted',
  sortBy: 'fantasyDraft.sortBy',
});

const state = {
  players: [],
  metadata: {},
  picks: [],
  league: null,
  drafts: [],
  users: [],
  draft: null,
  teamSelectionValue: storageGet(localStorage, STORAGE.teamSelection),
  filters: {
    search: '',
    position: 'ALL',
    sortBy: storageGet(localStorage, STORAGE.sortBy, 'rank'),
    showDrafted: storageGet(localStorage, STORAGE.showDrafted) === 'true',
  },
  pollTimer: null,
  refreshing: false,
  lastRefreshAt: 0,
  maxBeer: 1,
  maxKeeper: 1,
};

const elements = {
  leagueId: document.querySelector('#league-id'),
  loadLeague: document.querySelector('#load-league'),
  draftSelect: document.querySelector('#draft-select'),
  draftId: document.querySelector('#draft-id'),
  loadDraft: document.querySelector('#load-draft'),
  teamSelect: document.querySelector('#team-select'),
  setup: document.querySelector('#sleeper-setup'),
  setupSummary: document.querySelector('#setup-summary'),
  setupError: document.querySelector('#setup-error'),
  manualRefresh: document.querySelector('#manual-refresh'),
  connectionDot: document.querySelector('#connection-dot'),
  connectionStatus: document.querySelector('#connection-status'),
  connectionDetail: document.querySelector('#connection-detail'),
  draftedCount: document.querySelector('#drafted-count'),
  nextPickStatus: document.querySelector('#next-pick-status'),
  search: document.querySelector('#player-search'),
  sortBy: document.querySelector('#sort-by'),
  showDrafted: document.querySelector('#show-drafted'),
  positionTabs: [...document.querySelectorAll('[data-position]')],
  playerList: document.querySelector('#player-list'),
  emptyState: document.querySelector('#empty-state'),
  loadingTemplate: document.querySelector('#loading-row-template'),
  rosterSlots: document.querySelector('#roster-slots'),
  rosterPrompt: document.querySelector('#roster-prompt'),
  rosterCount: document.querySelector('#roster-count'),
  mobileRosterCount: document.querySelector('#mobile-roster-count'),
  rosterExtras: document.querySelector('#roster-extras'),
  rosterExtrasList: document.querySelector('#roster-extras-list'),
  mobileViewButtons: [...document.querySelectorAll('[data-view]')],
  valueHelp: document.querySelector('#value-help'),
  valueHelpCopy: document.querySelector('#value-help-copy'),
};

function createElement(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined && text !== null) element.textContent = String(text);
  return element;
}

function asNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function formatValue(value, digits = 2) {
  const number = Number(value);
  if (!Number.isFinite(number)) return '—';
  return number.toFixed(digits).replace(/\.00$/, '');
}

function formatProbability(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return '—';
  return `${Math.round(number * 100)}%`;
}

function formatTimestamp(timestamp) {
  const date = new Date(timestamp);
  if (!Number.isFinite(date.getTime())) return '';
  return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(date);
}

function setConnection(kind, title, detail) {
  elements.connectionDot.className = `connection-dot ${kind}`;
  elements.connectionStatus.textContent = title;
  elements.connectionDetail.textContent = detail;
  elements.manualRefresh.classList.toggle('is-loading', kind === 'loading');
}

function setSetupError(message = '') {
  elements.setupError.textContent = message;
  elements.setupError.hidden = !message;
}

async function fetchJson(path) {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(`${API_BASE}${path}`, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: controller.signal,
      cache: 'no-store',
    });
    if (!response.ok) throw new Error(`Sleeper returned ${response.status}.`);
    return await response.json();
  } catch (error) {
    if (error.name === 'AbortError') throw new Error('Sleeper took too long to respond.');
    throw error;
  } finally {
    window.clearTimeout(timeout);
  }
}

function showPlayerLoadingRows() {
  const rows = [];
  for (let index = 0; index < 8; index += 1) {
    rows.push(elements.loadingTemplate.content.cloneNode(true));
  }
  elements.playerList.replaceChildren(...rows);
  elements.playerList.setAttribute('aria-busy', 'true');
}

async function loadPlayerValues() {
  showPlayerLoadingRows();
  const response = await fetch('./data/player-values.json', { cache: 'no-cache' });
  if (!response.ok) throw new Error('Player values could not be loaded.');
  const payload = await response.json();
  if (!Array.isArray(payload.players)) throw new Error('Player value data is invalid.');
  state.players = payload.players;
  state.metadata = payload.metadata ?? {};
  state.maxBeer = Math.max(1, ...state.players.map((player) => asNumber(player.beerPlus)));
  state.maxKeeper = Math.max(0.1, ...state.players.map((player) => asNumber(player.keeperOptionTotal)));
  renderPlayers();
  renderRoster();
}

function appendValueCell(parent, label, value, maxValue, future = false) {
  const cell = createElement('div', `value-cell${future ? ' future' : ''}`);
  const valueLabel = createElement('div', 'value-label');
  valueLabel.append(createElement('span', '', label), createElement('strong', '', formatValue(value)));
  const track = createElement('div', 'value-track');
  const fill = createElement('span', 'value-fill');
  const percent = Math.max(0, Math.min(100, (asNumber(value) / maxValue) * 100));
  fill.style.width = `${percent.toFixed(1)}%`;
  track.append(fill);
  cell.append(valueLabel, track);
  parent.append(cell);
}

function appendDetailRow(parent, label, value) {
  const row = createElement('div', 'detail-row');
  row.append(createElement('span', '', label), createElement('strong', '', value));
  parent.append(row);
}

function buildPlayerCard(player) {
  const details = createElement('details', `player-card${player.drafted ? ' drafted' : ''}`);
  const summary = createElement('summary');
  summary.append(createElement('span', 'rank-number', player.overallRank));

  const identity = createElement('div', 'player-identity');
  identity.append(createElement('span', 'player-name', player.name));
  const meta = createElement('span', 'player-meta');
  meta.append(createElement('span', 'position-pill', player.position));
  meta.append(document.createTextNode(player.team ? ` ${player.team}` : ''));
  if (player.drafted) meta.append(createElement('span', 'drafted-badge', ' · Drafted'));
  identity.append(meta);
  summary.append(identity);

  appendValueCell(summary, 'Now', player.beerPlus, state.maxBeer);
  appendValueCell(summary, 'Keeper', player.keeperOptionTotal, state.maxKeeper, true);
  summary.append(createElement('span', 'expand-indicator'));
  details.append(summary);

  const detailGrid = createElement('div', 'player-details');
  const forecast = createElement('section', 'detail-card');
  forecast.append(createElement('h3', '', 'Future rank'));
  appendDetailRow(forecast, '2027 median', formatValue(player.predicted2027RankMedian, 1));
  appendDetailRow(forecast, '2028 median', formatValue(player.predicted2028RankMedian, 1));

  const roundThree = createElement('section', 'detail-card');
  roundThree.append(createElement('h3', '', 'Round 3 keeper'));
  appendDetailRow(roundThree, '2027 probability', formatProbability(player.keeperProbabilityRound3));
  appendDetailRow(roundThree, '2027 surplus', formatValue(player.keeperSurplus2027Round3));
  appendDetailRow(roundThree, '2028 surplus', formatValue(player.keeperSurplus2028Round3));
  appendDetailRow(roundThree, '2nd-year chance', formatProbability(player.secondYearProbabilityGivenRound3));
  appendDetailRow(roundThree, '2-year option', formatValue(player.keeperSurplusTotalRound3));

  const roundFour = createElement('section', 'detail-card');
  roundFour.append(createElement('h3', '', 'Round 4 keeper'));
  appendDetailRow(roundFour, '2027 probability', formatProbability(player.keeperProbabilityRound4));
  appendDetailRow(roundFour, '2027 surplus', formatValue(player.keeperSurplus2027Round4));
  appendDetailRow(roundFour, '2028 surplus', formatValue(player.keeperSurplus2028Round4));
  appendDetailRow(roundFour, '2nd-year chance', formatProbability(player.secondYearProbabilityGivenRound4));
  appendDetailRow(roundFour, '2-year option', formatValue(player.keeperSurplusTotalRound4));

  const composite = createElement('section', 'detail-card');
  composite.append(createElement('h3', '', 'Neutral composite'));
  appendDetailRow(composite, '2027 option', formatValue(player.keeperOption2027));
  appendDetailRow(composite, '2028 option', formatValue(player.keeperOption2028));
  appendDetailRow(composite, 'Total option', formatValue(player.keeperOptionTotal));

  detailGrid.append(forecast, roundThree, roundFour, composite);
  const confidence = player.modelConfidence || 'not reported';
  detailGrid.append(createElement('p', 'confidence-note', `Model confidence: ${confidence}. Keeper value is conditional on being drafted after Round 2.`));
  details.append(detailGrid);
  return details;
}

function renderPlayers() {
  if (!state.players.length) return;
  const players = filterAndSortPlayers(state.players, { ...state.filters, picks: state.picks });
  const fragment = document.createDocumentFragment();
  for (const player of players) fragment.append(buildPlayerCard(player));
  elements.playerList.replaceChildren(fragment);
  elements.playerList.setAttribute('aria-busy', 'false');
  elements.emptyState.hidden = players.length > 0;
}

function renderRosterPlayer(slot, player) {
  const row = createElement('div', 'roster-slot');
  row.append(createElement('span', 'slot-label', slot.label));
  const content = createElement('div', 'slot-player');
  if (!player) {
    content.append(createElement('span', 'slot-empty', 'Open'));
  } else {
    content.append(createElement('strong', '', player.name));
    const values = Number.isFinite(Number(player.beerPlus))
      ? `${player.position} · ${player.team || 'FA'} · BEER+ ${formatValue(player.beerPlus)}`
      : `${player.position || '—'} · ${player.team || 'FA'} · No model value`;
    content.append(createElement('span', '', values));
  }
  row.append(content);
  return row;
}

function renderRoster() {
  const selection = resolveTeamSelection(state.teamSelectionValue, state.users, state.draft ?? {});
  const roster = assignRosterSlots(state.picks, selection, state.players);
  const fragment = document.createDocumentFragment();
  for (const slot of roster.slots) fragment.append(renderRosterPlayer(slot, slot.player));
  elements.rosterSlots.replaceChildren(fragment);
  elements.rosterCount.textContent = `${Math.min(roster.pickCount, 15)} / 15`;
  elements.mobileRosterCount.textContent = String(roster.pickCount);
  elements.rosterPrompt.hidden = Boolean(selection.userId || selection.draftSlot);

  const extrasFragment = document.createDocumentFragment();
  for (const player of roster.extras) {
    const item = createElement('p', 'roster-prompt', `${player.name} · ${player.position || '—'}`);
    extrasFragment.append(item);
  }
  elements.rosterExtrasList.replaceChildren(extrasFragment);
  elements.rosterExtras.hidden = roster.extras.length === 0;
  renderNextPick(selection);
}

function renderNextPick(selection = resolveTeamSelection(state.teamSelectionValue, state.users, state.draft ?? {})) {
  const status = nextPickStatus(state.picks, state.draft ?? {}, selection);
  if (!status) {
    elements.nextPickStatus.textContent = state.draft ? 'Select your team' : 'No team selected';
  } else if (status.complete) {
    elements.nextPickStatus.textContent = 'Your picks are complete';
  } else if (status.onClock) {
    elements.nextPickStatus.textContent = 'You are on the clock';
  } else {
    elements.nextPickStatus.textContent = `${status.picksAway} pick${status.picksAway === 1 ? '' : 's'} until #${status.nextPick}`;
  }
}

function renderDraftSelect(preferredDraftId = '') {
  const select = elements.draftSelect;
  const selectedId = selectDraftId(state.drafts, preferredDraftId);
  const placeholder = createElement('option', '', state.drafts.length ? 'Choose a league draft' : 'No drafts found');
  placeholder.value = '';
  select.replaceChildren(placeholder);

  for (const draft of state.drafts) {
    const option = createElement('option');
    option.value = String(draft.draft_id);
    const name = draft.metadata?.name || draft.season || 'Sleeper draft';
    const status = String(draft.status || '').replace('_', ' ');
    option.textContent = `${name}${status ? ` · ${status}` : ''}`;
    select.append(option);
  }
  select.disabled = state.drafts.length === 0;
  select.value = selectedId;
  return selectedId;
}

function renderTeamSelect() {
  const select = elements.teamSelect;
  const { userOptions, slotOptions } = buildTeamOptions(state.users, state.draft ?? {});
  const placeholder = createElement('option', '', 'Choose your team or slot');
  placeholder.value = '';
  select.replaceChildren(placeholder);

  if (userOptions.length) {
    const group = createElement('optgroup');
    group.label = 'League users';
    for (const optionData of userOptions) {
      const option = createElement('option', '', optionData.label);
      option.value = optionData.value;
      group.append(option);
    }
    select.append(group);
  }

  const slotGroup = createElement('optgroup');
  slotGroup.label = 'Draft slots';
  for (const optionData of slotOptions) {
    const option = createElement('option', '', optionData.label);
    option.value = optionData.value;
    slotGroup.append(option);
  }
  select.append(slotGroup);
  select.disabled = !state.draft;

  const validSelections = new Set([...userOptions, ...slotOptions].map((option) => option.value));
  if (!validSelections.has(state.teamSelectionValue)) state.teamSelectionValue = '';
  select.value = state.teamSelectionValue;
  renderRoster();
}

function renderDraftState() {
  elements.draftedCount.textContent = String(state.picks.length);
  if (!state.draft) {
    elements.setupSummary.textContent = state.league ? state.league.name || 'League loaded' : 'Not connected';
    return;
  }
  const draftName = state.draft.metadata?.name || `${state.draft.season || ''} draft`.trim() || 'Sleeper draft';
  elements.setupSummary.textContent = `${draftName} · ${state.draft.status || 'unknown status'}`;
}

function applyPicks(picks, source, savedAt = Date.now()) {
  state.picks = Array.isArray(picks) ? picks : [];
  state.lastRefreshAt = savedAt;
  renderPlayers();
  renderRoster();
  renderDraftState();
  const detail = source === 'cache'
    ? `Cached picks from ${formatTimestamp(savedAt)}. Reconnecting to Sleeper…`
    : `Updated ${formatTimestamp(savedAt)} · ${state.picks.length} picks recorded`;
  if (source === 'cache') setConnection('loading', 'Showing cached draft', detail);
  else setConnection('live', 'Sleeper draft connected', detail);
}

function readDraftCache(draftId) {
  const cached = loadCachedPicks(localStorage, draftId);
  if (cached) applyPicks(cached.picks, 'cache', cached.savedAt);
}

async function loadLeague({ autoOpenDraft = true } = {}) {
  const leagueId = elements.leagueId.value.trim();
  if (!isValidSleeperId(leagueId)) {
    setSetupError('League ID must contain only numbers.');
    elements.leagueId.focus();
    return;
  }

  setSetupError();
  setConnection('loading', 'Loading Sleeper league', 'Fetching league, users, and drafts…');
  elements.loadLeague.disabled = true;
  try {
    const [league, drafts, users] = await Promise.all([
      fetchJson(`/league/${leagueId}`),
      fetchJson(`/league/${leagueId}/drafts`),
      fetchJson(`/league/${leagueId}/users`),
    ]);
    if (!league || !isValidSleeperId(league.league_id)) throw new Error('Sleeper did not find that league.');
    state.league = league;
    state.drafts = Array.isArray(drafts) ? drafts : [];
    state.users = Array.isArray(users) ? users : [];
    storageSet(localStorage, STORAGE.leagueId, leagueId);
    const preferred = elements.draftId.value.trim() || storageGet(localStorage, STORAGE.draftId);
    const selectedId = renderDraftSelect(preferred);
    renderDraftState();
    setConnection('idle', 'League loaded', state.drafts.length ? 'Choose a draft to begin live tracking.' : 'No drafts were returned for this league.');
    const draftToOpen = isValidSleeperId(preferred) ? preferred : selectedId;
    if (autoOpenDraft && draftToOpen) {
      elements.draftId.value = draftToOpen;
      await loadDraft(draftToOpen);
    }
  } catch (error) {
    setSetupError(error.message || 'The league could not be loaded.');
    setConnection('error', 'Sleeper connection failed', 'Check the league ID and your connection, then try again.');
  } finally {
    elements.loadLeague.disabled = false;
  }
}

async function refreshPicks({ manual = false } = {}) {
  const draftId = String(state.draft?.draft_id ?? elements.draftId.value).trim();
  if (!isValidSleeperId(draftId) || state.refreshing || document.hidden) return;
  state.refreshing = true;
  if (manual) setConnection('loading', 'Refreshing draft picks', 'Checking Sleeper for the latest selections…');
  try {
    const response = await fetchJson(`/draft/${draftId}/picks`);
    const picks = Array.isArray(response) ? response : [];
    const now = Date.now();
    saveCachedPicks(localStorage, draftId, picks, now);
    applyPicks(picks, 'live', now);
  } catch (error) {
    const cached = loadCachedPicks(localStorage, draftId);
    if (cached) {
      applyPicks(cached.picks, 'cache', cached.savedAt);
      setConnection('error', 'Sleeper is temporarily unavailable', `Showing cached picks from ${formatTimestamp(cached.savedAt)}.`);
    } else {
      setConnection('error', 'Could not refresh picks', error.message || 'Try again in a moment.');
    }
  } finally {
    state.refreshing = false;
    elements.manualRefresh.classList.remove('is-loading');
  }
}

function startPolling() {
  stopPolling();
  if (!state.draft || document.hidden) return;
  state.pollTimer = window.setInterval(() => refreshPicks(), POLL_INTERVAL_MS);
}

function stopPolling() {
  if (state.pollTimer) window.clearInterval(state.pollTimer);
  state.pollTimer = null;
}

async function loadDraft(explicitDraftId = '') {
  const draftId = String(explicitDraftId || elements.draftId.value).trim();
  if (!isValidSleeperId(draftId)) {
    setSetupError('Draft ID must contain only numbers.');
    elements.draftId.focus();
    return;
  }

  stopPolling();
  setSetupError();
  storageSet(localStorage, STORAGE.draftId, draftId);
  elements.draftId.value = draftId;
  if ([...elements.draftSelect.options].some((option) => option.value === draftId)) {
    elements.draftSelect.value = draftId;
  }
  readDraftCache(draftId);
  setConnection('loading', 'Opening Sleeper draft', 'Loading draft details and picks…');
  elements.loadDraft.disabled = true;

  try {
    const [draft, picks] = await Promise.all([
      fetchJson(`/draft/${draftId}`),
      fetchJson(`/draft/${draftId}/picks`),
    ]);
    if (!draft || !isValidSleeperId(draft.draft_id)) throw new Error('Sleeper did not find that draft.');
    state.draft = draft;

    const linkedLeagueId = String(draft.league_id ?? '');
    if (isValidSleeperId(linkedLeagueId) && (!state.league || String(state.league.league_id) !== linkedLeagueId || !state.users.length)) {
      const [league, users] = await Promise.all([
        fetchJson(`/league/${linkedLeagueId}`),
        fetchJson(`/league/${linkedLeagueId}/users`),
      ]);
      state.league = league;
      state.users = Array.isArray(users) ? users : [];
      elements.leagueId.value = linkedLeagueId;
      storageSet(localStorage, STORAGE.leagueId, linkedLeagueId);
    } else if (!isValidSleeperId(linkedLeagueId)) {
      state.users = [];
    }

    const normalizedPicks = Array.isArray(picks) ? picks : [];
    const now = Date.now();
    saveCachedPicks(localStorage, draftId, normalizedPicks, now);
    applyPicks(normalizedPicks, 'live', now);
    renderTeamSelect();
    elements.setup.open = false;
    startPolling();
  } catch (error) {
    const cached = loadCachedPicks(localStorage, draftId);
    if (cached) {
      applyPicks(cached.picks, 'cache', cached.savedAt);
      setSetupError('Draft details could not be loaded. Cached picks are still available.');
    } else {
      state.draft = null;
      setSetupError(error.message || 'The draft could not be loaded.');
      setConnection('error', 'Sleeper connection failed', 'Check the draft ID and your connection, then try again.');
    }
  } finally {
    elements.loadDraft.disabled = false;
    renderDraftState();
  }
}

function bindEvents() {
  elements.loadLeague.addEventListener('click', () => loadLeague());
  elements.leagueId.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') loadLeague();
  });
  elements.loadDraft.addEventListener('click', () => loadDraft());
  elements.draftId.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') loadDraft();
  });
  elements.draftSelect.addEventListener('change', () => {
    if (!elements.draftSelect.value) return;
    elements.draftId.value = elements.draftSelect.value;
    loadDraft(elements.draftSelect.value);
  });
  elements.teamSelect.addEventListener('change', () => {
    state.teamSelectionValue = elements.teamSelect.value;
    storageSet(localStorage, STORAGE.teamSelection, state.teamSelectionValue);
    renderRoster();
  });
  elements.manualRefresh.addEventListener('click', () => {
    if (state.draft) refreshPicks({ manual: true });
    else {
      elements.setup.open = true;
      elements.draftId.focus();
    }
  });
  elements.search.addEventListener('input', () => {
    state.filters.search = elements.search.value;
    renderPlayers();
  });
  elements.sortBy.addEventListener('change', () => {
    state.filters.sortBy = elements.sortBy.value;
    storageSet(localStorage, STORAGE.sortBy, state.filters.sortBy);
    renderPlayers();
  });
  elements.showDrafted.addEventListener('change', () => {
    state.filters.showDrafted = elements.showDrafted.checked;
    storageSet(localStorage, STORAGE.showDrafted, state.filters.showDrafted);
    renderPlayers();
  });
  for (const button of elements.positionTabs) {
    button.addEventListener('click', () => {
      state.filters.position = button.dataset.position;
      for (const tab of elements.positionTabs) {
        const active = tab === button;
        tab.classList.toggle('active', active);
        tab.setAttribute('aria-pressed', String(active));
      }
      renderPlayers();
    });
  }
  for (const button of elements.mobileViewButtons) {
    button.addEventListener('click', () => {
      document.body.dataset.mobileView = button.dataset.view;
      for (const tab of elements.mobileViewButtons) {
        const active = tab === button;
        tab.classList.toggle('active', active);
        tab.setAttribute('aria-pressed', String(active));
      }
      window.scrollTo({ top: 0, behavior: 'auto' });
    });
  }
  elements.valueHelp.addEventListener('click', () => {
    const expanded = elements.valueHelp.getAttribute('aria-expanded') === 'true';
    elements.valueHelp.setAttribute('aria-expanded', String(!expanded));
    elements.valueHelpCopy.hidden = expanded;
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stopPolling();
    else if (state.draft) {
      refreshPicks();
      startPolling();
    }
  });
  window.addEventListener('focus', () => {
    if (state.draft && Date.now() - state.lastRefreshAt > 2_000) refreshPicks();
  });
  window.addEventListener('beforeunload', stopPolling);
}

async function initialize() {
  bindEvents();
  elements.sortBy.value = state.filters.sortBy;
  elements.showDrafted.checked = state.filters.showDrafted;
  const savedLeagueId = storageGet(localStorage, STORAGE.leagueId);
  const savedDraftId = storageGet(localStorage, STORAGE.draftId);
  elements.leagueId.value = savedLeagueId;
  elements.draftId.value = savedDraftId;
  elements.setup.open = !savedDraftId;

  try {
    await loadPlayerValues();
    setConnection('idle', 'Player values ready', 'Connect a Sleeper draft to track picks automatically.');
  } catch (error) {
    elements.playerList.replaceChildren();
    elements.playerList.setAttribute('aria-busy', 'false');
    elements.emptyState.hidden = false;
    elements.emptyState.textContent = error.message;
    setConnection('error', 'Player data unavailable', 'Refresh the page to try again.');
    return;
  }

  if (savedLeagueId) {
    await loadLeague({ autoOpenDraft: Boolean(savedDraftId) });
  } else if (savedDraftId) {
    await loadDraft(savedDraftId);
  }
}

initialize();
