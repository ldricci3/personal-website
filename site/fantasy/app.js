import {
  ROSTER_SLOTS,
  accountLeagueStorageKey,
  assignRosterSlots,
  buildTeamOptions,
  buildValueCurve,
  chooseInitialConnection,
  createContextGate,
  curvePositionForSelectedPlayer,
  defaultSortDirection,
  draftPicksSignature,
  draftPlayerCutoff,
  filterAndSortPlayers,
  filtersForSelectedPlayer,
  freshSleeperPath,
  getPickedPlayerKeys,
  isStandaloneDraft,
  isValidSleeperAccountInput,
  isValidSleeperId,
  leagueDraftStorageKey,
  loadCachedPicks,
  nearestCurvePoint,
  nextPickStatus,
  nextSortState,
  normalizeDraftPicks,
  normalizeSleeperAccount,
  normalizeSleeperAccountInput,
  normalizeSleeperDrafts,
  normalizeSleeperLeagues,
  resolveTeamSelection,
  saveCachedPicks,
  selectDraftId,
  selectLeagueId,
  snakeDraftPickNumbers,
  storageGet,
  storageRemove,
  storageSet,
  togglePlayerSelection,
} from './draft-core.js';

const API_BASE = 'https://api.sleeper.app/v1';
const SVG_NS = 'http://www.w3.org/2000/svg';
const CURVE_POSITIONS = new Set(['ALL', 'QB', 'RB', 'WR', 'TE']);
const POLL_INTERVAL_MS = 5_000;
const FETCH_TIMEOUT_MS = 8_000;
const SEASON = '2026';
const STORAGE = Object.freeze({
  accountInput: 'fantasyDraft.accountInput',
  accountId: 'fantasyDraft.accountId',
  connectionMode: 'fantasyDraft.connectionMode',
  manualDraftId: 'fantasyDraft.manualDraftId',
  legacyLeagueId: 'fantasyDraft.leagueId',
  legacyDraftId: 'fantasyDraft.draftId',
  teamSelection: 'fantasyDraft.teamSelection',
  showDrafted: 'fantasyDraft.showDrafted',
  sortBy: 'fantasyDraft.sortBy',
  sortDirection: 'fantasyDraft.sortDirection',
});
const contextGate = createContextGate();

const state = {
  players: [],
  picks: [],
  picksSignature: '',
  pickedPlayerKeys: new Set(),
  pickSource: 'none',
  connectionMode: 'none',
  account: null,
  leagues: [],
  selectedLeague: null,
  league: null,
  drafts: [],
  users: [],
  draft: null,
  draftSource: '',
  loadingDraftId: '',
  teamSelectionValue: '',
  teamSelectionDraftId: '',
  filters: {
    search: '',
    position: 'ALL',
    sortBy: storageGet(localStorage, STORAGE.sortBy, 'beer'),
    sortDirection: storageGet(localStorage, STORAGE.sortDirection),
    showDrafted: storageGet(localStorage, STORAGE.showDrafted) === 'true',
  },
  workspaceView: 'table',
  curvePosition: 'ALL',
  showDeeperPlayers: false,
  selectedPlayerKey: '',
  curveResizeFrame: null,
  pollTimer: null,
  refreshing: false,
  accountRequestId: 0,
  leagueRequestId: 0,
  draftRequestId: 0,
  refreshRequestId: 0,
  contextToken: 0,
  lastRefreshAt: 0,
};

const elements = {
  accountInput: document.querySelector('#sleeper-account'),
  loadAccount: document.querySelector('#load-account'),
  leagueSelect: document.querySelector('#league-select'),
  draftSelect: document.querySelector('#draft-select'),
  manualDraftId: document.querySelector('#manual-draft-id'),
  loadManualDraft: document.querySelector('#load-manual-draft'),
  teamSelect: document.querySelector('#team-select'),
  forgetDraft: document.querySelector('#forget-draft'),
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
  sortButtons: [...document.querySelectorAll('[data-sort]')],
  showDrafted: document.querySelector('#show-drafted'),
  positionTabs: [...document.querySelectorAll('[data-position]')],
  playerList: document.querySelector('#player-list'),
  emptyState: document.querySelector('#empty-state'),
  loadingTemplate: document.querySelector('#loading-row-template'),
  workspaceViewButtons: [...document.querySelectorAll('[data-workspace-view]')],
  playersPanel: document.querySelector('.players-panel'),
  curvePanel: document.querySelector('#curve-panel'),
  curvePositionButtons: [...document.querySelectorAll('[data-curve-position]')],
  curveDepthToggle: document.querySelector('#curve-depth-toggle'),
  curveDepthNote: document.querySelector('#curve-depth-note'),
  curveChart: document.querySelector('#value-curve-chart'),
  curvePickNote: document.querySelector('#curve-pick-note'),
  curvePlayerDetails: document.querySelector('#curve-player-details'),
  rosterSlots: document.querySelector('#roster-slots'),
  rosterPrompt: document.querySelector('#roster-prompt'),
  rosterCount: document.querySelector('#roster-count'),
  mobileRosterCount: document.querySelector('#mobile-roster-count'),
  rosterExtras: document.querySelector('#roster-extras'),
  rosterExtrasList: document.querySelector('#roster-extras-list'),
  mobileViewButtons: [...document.querySelectorAll('[data-view]')],
};

function createElement(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined && text !== null) element.textContent = String(text);
  return element;
}

function formatValue(value, digits = 2) {
  const number = Number(value);
  if (!Number.isFinite(number)) return '—';
  return number.toFixed(digits).replace(/\.00$/, '');
}

function formatDynastyRank(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return '—';
  return Number.isInteger(number) ? String(number) : number.toFixed(1);
}

function createSvgElement(tag, attributes = {}, text = '') {
  const element = document.createElementNS(SVG_NS, tag);
  for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, String(value));
  if (text) element.textContent = text;
  return element;
}

function setMobileView(view) {
  document.body.dataset.mobileView = view;
  for (const tab of elements.mobileViewButtons) {
    const active = tab.dataset.view === view;
    tab.classList.toggle('active', active);
    tab.setAttribute('aria-pressed', String(active));
  }
}

function playerSelectionKey(player) {
  return String(player?.playerKey || player?.modelKey || player?.sleeperId || '');
}

function syncTableControls() {
  elements.search.value = state.filters.search;
  elements.showDrafted.checked = state.filters.showDrafted;
  for (const tab of elements.positionTabs) {
    const active = tab.dataset.position === state.filters.position;
    tab.classList.toggle('active', active);
    tab.setAttribute('aria-pressed', String(active));
  }
}

function syncCurvePositionTabs() {
  for (const tab of elements.curvePositionButtons) {
    const active = tab.dataset.curvePosition === state.curvePosition;
    tab.classList.toggle('active', active);
    tab.setAttribute('aria-pressed', String(active));
  }
}

function syncCurveDepthToggle() {
  const cutoff = draftPlayerCutoff(state.draft, state.league);
  const hasDraftCutoff = Number(state.draft?.settings?.teams) > 0 && Number(state.draft?.settings?.rounds) > 0;
  const hasLeagueCutoff = Number(state.league?.total_rosters) > 0 && Array.isArray(state.league?.roster_positions)
    && state.league.roster_positions.length > 0;
  const rangeLabel = hasDraftCutoff || hasLeagueCutoff
    ? `the final pick (${cutoff})`
    : `the 12-team, 15-round fallback (${cutoff})`;
  elements.curveDepthToggle.textContent = state.showDeeperPlayers ? 'Hide deeper players' : 'Show deeper players';
  elements.curveDepthToggle.setAttribute('aria-pressed', String(state.showDeeperPlayers));
  elements.curveDepthNote.textContent = state.showDeeperPlayers
    ? `Showing all ranked players; the normal range ends at ${rangeLabel}.`
    : `Showing players through ${rangeLabel}.`;
}

function playerRowForKey(key) {
  return [...elements.playerList.querySelectorAll('.player-row')]
    .find((candidate) => candidate.dataset.playerKey === key);
}

function curvePointForKey(key) {
  return [...elements.curveChart.querySelectorAll('.curve-point')]
    .find((candidate) => candidate.dataset.playerKey === key);
}

function scrollSelectedRowIntoView() {
  if (!state.selectedPlayerKey) return;
  playerRowForKey(state.selectedPlayerKey)?.scrollIntoView({ block: 'nearest', behavior: 'auto' });
}

function setWorkspaceView(view) {
  state.workspaceView = view === 'curves' ? 'curves' : 'table';
  const showCurves = state.workspaceView === 'curves';
  elements.playersPanel.hidden = showCurves;
  elements.curvePanel.hidden = !showCurves;
  for (const tab of elements.workspaceViewButtons) {
    const active = tab.dataset.workspaceView === state.workspaceView;
    tab.classList.toggle('active', active);
    tab.setAttribute('aria-pressed', String(active));
  }
  setMobileView('players');
  if (showCurves) renderValueCurve();
  else window.requestAnimationFrame(scrollSelectedRowIntoView);
}

function updateCurvePlayerDetails(player = null, { hiddenByFilter = false } = {}) {
  if (!player) {
    elements.curvePlayerDetails.replaceChildren(
      createElement('strong', '', 'Select a player'),
      createElement('span', '', 'Tap a point or player row for details.'),
    );
    return;
  }
  const details = createElement(
    'span',
    '',
    `${player.position}${player.team ? ` · ${player.team}` : ''} · Rank ${player.rank} · Value ${formatValue(player.value)}`,
  );
  const clear = createElement('button', 'curve-clear-selection', 'Clear');
  clear.type = 'button';
  clear.setAttribute('aria-label', `Clear ${player.name} selection`);
  clear.addEventListener('click', clearPlayerSelection);
  const children = [createElement('strong', '', player.name), details];
  if (hiddenByFilter) children.push(createElement('span', 'curve-selection-note', 'Selected player is outside the current chart filter.'));
  children.push(clear);
  elements.curvePlayerDetails.replaceChildren(...children);
}

function updateCurveCallout(player = null) {
  elements.curveChart.querySelector('.curve-callout')?.remove();
  if (!player || !Number.isFinite(player.screenX) || !Number.isFinite(player.screenY)) return;
  const chartWidth = Number(elements.curveChart.getAttribute('width')) || 300;
  const label = `${player.name} · ${formatValue(player.value)}`;
  const calloutWidth = Math.min(220, Math.max(110, label.length * 6.2 + 18));
  const x = Math.min(chartWidth - calloutWidth - 6, Math.max(6, player.screenX - calloutWidth / 2));
  const y = player.screenY > 58 ? player.screenY - 40 : player.screenY + 12;
  const group = createSvgElement('g', { class: 'curve-callout', 'aria-hidden': 'true' });
  group.append(
    createSvgElement('rect', { x, y, width: calloutWidth, height: 30, rx: 6 }),
    createSvgElement('text', { x: x + 9, y: y + 19 }, label),
  );
  elements.curveChart.append(group);
}

function clearPlayerSelection() {
  if (!state.selectedPlayerKey) return;
  const focusedKey = document.activeElement?.dataset?.playerKey || '';
  const focusWasRow = document.activeElement?.classList?.contains('player-row');
  const focusWasPoint = document.activeElement?.classList?.contains('curve-point');
  state.selectedPlayerKey = '';
  renderPlayers();
  renderValueCurve();
  if (focusedKey && (focusWasRow || focusWasPoint)) {
    window.requestAnimationFrame(() => {
      if (focusWasRow) playerRowForKey(focusedKey)?.focus();
      if (focusWasPoint) curvePointForKey(focusedKey)?.focus();
    });
  }
}

function selectPlayer(player, { source = '', restoreFocus = false } = {}) {
  const key = playerSelectionKey(player);
  state.selectedPlayerKey = togglePlayerSelection(state.selectedPlayerKey, key);
  if (state.selectedPlayerKey && source === 'table') {
    state.curvePosition = curvePositionForSelectedPlayer(state.curvePosition, player.position);
    if (Number(player.overallRank) > draftPlayerCutoff(state.draft, state.league)) state.showDeeperPlayers = true;
    syncCurvePositionTabs();
    syncCurveDepthToggle();
  } else if (state.selectedPlayerKey && source === 'curve') {
    state.filters = filtersForSelectedPlayer(state.filters, player);
    syncTableControls();
  }
  renderPlayers();
  renderValueCurve();
  if (restoreFocus) {
    window.requestAnimationFrame(() => {
      if (source === 'table') playerRowForKey(key)?.focus();
      if (source === 'curve') curvePointForKey(key)?.focus();
    });
  }
}

function renderValueCurve() {
  if (!state.players.length || elements.curvePanel.hidden) return;
  const cutoff = draftPlayerCutoff(state.draft, state.league);
  const fullCurve = buildValueCurve(state.players, { pickedKeys: state.pickedPlayerKeys });
  const visibleCurve = state.showDeeperPlayers
    ? fullCurve
    : fullCurve.filter((player) => player.rank <= cutoff);
  const points = state.curvePosition === 'ALL'
    ? visibleCurve
    : visibleCurve.filter((player) => player.position === state.curvePosition);
  const containerWidth = Math.floor(elements.curveChart.parentElement?.getBoundingClientRect().width || 0);
  const width = Math.max(300, containerWidth || 900);
  const height = width < 520 ? 290 : 340;
  const margin = { top: 20, right: 16, bottom: 46, left: width < 520 ? 42 : 52 };
  const plotWidth = width - margin.left - margin.right;
  const plotHeight = height - margin.top - margin.bottom;
  const maxRank = Math.max(1, ...visibleCurve.map((player) => player.rank));
  const minValue = Math.floor(Math.min(0, ...visibleCurve.map((player) => player.value)));
  const maxValue = Math.ceil(Math.max(0, ...visibleCurve.map((player) => player.value)));
  const valueRange = Math.max(1, maxValue - minValue);
  syncCurveDepthToggle();
  const mapX = (rank) => margin.left + ((rank - 1) / Math.max(1, maxRank - 1)) * plotWidth;
  const mapY = (value) => margin.top + ((maxValue - value) / valueRange) * plotHeight;

  elements.curveChart.setAttribute('viewBox', `0 0 ${width} ${height}`);
  elements.curveChart.setAttribute('width', String(width));
  elements.curveChart.setAttribute('height', String(height));
  elements.curveChart.replaceChildren();

  const grid = createSvgElement('g', { class: 'curve-grid', 'aria-hidden': 'true' });
  for (let index = 0; index <= 4; index += 1) {
    const value = maxValue - (valueRange * index / 4);
    const y = mapY(value);
    grid.append(
      createSvgElement('line', { x1: margin.left, y1: y, x2: width - margin.right, y2: y }),
      createSvgElement('text', { x: margin.left - 8, y: y + 4, 'text-anchor': 'end' }, formatValue(value, 1).replace(/\.0$/, '')),
    );
  }
  const rankTicks = [...new Set([1, Math.round(maxRank / 4), Math.round(maxRank / 2), Math.round(maxRank * 3 / 4), maxRank])];
  for (const rank of rankTicks) {
    const x = mapX(rank);
    grid.append(
      createSvgElement('line', { x1: x, y1: margin.top, x2: x, y2: height - margin.bottom }),
      createSvgElement('text', { x, y: height - margin.bottom + 20, 'text-anchor': 'middle' }, String(rank)),
    );
  }
  grid.append(
    createSvgElement('text', { class: 'curve-axis-label', x: margin.left, y: 12 }, 'Value'),
    createSvgElement('text', {
      class: 'curve-axis-label',
      x: margin.left + plotWidth / 2,
      y: height - 7,
      'text-anchor': 'middle',
    }, 'Overall player rank'),
  );
  elements.curveChart.append(grid);

  const selection = resolveTeamSelection(state.teamSelectionValue, state.users, state.draft ?? {});
  const pickNumbers = snakeDraftPickNumbers(state.draft ?? {}, selection).filter((pick) => pick <= maxRank);
  const markers = createSvgElement('g', { class: 'curve-pick-markers', 'aria-hidden': 'true' });
  for (const pick of pickNumbers) {
    const x = mapX(pick);
    const line = createSvgElement('line', {
      class: 'curve-pick-marker',
      x1: x,
      y1: margin.top,
      x2: x,
      y2: height - margin.bottom,
    });
    line.append(createSvgElement('title', {}, `Your pick ${pick}`));
    markers.append(line, createSvgElement('circle', {
      class: 'curve-pick-marker-dot',
      cx: x,
      cy: height - margin.bottom,
      r: 3,
    }));
  }
  elements.curveChart.append(markers);

  if (pickNumbers.length) {
    elements.curvePickNote.textContent = `Your picks: ${pickNumbers.join(', ')}`;
  } else if (!state.draft) {
    elements.curvePickNote.textContent = 'Connect a draft and choose your team or slot to mark your picks.';
  } else if (!selection.draftSlot) {
    elements.curvePickNote.textContent = 'Choose your team or draft slot to mark your picks.';
  } else {
    elements.curvePickNote.textContent = 'Pick markers are available for standard snake drafts.';
  }

  const plotted = points.map((player) => ({ ...player, screenX: mapX(player.rank), screenY: mapY(player.value) }));
  if (plotted.length > 1) {
    elements.curveChart.append(createSvgElement('polyline', {
      class: 'curve-line',
      points: plotted.map((player) => `${player.screenX},${player.screenY}`).join(' '),
    }));
  }

  const pointGroup = createSvgElement('g', { class: 'curve-points' });
  for (const player of plotted) {
    const key = playerSelectionKey(player);
    const selected = key && key === state.selectedPlayerKey;
    const circle = createSvgElement('circle', {
      class: `curve-point ${player.drafted ? 'drafted' : 'available'}${selected ? ' selected' : ''}`,
      cx: player.screenX,
      cy: player.screenY,
      r: selected ? 6.5 : (player.drafted ? 3.1 : 3.8),
      'data-player-key': key,
      'data-position': player.position,
      role: 'button',
      tabindex: '0',
      'aria-pressed': String(selected),
      'aria-label': `${player.name}, ${player.position}, rank ${player.rank}, value ${formatValue(player.value)}${player.drafted ? ', drafted' : ''}`,
    });
    circle.append(createSvgElement('title', {}, `${player.name}, ${player.position}, rank ${player.rank}, value ${formatValue(player.value)}${player.drafted ? ', drafted' : ''}`));
    circle.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        selectPlayer(player, { source: 'curve', restoreFocus: true });
      }
    });
    pointGroup.append(circle);
  }
  elements.curveChart.append(pointGroup);

  elements.curveChart.onclick = (event) => {
    const bounds = elements.curveChart.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return;
    const x = (event.clientX - bounds.left) * width / bounds.width;
    const y = (event.clientY - bounds.top) * height / bounds.height;
    const nearest = nearestCurvePoint(plotted, x, y, 26);
    if (nearest) selectPlayer(nearest, { source: 'curve' });
    else clearPlayerSelection();
  };

  const selectedPlayer = fullCurve.find((player) => playerSelectionKey(player) === state.selectedPlayerKey);
  const selectedPoint = plotted.find((player) => playerSelectionKey(player) === state.selectedPlayerKey);
  if (selectedPlayer) {
    updateCurvePlayerDetails(selectedPlayer, { hiddenByFilter: !selectedPoint });
    updateCurveCallout(selectedPoint);
  } else {
    updateCurvePlayerDetails();
    updateCurveCallout();
  }
}

function formatTimestamp(timestamp) {
  const date = new Date(timestamp);
  if (!Number.isFinite(date.getTime())) return '';
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
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

function teamSelectionStorageKey(draftId) {
  return `${STORAGE.teamSelection}.${draftId}`;
}

async function fetchJson(path, { fresh = false } = {}) {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(`${API_BASE}${freshSleeperPath(path, fresh ? Date.now() : null)}`, {
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
  renderPlayers();
  renderRoster();
}

function buildPlayerRow(player) {
  const key = playerSelectionKey(player);
  const selected = key && key === state.selectedPlayerKey;
  const row = createElement('tr', `player-row${player.drafted ? ' drafted' : ''}${selected ? ' selected' : ''}`);
  row.dataset.playerKey = key;
  row.tabIndex = 0;
  row.setAttribute('aria-selected', String(Boolean(selected)));
  row.setAttribute('aria-label', `${player.name}, ${player.position}, value ${formatValue(player.beerPlus)}, dynasty rank ${formatDynastyRank(player.fantasyProsDynastyEcr2026)}${player.drafted ? ', drafted' : ''}`);
  row.addEventListener('click', () => selectPlayer(player, { source: 'table' }));
  row.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      selectPlayer(player, { source: 'table', restoreFocus: true });
    }
  });

  const identityCell = createElement('td', 'player-column');
  const identity = createElement('div', 'player-identity');
  identity.append(createElement('span', 'player-name', player.name));
  const meta = createElement('span', 'player-meta');
  meta.append(createElement('span', 'player-position', player.position));
  if (player.team) meta.append(document.createTextNode(` · ${player.team}`));
  if (player.drafted) meta.append(createElement('span', 'drafted-badge', ' · Drafted'));
  identity.append(meta);
  identityCell.append(identity);

  const valueCell = createElement('td', 'numeric-column value-number', formatValue(player.beerPlus));
  const dynastyCell = createElement(
    'td',
    'numeric-column dynasty-number',
    formatDynastyRank(player.fantasyProsDynastyEcr2026),
  );
  row.append(identityCell, valueCell, dynastyCell);
  return row;
}

function updateSortHeaders() {
  for (const button of elements.sortButtons) {
    const active = button.dataset.sort === state.filters.sortBy;
    const direction = active ? state.filters.sortDirection : '';
    const header = button.closest('th');
    const indicator = button.querySelector('.sort-indicator');
    header?.setAttribute('aria-sort', active ? (direction === 'asc' ? 'ascending' : 'descending') : 'none');
    button.classList.toggle('active', active);
    if (indicator) indicator.textContent = active ? (direction === 'asc' ? '↑' : '↓') : '';
  }
}

function renderPlayers() {
  if (!state.players.length) return;
  const players = filterAndSortPlayers(state.players, {
    ...state.filters,
    pickedKeys: state.pickedPlayerKeys,
  });
  const fragment = document.createDocumentFragment();
  for (const player of players) fragment.append(buildPlayerRow(player));
  elements.playerList.replaceChildren(fragment);
  elements.playerList.setAttribute('aria-busy', 'false');
  elements.emptyState.hidden = players.length > 0;
  updateSortHeaders();
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
      : `${player.position || '—'} · ${player.team || 'FA'} · No BEER+ value`;
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
  elements.rosterPrompt.hidden = Boolean(selection.rosterId || selection.userId || selection.draftSlot);

  const extrasFragment = document.createDocumentFragment();
  for (const player of roster.extras) {
    const item = createElement('p', 'roster-prompt', `${player.name} · ${player.position || '—'}`);
    extrasFragment.append(item);
  }
  elements.rosterExtrasList.replaceChildren(extrasFragment);
  elements.rosterExtras.hidden = roster.extras.length === 0;
  renderNextPick(selection);
  renderValueCurve();
}

function renderNextPick(selection = resolveTeamSelection(state.teamSelectionValue, state.users, state.draft ?? {})) {
  const status = nextPickStatus(state.picks, state.draft ?? {}, selection);
  if (!status) {
    elements.nextPickStatus.textContent = state.draft ? 'Select your team' : 'No team selected';
  } else if (status.unsupported) {
    elements.nextPickStatus.textContent = 'Next pick unavailable for this draft';
  } else if (status.complete) {
    elements.nextPickStatus.textContent = 'Your picks are complete';
  } else if (status.onClock) {
    elements.nextPickStatus.textContent = 'You are on the clock';
  } else {
    elements.nextPickStatus.textContent = `${status.picksAway} pick${status.picksAway === 1 ? '' : 's'} until #${status.nextPick}`;
  }
}

function renderLeagueSelect(preferredLeagueId = '') {
  const select = elements.leagueSelect;
  const selectedId = selectLeagueId(state.leagues, preferredLeagueId);
  const placeholder = createElement('option', '', state.leagues.length ? 'Choose a 2026 league' : 'No 2026 leagues found');
  placeholder.value = '';
  select.replaceChildren(placeholder);

  for (const league of state.leagues) {
    const option = createElement('option');
    option.value = String(league.league_id);
    const name = league.name || 'Sleeper league';
    const status = String(league.status || '').replace('_', ' ');
    option.textContent = `${name}${status ? ` · ${status}` : ''}`;
    select.append(option);
  }
  select.disabled = state.leagues.length === 0;
  select.value = selectedId;
  return selectedId;
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

  const draftId = String(state.draft?.draft_id ?? '');
  if (state.teamSelectionDraftId !== draftId) {
    state.teamSelectionDraftId = draftId;
    state.teamSelectionValue = isValidSleeperId(draftId)
      ? storageGet(localStorage, teamSelectionStorageKey(draftId))
      : '';
  }
  const validSelections = new Set([...userOptions, ...slotOptions].map((option) => option.value));
  if (!validSelections.has(state.teamSelectionValue)) state.teamSelectionValue = '';
  const accountSelection = state.account ? `user:${state.account.user_id}` : '';
  if (!state.teamSelectionValue && validSelections.has(accountSelection)) {
    state.teamSelectionValue = accountSelection;
    storageSet(localStorage, teamSelectionStorageKey(draftId), accountSelection);
  }
  select.value = state.teamSelectionValue;
  renderRoster();
}

function renderDraftState() {
  elements.draftedCount.textContent = String(state.picks.length);
  if (!state.draft) {
    if (state.pickSource === 'cache') elements.setupSummary.textContent = 'Cached draft · offline';
    else if (state.selectedLeague) elements.setupSummary.textContent = state.selectedLeague.name || 'League loaded';
    else if (state.account) elements.setupSummary.textContent = `${state.account.display_name || state.account.username || 'Sleeper account'} · choose a league`;
    else elements.setupSummary.textContent = 'Not connected';
    return;
  }
  const draftName = state.draft.metadata?.name || `${state.draft.season || ''} draft`.trim() || 'Sleeper draft';
  const sourceLabel = state.draftSource === 'manual' && isStandaloneDraft(state.draft) ? 'Standalone mock · ' : '';
  elements.setupSummary.textContent = `${sourceLabel}${draftName} · ${state.draft.status || 'unknown status'}`;
}

function applyPicks(picks, source, savedAt = Date.now(), invalidCount = 0) {
  const signature = draftPicksSignature(picks);
  const changed = signature !== state.picksSignature;
  state.pickSource = source;
  state.lastRefreshAt = savedAt;

  if (changed) {
    state.picks = picks;
    state.picksSignature = signature;
    state.pickedPlayerKeys = getPickedPlayerKeys(state.players, picks);
    renderPlayers();
    renderRoster();
  }
  renderDraftState();

  const invalidNote = invalidCount ? ` · ${invalidCount} malformed pick${invalidCount === 1 ? '' : 's'} ignored` : '';
  if (source === 'cache') {
    setConnection('cached', 'Offline snapshot', `Last updated ${formatTimestamp(savedAt)} · not connected to Sleeper${invalidNote}`);
  } else {
    setConnection('live', 'Sleeper draft connected', `Updated ${formatTimestamp(savedAt)} · ${state.picks.length} picks recorded${invalidNote}`);
  }
  return changed;
}

function readDraftCache(draftId, { preserveUsers = false } = {}) {
  const cached = loadCachedPicks(localStorage, draftId);
  if (!cached) return null;
  state.draft = cached.draft;
  if (!preserveUsers) state.users = cached.users;
  applyPicks(cached.picks, 'cache', cached.savedAt, cached.invalidCount);
  if (state.draft) renderTeamSelect();
  return cached;
}

function resetDraftRuntime() {
  stopPolling();
  state.refreshRequestId += 1;
  state.refreshing = false;
  state.draft = null;
  state.draftSource = '';
  state.loadingDraftId = '';
  state.picks = [];
  state.picksSignature = '';
  state.pickedPlayerKeys = new Set();
  state.pickSource = 'none';
  state.showDeeperPlayers = false;
  state.teamSelectionValue = '';
  state.teamSelectionDraftId = '';
  state.lastRefreshAt = 0;
  elements.teamSelect.disabled = true;
  elements.teamSelect.replaceChildren(Object.assign(document.createElement('option'), { textContent: 'Open a draft first', value: '' }));
  renderPlayers();
  renderRoster();
  renderDraftState();
}

function beginContextChange() {
  const generation = contextGate.begin();
  state.contextToken = generation;
  resetDraftRuntime();
  return generation;
}

function isCurrentContext(generation) {
  return contextGate.isCurrent(generation);
}

function isCurrentDraftRequest(generation, draftId) {
  return isCurrentContext(generation) && String(state.draft?.draft_id ?? '') === String(draftId);
}

async function loadAccount() {
  const accountInput = normalizeSleeperAccountInput(elements.accountInput.value);
  if (!isValidSleeperAccountInput(accountInput)) {
    setSetupError('Enter a valid Sleeper username or numeric user ID.');
    elements.accountInput.focus();
    return;
  }

  const generation = beginContextChange();
  const requestId = state.accountRequestId + 1;
  state.accountRequestId = requestId;
  state.leagueRequestId += 1;
  state.draftRequestId += 1;
  elements.loadManualDraft.disabled = false;
  state.connectionMode = 'account';
  state.account = null;
  state.leagues = [];
  state.selectedLeague = null;
  state.league = null;
  state.drafts = [];
  state.users = [];
  elements.leagueSelect.replaceChildren(Object.assign(document.createElement('option'), { textContent: 'Finding leagues…', value: '' }));
  elements.leagueSelect.disabled = true;
  elements.draftSelect.replaceChildren(Object.assign(document.createElement('option'), { textContent: 'Choose a league first', value: '' }));
  elements.draftSelect.disabled = true;
  renderDraftState();
  setSetupError();
  setConnection('loading', 'Finding Sleeper account', `Loading ${SEASON} leagues…`);
  elements.loadAccount.disabled = true;

  try {
    const accountPayload = await fetchJson(`/user/${encodeURIComponent(accountInput)}`);
    if (!isCurrentContext(generation)) return;
    const account = normalizeSleeperAccount(accountPayload);
    const leaguePayload = await fetchJson(`/user/${account.user_id}/leagues/nfl/${SEASON}`);
    if (!isCurrentContext(generation)) return;
    const leagues = normalizeSleeperLeagues(leaguePayload, SEASON);
    state.account = account;
    state.leagues = leagues;
    storageSet(localStorage, STORAGE.accountInput, accountInput);
    storageSet(localStorage, STORAGE.accountId, account.user_id);
    storageSet(localStorage, STORAGE.connectionMode, 'account');

    const preferredKey = accountLeagueStorageKey(account.user_id);
    const preferredLeagueId = preferredKey ? storageGet(localStorage, preferredKey) : '';
    const selectedLeagueId = renderLeagueSelect(preferredLeagueId);
    renderDraftState();

    if (selectedLeagueId) {
      await loadLeague(selectedLeagueId);
    } else if (!leagues.length) {
      elements.setup.open = true;
      setConnection('idle', 'Sleeper account found', `No ${SEASON} NFL leagues were returned for this account. Standalone mocks need their draft ID.`);
    } else {
      elements.setup.open = true;
      setConnection('idle', 'Sleeper account found', 'Choose a league to open its current draft. Standalone mocks need their draft ID.');
    }
  } catch (error) {
    if (!isCurrentContext(generation)) return;
    elements.setup.open = true;
    setSetupError(error.message || 'The Sleeper account could not be loaded.');
    setConnection('error', 'Sleeper connection failed', 'Check the username or user ID and your connection, then try again.');
  } finally {
    if (requestId === state.accountRequestId) elements.loadAccount.disabled = false;
  }
}

async function loadLeague(explicitLeagueId = '') {
  const leagueId = String(explicitLeagueId || elements.leagueSelect.value).trim();
  const knownLeague = state.leagues.find((league) => String(league.league_id) === leagueId);
  if (!state.account || !knownLeague || !isValidSleeperId(leagueId)) {
    setSetupError('Choose a league from this Sleeper account.');
    elements.leagueSelect.focus();
    return;
  }

  const generation = beginContextChange();
  const requestId = state.leagueRequestId + 1;
  state.leagueRequestId = requestId;
  const loadingMarker = `league:${leagueId}`;
  state.loadingDraftId = loadingMarker;
  state.draftRequestId += 1;
  elements.loadManualDraft.disabled = false;
  state.connectionMode = 'account';
  state.selectedLeague = knownLeague;
  state.league = null;
  state.drafts = [];
  state.users = [];
  elements.leagueSelect.value = leagueId;
  elements.leagueSelect.disabled = true;
  elements.draftSelect.replaceChildren(Object.assign(document.createElement('option'), { textContent: 'Finding drafts…', value: '' }));
  elements.draftSelect.disabled = true;
  renderDraftState();
  setSetupError();
  setConnection('loading', 'Loading Sleeper league', 'Fetching league, users, and drafts…');

  try {
    const [league, drafts, users] = await Promise.all([
      fetchJson(`/league/${leagueId}`),
      fetchJson(`/league/${leagueId}/drafts`),
      fetchJson(`/league/${leagueId}/users`),
    ]);
    if (!isCurrentContext(generation)) return;
    if (!league || !isValidSleeperId(league.league_id)) throw new Error('Sleeper did not find that league.');

    state.selectedLeague = league;
    state.league = league;
    state.drafts = normalizeSleeperDrafts(drafts);
    state.users = Array.isArray(users) ? users : [];
    const accountLeagueKey = accountLeagueStorageKey(state.account.user_id);
    if (accountLeagueKey) storageSet(localStorage, accountLeagueKey, leagueId);
    const draftKey = leagueDraftStorageKey(leagueId);
    const preferredDraftId = draftKey ? storageGet(localStorage, draftKey) : '';
    const selectedDraftId = renderDraftSelect(preferredDraftId);
    renderDraftState();

    const selectedLeagueDraft = state.drafts.find((draft) => String(draft.draft_id) === selectedDraftId);
    if (selectedLeagueDraft?.status === 'drafting' || selectedDraftId) {
      await loadDraft(selectedDraftId, { source: 'league' });
    } else {
      elements.setup.open = true;
      setConnection('idle', 'League loaded', 'No drafts were returned for this league. You can still open a standalone mock below.');
    }
  } catch (error) {
    if (!isCurrentContext(generation)) return;
    elements.setup.open = true;
    setSetupError(error.message || 'The league could not be loaded.');
    setConnection('error', 'Sleeper connection failed', 'Choose another league or try again.');
  } finally {
    if (requestId === state.leagueRequestId) {
      elements.leagueSelect.disabled = state.leagues.length === 0;
      if (state.loadingDraftId === loadingMarker) state.loadingDraftId = '';
    }
  }
}

async function refreshPicks({ manual = false } = {}) {
  const draftId = String(state.draft?.draft_id ?? '').trim();
  if (!isValidSleeperId(draftId) || state.refreshing || document.hidden) return;
  const generation = state.contextToken;
  const requestId = state.refreshRequestId + 1;
  state.refreshRequestId = requestId;
  state.refreshing = true;
  if (manual) setConnection('loading', 'Refreshing draft picks', 'Checking Sleeper for the latest selections…');
  try {
    const response = await fetchJson(`/draft/${draftId}/picks`, { fresh: true });
    if (!isCurrentDraftRequest(generation, draftId)) return;
    const { picks, invalidCount } = normalizeDraftPicks(response);
    const now = Date.now();
    saveCachedPicks(localStorage, draftId, picks, now, { draft: state.draft, users: state.users });
    applyPicks(picks, 'live', now, invalidCount);
  } catch (error) {
    if (!isCurrentDraftRequest(generation, draftId)) return;
    const cached = loadCachedPicks(localStorage, draftId);
    if (cached) {
      applyPicks(cached.picks, 'cache', cached.savedAt);
      setConnection('error', 'Sleeper is temporarily unavailable', `Showing cached picks from ${formatTimestamp(cached.savedAt)}.`);
    } else {
      setConnection('error', 'Could not refresh picks', error.message || 'Try again in a moment.');
    }
  } finally {
    if (requestId === state.refreshRequestId) {
      state.refreshing = false;
      elements.manualRefresh.classList.remove('is-loading');
    }
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

function forgetDraft() {
  state.contextToken = contextGate.begin();
  state.accountRequestId += 1;
  state.leagueRequestId += 1;
  state.draftRequestId += 1;
  const removablePrefixes = [
    'fantasyDraft.cache.',
    `${STORAGE.teamSelection}.`,
    'fantasyDraft.account.',
    'fantasyDraft.league.',
  ];
  const removableKeys = new Set([
    STORAGE.accountInput,
    STORAGE.accountId,
    STORAGE.connectionMode,
    STORAGE.manualDraftId,
    STORAGE.legacyLeagueId,
    STORAGE.legacyDraftId,
    STORAGE.teamSelection,
  ]);
  try {
    for (let index = localStorage.length - 1; index >= 0; index -= 1) {
      const key = localStorage.key(index);
      if (key && (removableKeys.has(key) || removablePrefixes.some((prefix) => key.startsWith(prefix)))) {
        storageRemove(localStorage, key);
      }
    }
  } catch {
    for (const key of removableKeys) storageRemove(localStorage, key);
  }

  state.connectionMode = 'none';
  elements.loadAccount.disabled = false;
  elements.loadManualDraft.disabled = false;
  state.account = null;
  state.leagues = [];
  state.selectedLeague = null;
  state.league = null;
  state.drafts = [];
  state.users = [];
  state.teamSelectionValue = '';
  elements.accountInput.value = '';
  elements.manualDraftId.value = '';
  elements.leagueSelect.replaceChildren(Object.assign(document.createElement('option'), { textContent: 'Find your account first', value: '' }));
  elements.leagueSelect.disabled = true;
  elements.draftSelect.replaceChildren(Object.assign(document.createElement('option'), { textContent: 'Choose a league first', value: '' }));
  elements.draftSelect.disabled = true;
  resetDraftRuntime();
  setSetupError();
  setConnection('idle', 'Draft forgotten', 'Player values remain available. Connect another Sleeper draft when ready.');
  elements.setup.open = true;
  elements.accountInput.focus();
}

async function loadDraft(explicitDraftId = '', { source = 'manual' } = {}) {
  const draftId = String(explicitDraftId || elements.manualDraftId.value).trim();
  if (!isValidSleeperId(draftId)) {
    setSetupError('Draft ID must contain only numbers.');
    if (source === 'manual') elements.manualDraftId.focus();
    return;
  }

  const generation = beginContextChange();
  const requestId = state.draftRequestId + 1;
  state.draftRequestId = requestId;
  state.draftSource = source;
  state.loadingDraftId = draftId;
  const isManual = source === 'manual';
  if (isManual) {
    state.accountRequestId += 1;
    state.leagueRequestId += 1;
    state.connectionMode = 'manual';
    elements.loadAccount.disabled = false;
    state.account = null;
    state.leagues = [];
    state.selectedLeague = null;
    state.league = null;
    state.drafts = [];
    state.users = [];
    elements.manualDraftId.value = draftId;
    elements.leagueSelect.replaceChildren(Object.assign(document.createElement('option'), { textContent: 'Standalone mock opened', value: '' }));
    elements.leagueSelect.disabled = true;
    elements.draftSelect.replaceChildren(Object.assign(document.createElement('option'), { textContent: 'Standalone mock opened', value: '' }));
    elements.draftSelect.disabled = true;
  } else if ([...elements.draftSelect.options].some((option) => option.value === draftId)) {
    elements.draftSelect.value = draftId;
    elements.draftSelect.disabled = true;
  }

  setSetupError();
  readDraftCache(draftId, { preserveUsers: source === 'league' });
  setConnection('loading', 'Opening Sleeper draft', 'Loading draft details and picks…');
  if (isManual) elements.loadManualDraft.disabled = true;

  try {
    const [draft, picksPayload] = await Promise.all([
      fetchJson(`/draft/${draftId}`, { fresh: true }),
      fetchJson(`/draft/${draftId}/picks`, { fresh: true }),
    ]);
    if (!isCurrentContext(generation)) return;
    if (!draft || !isValidSleeperId(draft.draft_id)) throw new Error('Sleeper did not find that draft.');
    const { picks, invalidCount } = normalizeDraftPicks(picksPayload);

    const linkedLeagueId = String(draft.league_id ?? '');
    let league = state.league;
    let users = state.users;
    if (isValidSleeperId(linkedLeagueId) && (!league || String(league.league_id) !== linkedLeagueId || !users.length)) {
      try {
        [league, users] = await Promise.all([
          fetchJson(`/league/${linkedLeagueId}`),
          fetchJson(`/league/${linkedLeagueId}/users`),
        ]);
        if (!isCurrentContext(generation)) return;
        users = Array.isArray(users) ? users : [];
      } catch {
        if (!isCurrentContext(generation)) return;
        league = null;
        users = [];
      }
    } else if (!isValidSleeperId(linkedLeagueId)) {
      league = null;
      users = [];
    }

    if (!isCurrentContext(generation)) return;
    state.draft = draft;
    state.league = league;
    state.users = users;

    if (isManual) {
      storageSet(localStorage, STORAGE.manualDraftId, draftId);
      storageSet(localStorage, STORAGE.connectionMode, 'manual');
    } else {
      if (league) state.selectedLeague = league;
      const leagueId = String(state.league?.league_id ?? linkedLeagueId);
      const draftKey = leagueDraftStorageKey(leagueId);
      if (draftKey) storageSet(localStorage, draftKey, draftId);
    }

    const now = Date.now();
    saveCachedPicks(localStorage, draftId, picks, now, { draft, users });
    applyPicks(picks, 'live', now, invalidCount);
    renderTeamSelect();
    elements.setup.open = false;
    startPolling();
  } catch (error) {
    if (!isCurrentContext(generation)) return;
    elements.setup.open = true;
    state.draft = null;
    if (isManual) state.users = [];
    const cached = readDraftCache(draftId, { preserveUsers: source === 'league' });
    if (cached) {
      setSetupError('Sleeper is unavailable. This offline snapshot may be out of date.');
      setConnection('error', 'Offline snapshot', `Last updated ${formatTimestamp(cached.savedAt)} · retrying while this page stays open`);
      startPolling();
    } else {
      setSetupError(error.message || 'The draft could not be loaded.');
      setConnection('error', 'Sleeper connection failed', 'Check the draft ID and your connection, then try again.');
    }
  } finally {
    if (requestId === state.draftRequestId) {
      state.loadingDraftId = '';
      elements.loadManualDraft.disabled = false;
      if (!isManual) {
        elements.draftSelect.disabled = state.drafts.length === 0;
      }
    }
    if (isCurrentContext(generation)) renderDraftState();
  }
}

function bindEvents() {
  elements.loadAccount.addEventListener('click', loadAccount);
  elements.accountInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') loadAccount();
  });
  elements.leagueSelect.addEventListener('change', () => {
    if (elements.leagueSelect.value) loadLeague(elements.leagueSelect.value);
  });
  elements.draftSelect.addEventListener('change', () => {
    if (elements.draftSelect.value) loadDraft(elements.draftSelect.value, { source: 'league' });
  });
  elements.loadManualDraft.addEventListener('click', () => loadDraft('', { source: 'manual' }));
  elements.manualDraftId.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') loadDraft('', { source: 'manual' });
  });
  elements.forgetDraft.addEventListener('click', forgetDraft);
  elements.teamSelect.addEventListener('change', () => {
    state.teamSelectionValue = elements.teamSelect.value;
    const draftId = String(state.draft?.draft_id ?? '');
    if (isValidSleeperId(draftId)) {
      state.teamSelectionDraftId = draftId;
      storageSet(localStorage, teamSelectionStorageKey(draftId), state.teamSelectionValue);
    }
    renderRoster();
  });
  elements.manualRefresh.addEventListener('click', () => {
    if (state.draft) refreshPicks({ manual: true });
    else {
      elements.setup.open = true;
      elements.accountInput.focus();
    }
  });
  for (const button of elements.workspaceViewButtons) {
    button.addEventListener('click', () => setWorkspaceView(button.dataset.workspaceView));
  }
  for (const button of elements.curvePositionButtons) {
    button.addEventListener('click', () => {
      state.curvePosition = CURVE_POSITIONS.has(button.dataset.curvePosition)
        ? button.dataset.curvePosition
        : 'ALL';
      syncCurvePositionTabs();
      renderValueCurve();
    });
  }
  elements.curveDepthToggle.addEventListener('click', () => {
    state.showDeeperPlayers = !state.showDeeperPlayers;
    syncCurveDepthToggle();
    renderValueCurve();
  });
  elements.search.addEventListener('input', () => {
    state.filters.search = elements.search.value;
    renderPlayers();
  });
  for (const button of elements.sortButtons) {
    button.addEventListener('click', () => {
      Object.assign(state.filters, nextSortState(state.filters, button.dataset.sort));
      storageSet(localStorage, STORAGE.sortBy, state.filters.sortBy);
      storageSet(localStorage, STORAGE.sortDirection, state.filters.sortDirection);
      renderPlayers();
    });
  }
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
      setMobileView(button.dataset.view);
      window.scrollTo({ top: 0, behavior: 'auto' });
      if (button.dataset.view === 'players' && state.workspaceView === 'curves') renderValueCurve();
    });
  }
  window.addEventListener('resize', () => {
    if (state.workspaceView !== 'curves' || elements.curvePanel.hidden) return;
    if (state.curveResizeFrame) window.cancelAnimationFrame(state.curveResizeFrame);
    state.curveResizeFrame = window.requestAnimationFrame(() => {
      state.curveResizeFrame = null;
      renderValueCurve();
    });
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && state.selectedPlayerKey) clearPlayerSelection();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      stopPolling();
      return;
    }
    if (state.draft) {
      refreshPicks();
      startPolling();
    }
  });
  window.addEventListener('focus', () => {
    const now = Date.now();
    if (state.draft && now - state.lastRefreshAt > 2_000) refreshPicks();
  });
  window.addEventListener('beforeunload', () => {
    stopPolling();
  });
}

async function initialize() {
  bindEvents();
  const availableSorts = new Set(elements.sortButtons.map((button) => button.dataset.sort));
  if (!availableSorts.has(state.filters.sortBy)) {
    state.filters.sortBy = 'beer';
    state.filters.sortDirection = defaultSortDirection(state.filters.sortBy);
    storageSet(localStorage, STORAGE.sortBy, state.filters.sortBy);
    storageSet(localStorage, STORAGE.sortDirection, state.filters.sortDirection);
  } else if (!['asc', 'desc'].includes(state.filters.sortDirection)) {
    state.filters.sortDirection = defaultSortDirection(state.filters.sortBy);
    storageSet(localStorage, STORAGE.sortDirection, state.filters.sortDirection);
  }
  updateSortHeaders();
  syncTableControls();
  syncCurvePositionTabs();
  syncCurveDepthToggle();
  const savedAccountInput = storageGet(localStorage, STORAGE.accountInput);
  const savedManualDraftId = storageGet(
    localStorage,
    STORAGE.manualDraftId,
    storageGet(localStorage, STORAGE.legacyDraftId),
  );
  elements.accountInput.value = savedAccountInput;
  elements.manualDraftId.value = savedManualDraftId;
  const initialConnection = chooseInitialConnection({
    accountInput: savedAccountInput,
    manualDraftId: savedManualDraftId,
    preferredMode: storageGet(localStorage, STORAGE.connectionMode),
  });
  elements.setup.open = initialConnection.mode === 'none';

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

  if (initialConnection.mode === 'account') {
    await loadAccount();
  } else if (initialConnection.mode === 'manual') {
    await loadDraft(initialConnection.value, { source: 'manual' });
  }
}

initialize();
