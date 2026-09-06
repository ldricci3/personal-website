#!/usr/bin/env python3
"""Generate the fantasy draft board with direct dynasty keeper comparisons.

Current BEER+ values come from the existing Subvertadown board. Future value is
not forecast: it is the latest FantasyPros consensus dynasty-overall ECR from
the DynastyProcess snapshot, compared directly with Round 3 and Round 4 costs.
"""
from __future__ import annotations

import argparse
import csv
from datetime import datetime
import json
import math
from pathlib import Path
import re
import unicodedata
from zoneinfo import ZoneInfo

DEFAULT_BOARD = Path(
    "/home/hatch/workspace/goals/fantasy-football-draft-primer/hidden_files/keeper-model-results/scored_players.csv"
)
DEFAULT_DYNASTY_ECR = Path(
    "/home/hatch/workspace/goals/fantasy-football-draft-primer/hidden_files/keeper-model-inputs/dynastyprocess/db_fpecr_latest.csv"
)
DEFAULT_CROSSWALK = Path(
    "/home/hatch/workspace/goals/fantasy-football-draft-primer/hidden_files/keeper-model-inputs/dynastyprocess/db_playerids.csv"
)
DEFAULT_OUTPUT = Path("site/fantasy/data/player-values.json")

POSITIONS = {"QB", "RB", "WR", "TE"}
ROUND_3_RANGE = (25, 36)
ROUND_4_RANGE = (37, 48)

TEAM_ALIASES = {
    "JAX": "JAC",
    "LV": "LVR",
    "OAK": "LVR",
    "SD": "LAC",
    "STL": "LAR",
    "WSH": "WAS",
}

PLAYER_NAME_ALIASES: dict[str, str] = {}

BOARD_NUMERIC_FIELDS = {
    "Overall Rank": ("overallRank", int),
    "Position Rank": ("positionRank", int),
    "Team Depth": ("teamDepth", int),
    "Bye Week": ("byeWeek", int),
    "BEER+ Value": ("beerPlus", float),
}


def normalize_name(value: str) -> str:
    value = PLAYER_NAME_ALIASES.get(value, value)
    text = unicodedata.normalize("NFKD", value).encode("ascii", "ignore").decode().lower()
    text = re.sub(r"\b(jr|sr|ii|iii|iv)\b", "", text)
    return re.sub(r"[^a-z0-9]", "", text)


def normalize_team(value: str) -> str:
    team = (value or "").strip().upper()
    return TEAM_ALIASES.get(team, team)


def player_key(name: str, position: str) -> str:
    return f"{normalize_name(name)}:{position.strip().upper()}"


def present(value: str | None) -> bool:
    return bool(value and value.strip() and value.strip().upper() not in {"NA", "N/A", "NULL", "NONE"})


def as_int(value: str) -> int:
    number = float(value)
    if not math.isfinite(number) or not number.is_integer():
        raise ValueError(f"Expected integer, got {value!r}")
    return int(number)


def as_float(value: str, field: str, player: str) -> float:
    if not present(value):
        raise ValueError(f"Missing numeric field {field!r} for {player}")
    number = float(value)
    if not math.isfinite(number):
        raise ValueError(f"Non-finite numeric field {field!r} for {player}")
    return number


def convert_board_number(source: str, converter: type[int] | type[float], field: str, player: str) -> int | float:
    if converter is int:
        if not present(source):
            raise ValueError(f"Missing numeric field {field!r} for {player}")
        return as_int(source)
    return as_float(source, field, player)


def load_board(path: Path) -> list[dict[str, str]]:
    with path.open(newline="", encoding="utf-8-sig") as handle:
        rows = list(csv.DictReader(handle))
    if len(rows) != 219:
        raise RuntimeError(f"Expected 219 board players, found {len(rows)}")
    ranks = [as_int(row["Overall Rank"]) for row in rows]
    if sorted(ranks) != list(range(1, 220)):
        raise RuntimeError("Board must contain each overall rank from 1 through 219 exactly once")
    keys = [player_key(row["Player"], row["Position"]) for row in rows]
    if len(set(keys)) != len(keys):
        raise RuntimeError("Board player name + position keys are not unique")
    return rows


def load_latest_dynasty_ecr(path: Path) -> tuple[dict[str, dict[str, str]], str, str, str]:
    with path.open(newline="", encoding="utf-8-sig") as handle:
        rows = list(csv.DictReader(handle))
    candidates = [
        row for row in rows
        if row.get("page_type") == "dynasty-overall"
        and row.get("pos", "").strip().upper() in POSITIONS
        and present(row.get("scrape_date"))
    ]
    if not candidates:
        raise RuntimeError("No FantasyPros dynasty-overall rows found")
    snapshot_date = max(row["scrape_date"].strip()[:10] for row in candidates)
    snapshot = [row for row in candidates if row["scrape_date"].strip()[:10] == snapshot_date]
    pages = {row.get("fp_page", "").strip() for row in snapshot}
    ecr_types = {row.get("ecr_type", "").strip() for row in snapshot}
    if len(pages) != 1 or len(ecr_types) != 1:
        raise RuntimeError("Dynasty snapshot has ambiguous source-page metadata")

    by_key: dict[str, dict[str, str]] = {}
    for row in snapshot:
        key = player_key(row["player"], row["pos"])
        if key in by_key:
            raise RuntimeError(f"Ambiguous dynasty ECR match for {key}")
        as_int(row["id"])
        as_float(row["ecr"], "ecr", row["player"])
        by_key[key] = row
    return by_key, snapshot_date, next(iter(pages)), next(iter(ecr_types))


def load_crosswalk(path: Path) -> dict[int, dict[str, str]]:
    with path.open(newline="", encoding="utf-8-sig") as handle:
        rows = list(csv.DictReader(handle))
    usable = [
        row for row in rows
        if present(row.get("fantasypros_id"))
        and present(row.get("sleeper_id"))
        and present(row.get("db_season"))
    ]
    usable.sort(key=lambda row: as_int(row["db_season"]), reverse=True)
    latest_by_fantasypros: dict[int, dict[str, str]] = {}
    for row in usable:
        fantasypros_id = as_int(row["fantasypros_id"])
        existing = latest_by_fantasypros.get(fantasypros_id)
        if existing and as_int(existing["db_season"]) == as_int(row["db_season"]):
            if existing["sleeper_id"].strip() != row["sleeper_id"].strip():
                raise RuntimeError(f"Conflicting Sleeper IDs for FantasyPros ID {fantasypros_id}")
            continue
        latest_by_fantasypros.setdefault(fantasypros_id, row)
    return latest_by_fantasypros


def comparison_for_rank(rank: float, pick_range: tuple[int, int]) -> str:
    first_pick, last_pick = pick_range
    if rank < first_pick:
        return "aheadOfRound"
    if rank <= last_pick:
        return "withinRound"
    return "behindRound"


def rank_edges(rank: float, pick_range: tuple[int, int]) -> tuple[float, float]:
    first_pick, last_pick = pick_range
    return round(first_pick - rank, 2), round(last_pick - rank, 2)


def build_payload(
    board_csv: Path,
    dynasty_ecr_csv: Path,
    crosswalk_csv: Path,
) -> dict[str, object]:
    board = load_board(board_csv)
    dynasty_by_key, snapshot_date, source_page, ecr_type = load_latest_dynasty_ecr(dynasty_ecr_csv)
    crosswalk = load_crosswalk(crosswalk_csv)

    players: list[dict[str, object]] = []
    missing_dynasty: list[str] = []
    missing_sleeper: list[dict[str, object]] = []
    match_seasons: dict[str, int] = {}

    for row in board:
        name = row["Player"]
        position = row["Position"].strip().upper()
        key = player_key(name, position)
        dynasty_row = dynasty_by_key.get(key)
        if dynasty_row is None:
            missing_dynasty.append(f"{name} ({position})")
            continue

        fantasypros_id = as_int(dynasty_row["id"])
        dynasty_rank = as_float(dynasty_row["ecr"], "ecr", name)
        crosswalk_row = crosswalk.get(fantasypros_id)
        sleeper_id = crosswalk_row["sleeper_id"].strip() if crosswalk_row else None
        match_season = as_int(crosswalk_row["db_season"]) if crosswalk_row else None
        if match_season is not None:
            season_key = str(match_season)
            match_seasons[season_key] = match_seasons.get(season_key, 0) + 1
        if sleeper_id is None:
            missing_sleeper.append({
                "modelKey": f"{normalize_name(name)}:{position.lower()}",
                "name": name,
                "position": position,
                "fantasyProsId": fantasypros_id,
            })

        round3_min, round3_max = rank_edges(dynasty_rank, ROUND_3_RANGE)
        round4_min, round4_max = rank_edges(dynasty_rank, ROUND_4_RANGE)
        item: dict[str, object] = {
            "modelKey": f"{normalize_name(name)}:{position.lower()}",
            "sleeperId": sleeper_id,
            "name": name,
            "position": position,
            "team": row["Team"],
            "draftSlot": row["Draft Slot"],
            "adpDeltaDisplay": row["ADP Delta Display"],
            "primaryValue": row["Primary Value"],
            "sourceDraftUrl": row["Source Draft URL"],
            "fantasyProsId": fantasypros_id,
            "fantasyProsDynastyEcr2026": dynasty_rank,
            "keeperRound3Comparison": comparison_for_rank(dynasty_rank, ROUND_3_RANGE),
            "keeperRound3RankEdgeMin": round3_min,
            "keeperRound3RankEdgeMax": round3_max,
            "keeperRound4Comparison": comparison_for_rank(dynasty_rank, ROUND_4_RANGE),
            "keeperRound4RankEdgeMin": round4_min,
            "keeperRound4RankEdgeMax": round4_max,
            "sleeperMatchMethod": "fantasyProsId" if sleeper_id else "unmatched",
            "sleeperMatchSeason": match_season,
        }
        for source_key, (output_key, converter) in BOARD_NUMERIC_FIELDS.items():
            item[output_key] = convert_board_number(row[source_key], converter, source_key, name)
        players.append(item)

    if missing_dynasty:
        raise RuntimeError(f"Missing direct dynasty ECR for {len(missing_dynasty)} players: {missing_dynasty}")
    if len(players) != 219:
        raise RuntimeError(f"Expected 219 generated players, found {len(players)}")
    if len({player["fantasyProsId"] for player in players}) != 219:
        raise RuntimeError("FantasyPros IDs are not unique across all 219 players")

    matched = len(players) - len(missing_sleeper)
    return {
        "metadata": {
            "generatedDate": datetime.now(ZoneInfo("America/New_York")).date().isoformat(),
            "rowCount": len(players),
            "sleeperIdCoverage": {
                "matched": matched,
                "unmatched": len(missing_sleeper),
                "percent": round(100 * matched / len(players), 2),
                "matchMethods": {"fantasyProsId": matched},
                "matchSeasons": match_seasons,
                "unmatchedPlayers": missing_sleeper,
            },
            "sources": {
                "currentValues": "Subvertadown 2026 unadjusted half-PPR BEER+ draft board",
                "dynastyRanking": {
                    "provider": "FantasyPros",
                    "dataset": "DynastyProcess db_fpecr_latest.csv",
                    "pageType": "dynasty-overall",
                    "sourcePage": source_page,
                    "ecrType": ecr_type,
                    "snapshotDate": snapshot_date,
                    "scoringFormat": "Not identified in the source dataset; this is not labeled half-PPR.",
                    "matchedPlayers": len(players),
                    "matching": "Unique normalized player name plus position; FantasyPros ID retained for Sleeper crosswalk.",
                },
                "sleeperCrosswalk": "DynastyProcess db_playerids.csv",
            },
            "keeperComparison": {
                "method": "Direct FantasyPros consensus dynasty ECR compared with the possible pick costs in each keeper round. No forecast, simulation, probability, or multi-year weighting is used.",
                "round3PickRange": list(ROUND_3_RANGE),
                "round4PickRange": list(ROUND_4_RANGE),
                "rankEdgeFormula": "cost pick minus dynasty ECR; positive means the player is ranked earlier than the cost",
                "eligibility": "A player is eligible only if actually drafted after Round 2; every board player is scored because draft-day falls determine eligibility.",
                "caveat": "Dynasty ECR values youth and long careers more than this league's two-season keeper window, so older productive players may look conservative.",
            },
            "aliases": {
                "team": TEAM_ALIASES,
                "playerName": PLAYER_NAME_ALIASES,
            },
        },
        "players": players,
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--board", type=Path, default=DEFAULT_BOARD)
    parser.add_argument("--dynasty-ecr", type=Path, default=DEFAULT_DYNASTY_ECR)
    parser.add_argument("--crosswalk", type=Path, default=DEFAULT_CROSSWALK)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    for path in [args.board, args.dynasty_ecr, args.crosswalk]:
        if not path.is_file():
            raise FileNotFoundError(path)
    payload = build_payload(args.board, args.dynasty_ecr, args.crosswalk)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n")
    print(json.dumps({
        "output": str(args.output),
        "rowCount": len(payload["players"]),
        "dynastySnapshotDate": payload["metadata"]["sources"]["dynastyRanking"]["snapshotDate"],
        "sleeperIdCoverage": payload["metadata"]["sleeperIdCoverage"],
    }, indent=2))


if __name__ == "__main__":
    main()
