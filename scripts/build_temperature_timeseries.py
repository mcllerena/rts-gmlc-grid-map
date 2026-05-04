#!/usr/bin/env python3
"""Preprocess seasonal HDF5 conductor temperature time series into compact JSON
files that the browser can fetch. Output schema:

  {
    "startIso": "2020-01-01T00:00:00",
    "stepMinutes": 60,
    "count": 8760,
    "lines": {"<uid>": [t0, t1, ...], ...}      # rounded to 0.1 °C
  }

Run:  python3 scripts/build_temperature_timeseries.py
"""
from __future__ import annotations
import json, os, re, sys
from pathlib import Path
import h5py
import numpy as np

ROOT = Path(__file__).resolve().parent.parent
GIS_BRANCH = ROOT / "gis" / "branch.geojson"

# 17520 = 365 days × 48 half-hour samples. Subsample to 3-hourly (factor 6) to
# keep the JSON payload around 4 MB while still giving a smooth annual sweep.
SUBSAMPLE_STEP = 6
START_ISO = "2020-01-01T00:00:00"
STEP_MINUTES = 30 * SUBSAMPLE_STEP


def _ckt_candidates(uid: str) -> list[str]:
    """Mirror cktCandidatesFromUid() in assets/map-app.js."""
    raw = (uid or "").strip()
    out: list[str] = []
    if not raw:
        return out
    out.append(raw)
    if "-" in raw:
        tail = raw.split("-")[-1]
        if tail:
            out.append(tail)
    # Strip leading letters (e.g. "A1" -> "1").
    stripped = re.sub(r"^[A-Za-z]+", "", raw)
    if stripped:
        out.append(stripped)
    seen: set[str] = set()
    uniq: list[str] = []
    for c in out:
        c = c.upper()
        if c and c not in seen:
            seen.add(c)
            uniq.append(c)
    return uniq


def build_uid_map(branch_path: Path) -> dict[str, str]:
    """Return mapping h5-key (e.g. '0101_0102_A1') -> branch UID (e.g. 'A1').

    Tries every CKT candidate derived from the UID since for parallel branches
    the GIS UID has a "-N" suffix (e.g. C25-1) while the h5 key uses just "1".
    """
    data = json.loads(branch_path.read_text())
    out: dict[str, str] = {}
    for f in data.get("features", []):
        props = f.get("properties") or {}
        uid = str(props.get("UID") or "").strip()
        if not uid:
            continue
        try:
            from_bus = int(props.get("From Bus"))
            to_bus = int(props.get("To Bus"))
        except (TypeError, ValueError):
            continue
        for ckt in _ckt_candidates(uid):
            key_fwd = f"{from_bus:04d}_{to_bus:04d}_{ckt}"
            key_rev = f"{to_bus:04d}_{from_bus:04d}_{ckt}"
            # First write wins so the most-specific candidate (the full UID)
            # takes precedence over collapsed numeric forms.
            out.setdefault(key_fwd, uid)
            out.setdefault(key_rev, uid)
    return out


def process_season(h5_path: Path, uid_map: dict[str, str], out_path: Path) -> None:
    if not h5_path.exists():
        print(f"[skip] {h5_path} not found", file=sys.stderr)
        return
    with h5py.File(h5_path, "r") as f:
        lines_grp = f["lines"]
        lines_out: dict[str, list[float]] = {}
        rfactor_out: dict[str, list[float]] = {}
        count = None
        for key in lines_grp.keys():
            uid = uid_map.get(key)
            if uid is None:
                m = re.match(r"^(\d{4})_(\d{4})_(.+)$", key)
                if m:
                    uid = uid_map.get(f"{int(m.group(1)):04d}_{int(m.group(2)):04d}_{m.group(3)}")
            if uid is None:
                print(f"[warn] unmapped h5 key: {key}", file=sys.stderr)
                continue
            ds = lines_grp[key].get("Tcond_degC")
            if ds is None:
                continue
            arr = np.asarray(ds[...], dtype=np.float32)[::SUBSAMPLE_STEP]
            arr = np.round(arr, 1)
            if count is None:
                count = int(arr.shape[0])
            lines_out[uid] = arr.tolist()

            r_ds = lines_grp[key].get("R_factor")
            if r_ds is not None:
                r_arr = np.asarray(r_ds[...], dtype=np.float32)[::SUBSAMPLE_STEP]
                # Round to 3 decimals to keep JSON small (~factor 0.7–1.0).
                r_arr = np.round(r_arr, 3)
                rfactor_out[uid] = r_arr.tolist()
        manifest = {
            "startIso": START_ISO,
            "stepMinutes": STEP_MINUTES,
            "count": count or 0,
            "lines": lines_out,
            "rFactor": rfactor_out,
        }
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(manifest, separators=(",", ":")))
    size_mb = out_path.stat().st_size / (1024 * 1024)
    print(f"[ok]   {out_path}  ({len(lines_out)} lines, {count} frames, {size_mb:.2f} MB)")


def main() -> int:
    uid_map = build_uid_map(GIS_BRANCH)
    for season in ("summer", "winter"):
        h5_path = ROOT / "ca_results" / season / f"{season}_timeseries.h5"
        out_path = ROOT / "ca_results" / season / "temperature_timeseries.json"
        process_season(h5_path, uid_map, out_path)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
