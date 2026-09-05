# Personal Website — leo-ricci.com

A static Firebase Hosting site for Leo Ricci.

## Routes

- `/` — personal landing page
- `/fantasy/` — mobile-first and desktop-ready fantasy football draft guide

The Shotgun AI product site (`shotgun.leo-ricci.com`) lives in the [`shotgun-ai`](https://github.com/ldricci3/shotgun-ai) repository under `website/`.

## Local preview

From the repository root:

```bash
python3 -m http.server 8080 --directory site
```

Then open [http://localhost:8080/fantasy/](http://localhost:8080/fantasy/).

## Tests

The draft guide uses browser ES modules and Node's built-in test runner, with no application build step or runtime dependencies.

```bash
npm test
```

The tests cover player filtering and sorting, drafted-player exclusion, name fallback matching, roster-slot assignment, user/slot and draft selection, snake-draft pick calculations, ID validation, local preference/cache behavior, and the complete static player dataset.

## Player-value data

`site/fantasy/data/player-values.json` contains 219 QB/RB/WR/TE players from the 2026 Subvertadown half-PPR board, plus current FantasyPros redraft/dynasty ECR and historically calibrated 2027/2028 keeper-option outputs. All 219 rows, including the original top 24, have complete forecasts. Current BEER+ and future keeper value stay separate in the interface.

Sleeper IDs are joined through the DynastyProcess player crosswalk. Current coverage is 219 of 219 players, all by exact 2026 FantasyPros ID. The generator, assumptions, aliases, and validation details are documented in [`site/fantasy/data/README.md`](site/fantasy/data/README.md).

Regenerate the file inside the current Muse workspace, where the keeper-model inputs live, with:

```bash
python3 scripts/generate-fantasy-player-data.py
```

For another environment, pass `--model`, `--existing-scores`, and `--crosswalk` with paths to the three inputs documented in [`site/fantasy/data/README.md`](site/fantasy/data/README.md). Those source files are intentionally not duplicated in this repository. The generator never mutates the source keeper model; it runs a temporary full-board adaptation and writes only the static website JSON.

## Sleeper behavior

The draft guide uses Sleeper's documented, public, read-only API at `https://api.sleeper.app/v1`. It does not need a login or token and never writes to Sleeper. It reads:

- `GET /league/{league_id}`
- `GET /league/{league_id}/users`
- `GET /league/{league_id}/drafts`
- `GET /draft/{draft_id}`
- `GET /draft/{draft_id}/picks`

League ID, selected draft ID, team/slot choice, sort preference, and the show-drafted preference are stored only in the browser's local storage. There is no hard-coded league ID. A direct draft-ID field supports standalone mocks that are not returned by the league-drafts endpoint.

Every Sleeper request has an eight-second timeout. While a draft is open and the page is visible, picks refresh about every five seconds. Polling stops when the page is hidden and refreshes when it becomes visible or focused. The last successful pick state is cached locally so a temporary connection failure does not empty the board. The page displays whether data is live, cached, stale, or unavailable.

The roster view uses the league's fixed lineup shape: 1 QB, 2 RB, 2 WR, 1 TE, 2 FLEX, 1 K, 1 DEF, and 5 bench spots. Picks are assigned chronologically to the first eligible open slot. K, DEF, and any other Sleeper pick without a value-model row still appears using the pick metadata.

## Limitations

- Player values are a static 2026 snapshot and require regeneration when the source board or keeper model changes.
- Keeper forecasts are probabilistic estimates from a limited historical window, not guarantees. The interface keeps them separate from current BEER+ value.
- The guide depends on Sleeper's public API being reachable and retaining the documented response shapes. Cached picks cover temporary failures, not missing draft metadata on a first load.
- The guide is read-only. It cannot make a pick, change a roster, or modify a Sleeper draft.

## Deploy

```bash
firebase login
firebase use --add
firebase deploy --only hosting
```

## Structure

```text
site/
  index.html                 personal landing page
  style.css                  landing-page styles
  fantasy/
    index.html               draft-guide UI
    style.css                responsive draft-guide styles
    app.js                   Sleeper integration and rendering
    draft-core.js            pure filtering, roster, selection, and cache helpers
    data/player-values.json  committed player-value dataset
scripts/
  generate-fantasy-player-data.py
tests/
  draft-core.test.mjs
  player-data.test.mjs
```
