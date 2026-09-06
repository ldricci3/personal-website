#!/usr/bin/env python3
"""Generate the static fantasy player-value dataset from the calibrated model.

The authoritative model and its inputs live in the Fantasy Draft Primer goal.
This script never edits those files: it copies the model to a temporary directory,
applies the small full-board scoring adaptation there, runs it, and transforms the
result into static JSON for the website.
"""
from __future__ import annotations

import argparse
import csv
from datetime import date
import json
import math
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import unicodedata

DEFAULT_MODEL = Path("/home/hatch/workspace/goals/fantasy-football-draft-primer/hidden_files/keeper-model-results/build_keeper_model.py")
DEFAULT_EXISTING_SCORES = Path("/home/hatch/workspace/goals/fantasy-football-draft-primer/hidden_files/keeper-model-results/scored_players.csv")
DEFAULT_CROSSWALK = Path("/home/hatch/workspace/goals/fantasy-football-draft-primer/hidden_files/keeper-model-inputs/dynastyprocess/db_playerids.csv")
DEFAULT_OUTPUT = Path("site/fantasy/data/player-values.json")

# Team spellings differ between sources. Keep this explicit and auditable.
TEAM_ALIASES = {
    "JAX": "JAC",
    "LV": "LVR",
    "OAK": "LVR",
    "SD": "LAC",
    "STL": "LAR",
    "WSH": "WAS",
}

# Only add an entry after verifying that the source and crosswalk refer to the
# same player. The current 2026 dataset needs no player-name aliases.
PLAYER_NAME_ALIASES: dict[str, str] = {}

MODEL_NUMERIC_FIELDS = {
    "Overall Rank": ("overallRank", int),
    "Position Rank": ("positionRank", int),
    "Team Depth": ("teamDepth", int),
    "Bye Week": ("byeWeek", int),
    "BEER+ Value": ("beerPlus", float),
    "fantasypros_id": ("fantasyProsId", int),
    "fp_redraft_ecr_2026": ("fantasyProsRedraftEcr2026", float),
    "fp_dynasty_ecr_2026": ("fantasyProsDynastyEcr2026", float),
    "predicted_2027_rank_median": ("predicted2027RankMedian", float),
    "predicted_2028_rank_median": ("predicted2028RankMedian", float),
    "keeper_prob_r3": ("keeperProbabilityRound3", float),
    "keeper_prob_r4": ("keeperProbabilityRound4", float),
    "keeper_option_2027_r3": ("keeperSurplus2027Round3", float),
    "keeper_option_2027_r4": ("keeperSurplus2027Round4", float),
    "keeper_option_2028_r3": ("keeperSurplus2028Round3", float),
    "keeper_option_2028_r4": ("keeperSurplus2028Round4", float),
    "keeper_option_total_r3": ("keeperSurplusTotalRound3", float),
    "keeper_option_total_r4": ("keeperSurplusTotalRound4", float),
    "keeper_option_2027": ("keeperOption2027", float),
    "keeper_option_2028": ("keeperOption2028", float),
    "keeper_option_total": ("keeperOptionTotal", float),
    "keeper_total_discount_40": ("keeperOptionTotalDiscount40", float),
    "keeper_total_discount_80": ("keeperOptionTotalDiscount80", float),
    "prob_second_year_given_r3": ("secondYearProbabilityGivenRound3", float),
    "prob_second_year_given_r4": ("secondYearProbabilityGivenRound4", float),
}


def normalize_name(value: str) -> str:
    value = PLAYER_NAME_ALIASES.get(value, value)
    text = unicodedata.normalize("NFKD", value).encode("ascii", "ignore").decode().lower()
    text = re.sub(r"\b(jr|sr|ii|iii|iv)\b", "", text)
    return re.sub(r"[^a-z0-9]", "", text)


def normalize_team(value: str) -> str:
    team = (value or "").strip().upper()
    return TEAM_ALIASES.get(team, team)


def present(value: str | None) -> bool:
    return bool(value and value.strip() and value.strip().upper() not in {"NA", "N/A", "NULL", "NONE"})


def as_int(value: str) -> int:
    number = float(value)
    if not math.isfinite(number) or not number.is_integer():
        raise ValueError(f"Expected integer, got {value!r}")
    return int(number)


def adapt_model(source: Path, destination: Path) -> None:
    text = source.read_text()
    replacements = {
        "OUT = ROOT/'goals/fantasy-football-draft-primer/hidden_files/keeper-model-results'":
            "OUT = Path(__import__('os').environ['FANTASY_MODEL_OUT'])",
        "BOARD_PATH = ROOT/'your_files/subvertadown-2026-unadjusted-values/Subvertadown 2026 Unadjusted Values.csv'":
            "BOARD_PATH = Path(__import__('os').environ['FANTASY_BOARD_INPUT'])",
        "    out=board.copy()\n    # current is board-ordered.":
            "    out=board.copy()\n    out['fantasypros_id']=current.id.to_numpy()\n    # current is board-ordered.",
        "    for i,row in current.reset_index(drop=True).iterrows():\n":
            "    current_reset=current.reset_index(drop=True)\n    score_order=list(board.index[board['Overall Rank']>24])+list(board.index[board['Overall Rank']<=24])\n    for i in score_order:\n        row=current_reset.iloc[i]\n",
        "        if int(board.iloc[i]['Overall Rank'])<=24: continue\n": "",
        "    assert scored.loc[scored['Overall Rank']<=24,'keeper_option_total'].isna().all()\n":
            "    assert scored['keeper_option_total'].notna().all()\n",
        "    assert scored.loc[scored['Overall Rank']>24,'keeper_option_total'].notna().all()\n": "",
        "    vals=scored.loc[scored['Overall Rank']>24,['keeper_prob_r3','keeper_prob_r4','keeper_option_total']].to_numpy(float)":
            "    vals=scored[['keeper_prob_r3','keeper_prob_r4','keeper_option_total']].to_numpy(float)",
    }
    for old, new in replacements.items():
        if text.count(old) != 1:
            raise RuntimeError(f"Model adaptation point changed or is ambiguous: {old!r}")
        text = text.replace(old, new)
    destination.write_text(text)


def run_full_model(model_path: Path, existing_scores: Path, temp_dir: Path) -> Path:
    copied_model = temp_dir / "build_keeper_model_full_board.py"
    model_output = temp_dir / "model-output"
    model_output.mkdir()
    adapt_model(model_path, copied_model)
    env = os.environ.copy()
    env["FANTASY_MODEL_OUT"] = str(model_output)
    env["FANTASY_BOARD_INPUT"] = str(existing_scores)
    completed = subprocess.run(
        [sys.executable, str(copied_model)],
        env=env,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        check=False,
    )
    if completed.returncode:
        raise RuntimeError(
            "Full-board model run failed.\n"
            f"stdout:\n{completed.stdout}\n"
            f"stderr:\n{completed.stderr}"
        )
    return model_output / "scored_players.csv"


def load_crosswalk(path: Path) -> tuple[dict[int, list[dict[str, str]]], list[dict[str, str]]]:
    with path.open(newline="", encoding="utf-8-sig") as handle:
        rows = list(csv.DictReader(handle))
    usable = [row for row in rows if present(row.get("sleeper_id"))]
    usable.sort(key=lambda row: as_int(row["db_season"]), reverse=True)

    by_fantasypros: dict[int, list[dict[str, str]]] = {}
    for row in usable:
        if present(row.get("fantasypros_id")):
            by_fantasypros.setdefault(as_int(row["fantasypros_id"]), []).append(row)

    # Fallback matching considers only the latest record for each Sleeper ID.
    latest_by_sleeper: dict[str, dict[str, str]] = {}
    for row in usable:
        latest_by_sleeper.setdefault(row["sleeper_id"].strip(), row)
    latest = list(latest_by_sleeper.values())
    return by_fantasypros, latest


def unique_sleeper(rows: list[dict[str, str]]) -> str | None:
    ids = {row["sleeper_id"].strip() for row in rows}
    return next(iter(ids)) if len(ids) == 1 else None


def find_sleeper_id(
    player: dict[str, str],
    by_fantasypros: dict[int, list[dict[str, str]]],
    latest: list[dict[str, str]],
) -> tuple[str | None, str, dict[str, str] | None]:
    fantasypros_id = as_int(player["fantasypros_id"])
    direct = by_fantasypros.get(fantasypros_id, [])
    if direct:
        latest_season = max(as_int(row["db_season"]) for row in direct)
        latest_direct = [row for row in direct if as_int(row["db_season"]) == latest_season]
        sleeper_id = unique_sleeper(latest_direct)
        if sleeper_id:
            return sleeper_id, "fantasyProsId", latest_direct[0]
        raise RuntimeError(f"Conflicting latest-season Sleeper IDs for FantasyPros ID {fantasypros_id}")

    name = normalize_name(player["Player"])
    position = player["Position"].strip().upper()
    team = normalize_team(player["Team"])
    candidates = [
        row for row in latest
        if normalize_name(row["name"]) == name
        and row["position"].strip().upper() == position
        and normalize_team(row["team"]) == team
    ]
    sleeper_id = unique_sleeper(candidates)
    if sleeper_id:
        return sleeper_id, "namePositionTeam", candidates[0]

    # A traded/free-agent team can be stale in either source. Permit a teamless
    # fallback only when normalized name + position resolves to one Sleeper ID.
    candidates = [
        row for row in latest
        if normalize_name(row["name"]) == name
        and row["position"].strip().upper() == position
    ]
    sleeper_id = unique_sleeper(candidates)
    if sleeper_id:
        return sleeper_id, "namePositionUnique", candidates[0]
    return None, "unmatched", None


def convert_number(source: str, converter: type[int] | type[float], field: str, player: str) -> int | float:
    if not present(source):
        raise ValueError(f"Missing numeric field {field!r} for {player}")
    value = converter(source) if converter is float else as_int(source)
    if isinstance(value, float) and not math.isfinite(value):
        raise ValueError(f"Non-finite numeric field {field!r} for {player}")
    return value


def build_payload(scored_csv: Path, crosswalk_csv: Path, model_source: Path) -> dict[str, object]:
    with scored_csv.open(newline="", encoding="utf-8-sig") as handle:
        scored = list(csv.DictReader(handle))
    if len(scored) != 219:
        raise RuntimeError(f"Expected 219 scored players, found {len(scored)}")

    by_fantasypros, latest = load_crosswalk(crosswalk_csv)
    players: list[dict[str, object]] = []
    unmatched: list[dict[str, object]] = []
    methods: dict[str, int] = {}
    match_seasons: dict[str, int] = {}

    for row in scored:
        name = row["Player"]
        sleeper_id, match_method, matched_row = find_sleeper_id(row, by_fantasypros, latest)
        methods[match_method] = methods.get(match_method, 0) + 1
        match_season = as_int(matched_row["db_season"]) if matched_row else None
        if match_season is not None:
            key = str(match_season)
            match_seasons[key] = match_seasons.get(key, 0) + 1
        model_key = f"{normalize_name(name)}:{row['Position'].strip().lower()}"
        item: dict[str, object] = {
            "modelKey": model_key,
            "sleeperId": sleeper_id,
            "name": name,
            "position": row["Position"],
            "team": row["Team"],
            "draftSlot": row["Draft Slot"],
            "adpDeltaDisplay": row["ADP Delta Display"],
            "primaryValue": row["Primary Value"],
            "sourceDraftUrl": row["Source Draft URL"],
            "modelCoverage": row["model_coverage"],
            "modelConfidence": row["model_confidence"],
            "modelKeyInputs": row["model_key_inputs"],
            "sleeperMatchMethod": match_method,
            "sleeperMatchSeason": match_season,
        }
        for source_key, (output_key, converter) in MODEL_NUMERIC_FIELDS.items():
            item[output_key] = convert_number(row[source_key], converter, source_key, name)
        players.append(item)
        if sleeper_id is None:
            unmatched.append({
                "modelKey": model_key,
                "name": name,
                "position": row["Position"],
                "team": row["Team"],
                "fantasyProsId": item["fantasyProsId"],
            })

    keys = [player["modelKey"] for player in players]
    if len(set(keys)) != len(keys):
        raise RuntimeError("Generated model keys are not unique")

    matched = len(players) - len(unmatched)
    return {
        "metadata": {
            "generatedDate": date.today().isoformat(),
            "rowCount": len(players),
            "sleeperIdCoverage": {
                "matched": matched,
                "unmatched": len(unmatched),
                "percent": round(100 * matched / len(players), 2),
                "matchMethods": methods,
                "matchSeasons": match_seasons,
                "unmatchedPlayers": unmatched,
            },
            "sources": {
                "modelPipeline": model_source.name,
                "sleeperCrosswalk": "DynastyProcess db_playerids.csv",
                "currentValues": "Subvertadown 2026 unadjusted half-PPR BEER+ draft board consumed by the model pipeline",
                "forecastInputs": "DynastyProcess FantasyPros preseason redraft/dynasty ECR and nflverse player/production data",
            },
            "model": {
                "forecastSeasons": [2027, 2028],
                "keeperCosts": {"round3PickRange": [25, 36], "round4PickRange": [37, 48]},
                "secondYearDiscount": 0.6,
                "monteCarloDraws": 20000,
                "seed": 20260905,
                "aliases": {
                    "team": TEAM_ALIASES,
                    "playerName": PLAYER_NAME_ALIASES,
                },
                "caveats": [
                    "Forecasts are calibrated from preseason ranks available for 2021-2026; the historical window is limited.",
                    "2027 and 2028 ranks are distributions inferred from out-of-time residuals, not guarantees of future performance.",
                    "The generic keeper-option values equally weight Round 3 and Round 4 assignment; enforce the league's two-keeper limit at roster level.",
                    "Top-24 players are scored for fall-past-Round-2 scenarios even though they are not normally keeper-eligible at their listed rank.",
                    "Model confidence is coarse and describes input completeness, not a calibrated confidence interval.",
                ],
            },
        },
        "players": players,
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", type=Path, default=DEFAULT_MODEL)
    parser.add_argument("--existing-scores", type=Path, default=DEFAULT_EXISTING_SCORES)
    parser.add_argument("--crosswalk", type=Path, default=DEFAULT_CROSSWALK)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    for path in [args.model, args.existing_scores, args.crosswalk]:
        if not path.is_file():
            raise FileNotFoundError(path)
    with tempfile.TemporaryDirectory(prefix="fantasy-player-data-") as temp:
        scored_csv = run_full_model(args.model, args.existing_scores, Path(temp))
        payload = build_payload(scored_csv, args.crosswalk, args.model)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n")
    coverage = payload["metadata"]["sleeperIdCoverage"]
    print(json.dumps({"output": str(args.output), "rowCount": len(payload["players"]), "sleeperIdCoverage": coverage}, indent=2))


if __name__ == "__main__":
    main()
