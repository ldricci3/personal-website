# Fantasy player values

`player-values.json` is the static 2026 draft-board dataset for the fantasy draft manager. It contains all 219 QB/RB/WR/TE rows from the Subvertadown half-PPR BEER+ board plus a separate, direct dynasty-ranking view of future keeper value.

Generate it from the repository root with:

```bash
python3 scripts/generate-fantasy-player-data.py
```

## Current value

Current value is the original 2026 Subvertadown half-PPR BEER+ value. The generator copies it unchanged from the board source. It is never blended with keeper value.

## Future keeper value

The future proxy is FantasyPros consensus `dynasty-overall` ECR from the DynastyProcess `db_fpecr_latest.csv` snapshot dated **September 4, 2026**. The source file records the FantasyPros page as `/nfl/rankings/dynasty-overall.php` and ECR type `do`.

The source dataset does **not** identify a scoring format, so the site labels the number only as FantasyPros consensus dynasty ECR. It does not claim that the ranking is half-PPR.

The generator matches all 219 board rows to this snapshot by a unique normalized player name plus position. Every match retains the FantasyPros ID from the source row. Generation fails instead of imputing a rank when any player is missing or ambiguous. Current audited coverage is **219 of 219 players**, with 219 unique FantasyPros IDs.

There is no predicted 2027 rank, predicted 2028 rank, probability model, Monte Carlo simulation, or hidden weighting. Dynasty ECR is shown directly.

## Round 3 and Round 4 comparisons

A Round 3 keeper can cost pick 25 through 36 in a 12-team league. A Round 4 keeper can cost pick 37 through 48. For each end of each range, the deterministic comparison is:

```text
rank edge = keeper-cost pick − dynasty ECR
```

A positive rank edge means the player is ranked earlier than the forfeited pick; a negative edge means the player is ranked later. The site shows the full range rather than choosing an arbitrary midpoint. It also labels the comparison as:

- `aheadOfRound`: dynasty ECR is earlier than every pick in the round.
- `withinRound`: dynasty ECR falls within that round, so the exact team slot matters.
- `behindRound`: dynasty ECR is later than every pick in the round.

All 219 players, including the original top 24, receive the same direct comparison. A player becomes keeper-eligible only when actually drafted after Round 2, so preseason board rank cannot be used to omit anyone.

Dynasty ECR prices youth and long career value beyond this league's two-season keeper horizon. It may therefore be conservative for older productive players. Keeping current BEER+ beside dynasty ECR makes that bias visible rather than hiding it in a custom adjustment.

## Sleeper IDs

Sleeper IDs come from the DynastyProcess `db_playerids.csv` crosswalk and join through the verified FantasyPros ID. Current coverage is **219 of 219 Sleeper IDs (100%)**, all from the 2026 crosswalk season. There are no unmatched players and no player-name fallback aliases.

Team-code aliases remain explicit in the generated metadata (`JAX→JAC`, `LV/OAK→LVR`, `SD→LAC`, `STL→LAR`, and `WSH→WAS`) for live Sleeper pick matching.
