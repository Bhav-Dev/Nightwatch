#!/usr/bin/env python3
"""
Independent reference implementation of the community aggregation, written from the spec
rather than from shared/remedyEffect.ts, so the test can check the job's numbers against it.

Usage: reference_aggregate.py input.json  > output.json

Input:  { "today": "yyyy-mm-dd", "remedies": [ids], "contributors": [
            { "id": str, "profile": {bands}, "nights": [{ id, date, score, pct_snoring,
              duration_s, partial, typical, remedies, factors, score_version }] } ] }
Output: { "rows": [{ segment, window, remedy_id, status, users, nights, median_delta, p25,
          p75, median_delta_pct }], "alcohol": {...} }

numpy.quantile's default method ("linear") is the same type 7 definition shared/stats.ts uses.
"""
import json
import sys
from datetime import date, timedelta

import numpy as np

MIN_NIGHT_S = 3 * 3600
SKIP_FIRST_NIGHTS = 2
MIN_ELIGIBLE_NIGHTS = 7
MIN_NIGHTS_EACH_SIDE = 5
CO_INTRODUCTION_DAYS = 14
MIN_PAIRS = 5
# A co-introduced remedy on at least this share of nights on both sides is background, not a confounder.
BACKGROUND_SHARE = 0.8
OK_USERS, OK_NIGHTS, EARLY_USERS = 30, 300, 10
SEGMENT_DIMENSIONS = ["age", "sex", "bmi", "position", "pauses", "apnoea"]
LIKE_YOU = ["age", "bmi", "position"]


def to_day(d):
    return date.fromisoformat(d[:10])


def days_between(a, b):
    return (to_day(b) - to_day(a)).days


def eligible_nights(nights):
    """Oldest first; drop partial, short and atypical nights, then the first two; need seven."""
    ordered = sorted(nights, key=lambda n: n["date"])
    ok = [n for n in ordered if not n["partial"] and n["duration_s"] >= MIN_NIGHT_S and n["typical"] is not False]
    ok = ok[SKIP_FIRST_NIGHTS:]
    return ok if len(ok) >= MIN_ELIGIBLE_NIGHTS else []


def has(night, item):
    return item in night["remedies"] or any(f["id"] == item for f in night["factors"])


def alcohol_band(night):
    for f in night["factors"]:
        if f["id"] == "alcohol":
            return f["value"] if f["value"] is not None else "none"
    return "none"


def congested(night):
    return any(f["id"] == "congestion" for f in night["factors"])


def within_user_delta(eligible, item, is_factor=False, with_since=None):
    with_n = [n for n in eligible if has(n, item)]
    if with_since:
        with_n = [n for n in with_n if n["date"] >= with_since]

    excluded = set()
    if not is_factor:
        first_logged = {}
        for n in eligible:
            for r in n["remedies"]:
                first_logged.setdefault(r, n["date"])
        introduced = first_logged.get(item)
        if introduced:
            others = [n for n in eligible if not has(n, item)]

            def share(nights, r):
                return sum(1 for n in nights if r in n["remedies"]) / len(nights) if nights else 0.0

            excluded = {
                r for r, d in first_logged.items()
                if r != item and abs(days_between(introduced, d)) <= CO_INTRODUCTION_DAYS
                and not (share(with_n, r) >= BACKGROUND_SHARE and share(others, r) >= BACKGROUND_SHARE)
            }
    without = [n for n in eligible if not has(n, item) and not any(r in excluded for r in n["remedies"])]
    if len(with_n) < MIN_NIGHTS_EACH_SIDE or len(without) < MIN_NIGHTS_EACH_SIDE:
        return None

    # Greedy matching in date order: nearest unused night with the same alcohol band and
    # congestion flag; the first of equally near candidates wins.
    used, pairs = set(), []
    for w in with_n:
        best, best_gap = None, float("inf")
        for o in without:
            if o["id"] in used or alcohol_band(o) != alcohol_band(w) or congested(o) != congested(w):
                continue
            gap = abs(days_between(w["date"], o["date"]))
            if gap < best_gap:
                best, best_gap = o, gap
        if best is not None:
            used.add(best["id"])
            pairs.append((w, best))

    matched = len(pairs) >= MIN_PAIRS
    a = [p[0] for p in pairs] if matched else with_n
    b = [p[1] for p in pairs] if matched else without
    return {
        "delta": float(np.median([n["score"] for n in a]) - np.median([n["score"] for n in b])),
        "delta_pct": float(np.median([n["pct_snoring"] for n in a]) - np.median([n["pct_snoring"] for n in b])),
        "nights_with": len(with_n),
    }


def status_for(users, nights):
    if users >= OK_USERS and nights >= OK_NIGHTS:
        return "ok"
    if users >= EARLY_USERS:
        return "early"
    return "hidden"


def figure(deltas):
    users = len(deltas)
    nights = sum(d["nights_with"] for d in deltas)
    status = status_for(users, nights)
    if users == 0 or status == "hidden":
        return {"users": users, "nights": None, "median_delta": None, "p25": None, "p75": None,
                "median_delta_pct": None, "status": status}
    scores = np.array([d["delta"] for d in deltas])
    return {
        "users": users,
        "nights": nights,
        "median_delta": float(np.median(scores)),
        "p25": float(np.quantile(scores, 0.25)),
        "p75": float(np.quantile(scores, 0.75)),
        "median_delta_pct": float(np.median([d["delta_pct"] for d in deltas])),
        "status": status,
    }


def dimension_value(p, d):
    if d == "age":
        return p.get("age_band")
    if d == "sex":
        return p.get("sex")
    if d == "bmi":
        return p.get("bmi_band")
    if d == "position":
        return p.get("position")
    if d == "pauses":
        return p.get("pauses_reported")
    if p.get("apnoea_dx") is None and p.get("cpap") is None:
        return None
    return "yes" if (p.get("apnoea_dx") or p.get("cpap")) else "no"


def segments_for(p):
    keys = []
    for d in SEGMENT_DIMENSIONS:
        v = dimension_value(p, d)
        if v is not None:
            keys.append(f"{d}:{v}")
    like = [dimension_value(p, d) for d in LIKE_YOU]
    if all(v is not None for v in like):
        keys.append("|".join(f"{d}:{v}" for d, v in zip(LIKE_YOU, like)))
    return keys


def main():
    data = json.load(open(sys.argv[1]))
    today = date.fromisoformat(data["today"])
    since90 = (today - timedelta(days=90)).isoformat()
    remedies = data["remedies"]

    all_nights = [n for c in data["contributors"] for n in c["nights"]]
    version = max(n["score_version"] for n in all_nights)

    deltas = {}  # (segment, window, remedy) -> [delta]
    members = {}
    alcohol = []
    for c in data["contributors"]:
        elig = eligible_nights([n for n in c["nights"] if n["score_version"] == version])
        if not elig:
            continue
        segs = ["all"] + segments_for(c.get("profile") or {})
        for s in segs:
            members[s] = members.get(s, 0) + 1
        for r in remedies:
            for window, since in (("all", None), ("90d", since90)):
                d = within_user_delta(elig, r, with_since=since)
                if d:
                    for s in segs:
                        deltas.setdefault((s, window, r), []).append(d)
        a = within_user_delta(elig, "alcohol", is_factor=True)
        if a:
            alcohol.append(a)

    rows = []
    for s, n in sorted(members.items()):
        if s != "all" and n < EARLY_USERS:
            continue
        for window in ("all", "90d"):
            for r in remedies:
                ds = deltas.get((s, window, r), [])
                if s != "all" and len(ds) < EARLY_USERS:
                    continue
                rows.append({"segment": s, "window": window, "remedy_id": r, **figure(ds)})

    json.dump({"score_version": version, "rows": rows, "alcohol": figure(alcohol)}, sys.stdout)


if __name__ == "__main__":
    main()
