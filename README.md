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

The tests cover account and league discovery; the standalone-mock draft-ID path using a real Sleeper response shape; cache-busting for live draft reads; stale-response rejection; context-scoped persistence; player filtering and sorting; drafted-player exclusion; name fallback matching; roster-slot assignment; user/slot and draft selection; snake-draft pick calculations; ID validation; local preference/cache behavior; and the complete static player dataset.

## Player-value data

`site/fantasy/data/player-values.json` contains 219 QB/RB/WR/TE players from the 2026 Subvertadown half-PPR board. Current BEER+ remains the primary draft value. Future value is the direct FantasyPros consensus dynasty-overall ECR from the DynastyProcess snapshot dated September 4, 2026; there is no homegrown 2027/2028 forecast or simulation.

Each player has separate deterministic Round 3 and Round 4 comparisons. The calculation is simply `possible keeper-cost pick minus dynasty ECR`: positive means the player's dynasty rank is earlier than the forfeited pick. The page shows the full possible edge range because the cost depends on draft slot. All 219 rows, including the original top 24, are scored because keeper eligibility depends on where the player is actually drafted.

Sleeper IDs are joined through the DynastyProcess player crosswalk. Current coverage is 219 of 219 players, all by exact 2026 FantasyPros ID. The dynasty source has one unique player-name + position match for every board row. The source file does not identify its scoring format, so the page does not claim that dynasty ECR is half-PPR. Details are documented in [`site/fantasy/data/README.md`](site/fantasy/data/README.md).

Regenerate the file inside the current Muse workspace, where the source board and DynastyProcess inputs live, with:

```bash
python3 scripts/generate-fantasy-player-data.py
```

For another environment, pass `--board`, `--dynasty-ecr`, and `--crosswalk` with paths to the three inputs documented in [`site/fantasy/data/README.md`](site/fantasy/data/README.md). Those source files are intentionally not duplicated in this repository. The generator reads them, verifies complete one-to-one matching, and writes only the static website JSON.

## Sleeper behavior

The draft guide uses Sleeper's documented, public, read-only API at `https://api.sleeper.app/v1`. It does not need a login or token and never writes to Sleeper. It reads:

- `GET /user/{username_or_user_id}`
- `GET /user/{user_id}/leagues/nfl/2026`
- `GET /league/{league_id}`
- `GET /league/{league_id}/users`
- `GET /league/{league_id}/drafts`
- `GET /draft/{draft_id}`
- `GET /draft/{draft_id}/picks`

The user enters a Sleeper username or numeric user ID, and the guide lists that account's 2026 NFL leagues by name. Standalone mocks are different: Sleeper's public account-drafts endpoint omitted a live standalone mock in production testing, even though direct draft lookup returned it normally. The guide therefore does not claim username-based mock discovery. To follow a standalone mock, the user enters the numeric draft ID from its Sleeper URL. The guide uses only the draft's top-level `league_id` as an official league association and does not infer one from copied mock metadata.

Account, league, league-draft, direct mock, team/slot, sort, and show-drafted choices are stored only in the browser's local storage. League choices are scoped per account, league drafts per league, and team choices per draft so saved state cannot leak across contexts.

Every Sleeper request has an eight-second timeout. While a draft is open and the page is visible, picks refresh about every five seconds. Sleeper serves the picks endpoint through a public CDN cache (`s-maxage=15`, with stale responses permitted while it revalidates), so every initial and polled live-draft read gets a unique query parameter rather than reusing a cached URL. Polling stops when the page is hidden and refreshes immediately when it becomes visible or focused. The last successful pick state is cached locally so a temporary connection failure does not empty the board. The page displays whether data is live, cached, stale, or unavailable.

The roster view uses the league's fixed lineup shape: 1 QB, 2 RB, 2 WR, 1 TE, 2 FLEX, 1 K, 1 DEF, and 5 bench spots. Picks are assigned chronologically to the first eligible open slot. K, DEF, and any other Sleeper pick without a player-value row still appears using the pick metadata.

## Limitations

- Player values are a static 2026 snapshot and require regeneration when the source board or dynasty-ranking snapshot changes.
- Dynasty rankings value youth and long careers more than this league's two-season keeper window, so they may underrate older players who still project well in the near term. Current BEER+ remains visible as the counterweight.
- The DynastyProcess source does not identify the scoring format for `dynasty-overall`, so the page presents it as general consensus dynasty ECR rather than half-PPR dynasty ECR.
- The guide depends on Sleeper's public API being reachable and retaining the documented response shapes. Cached picks cover temporary failures, not missing draft metadata on a first load.
- Standalone mocks require their numeric draft ID because Sleeper does not reliably return them from its account-drafts endpoint.
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
