# Fantasy player values

`player-values.json` is the static 2026 draft-board dataset for the fantasy draft manager. It contains all 219 QB/RB/WR/TE rows from the Subvertadown half-PPR BEER+ board, current FantasyPros redraft and dynasty ECR, calibrated 2027/2028 rank forecasts, Round 3 and Round 4 keeper probabilities and expected surpluses, composite keeper-option values, sensitivity outputs, and model coverage/confidence labels.

Generate it from the repository root with:

```bash
python3 scripts/generate-fantasy-player-data.py
```

The generator copies `build_keeper_model.py` into a temporary directory, points it at the existing `scored_players.csv` as the immutable board input, removes the top-24 scoring skip and related assertions in that temporary copy, and reruns the full model. It scores ranks 25-219 first so their seeded Monte Carlo values remain identical to the existing output, then applies the same calculations to ranks 1-24. It does not modify the goal's model or input files. The model uses DynastyProcess FantasyPros preseason ECR history and nflverse player/production data; see the JSON metadata for assumptions and caveats.

Sleeper IDs come from the DynastyProcess `db_playerids.csv` crosswalk. Matching first uses each player's model FantasyPros ID against the latest available crosswalk season, then permits normalized name + position + team and unique normalized name + position fallbacks. The generator declares team-code aliases in its metadata (`JAX→JAC`, `LV/OAK→LVR`, `SD→LAC`, `STL→LAR`, and `WSH→WAS`); no player-name aliases are currently needed.

Current coverage is **219 of 219 Sleeper IDs (100%)**, all matched by exact FantasyPros ID in the 2026 crosswalk season. There are **no unmatched players**, and no fallback aliases were used. The deterministic checks live in `tests/player-data.test.mjs` and run with `node --test tests/player-data.test.mjs`.
