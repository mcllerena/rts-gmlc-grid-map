import argparse
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, Iterable, List, Tuple


ROOT_DIR = Path(__file__).resolve().parent
ASSETS_DIR = ROOT_DIR / "assets"
GIS_DIR = ROOT_DIR / "gis"
TEMPLATE_FILE = ASSETS_DIR / "map-template.html"
DEFAULT_OUTPUT_FILE = ROOT_DIR / "index.html"

REQUIRED_GEOJSON: Dict[str, str] = {
    "bus": "bus.geojson",
    "branch": "branch.geojson",
    "gen": "gen.geojson",
    "gen_conn": "gen_conn.geojson",
}


def _load_geojson(path: Path) -> dict:
    with path.open("r", encoding="utf-8") as file_obj:
        return json.load(file_obj)


def _bus_center(bus_geojson: dict) -> Tuple[float, float]:
    lats: List[float] = []
    lons: List[float] = []

    for feature in bus_geojson.get("features", []):
        geometry = feature.get("geometry", {})
        if geometry.get("type") != "Point":
            continue

        coordinates = geometry.get("coordinates", [])
        if len(coordinates) < 2:
            continue

        lons.append(float(coordinates[0]))
        lats.append(float(coordinates[1]))

    if not lats or not lons:
        return 39.5, -98.35

    return sum(lats) / len(lats), sum(lons) / len(lons)


def _missing_paths(paths: Iterable[Path]) -> List[Path]:
    return [path for path in paths if not path.exists()]


def _validate_required_files() -> Dict[str, Path]:
    required_files: Dict[str, Path] = {
        key: GIS_DIR / file_name for key, file_name in REQUIRED_GEOJSON.items()
    }

    required_assets = [
        TEMPLATE_FILE,
        ASSETS_DIR / "leaflet.css",
        ASSETS_DIR / "leaflet.js",
        ASSETS_DIR / "map-styles.css",
        ASSETS_DIR / "map-app.js",
    ]

    missing = _missing_paths(list(required_files.values()) + required_assets)
    if missing:
        missing_text = "\n".join(f"  - {path.relative_to(ROOT_DIR)}" for path in missing)
        raise FileNotFoundError(
            "Missing required files to build the map:\n"
            f"{missing_text}\n"
            "Run from repository root and ensure all assets and GIS files exist."
        )

    return required_files


def build_map(output_file: Path = DEFAULT_OUTPUT_FILE, map_title: str = "RTS-GMLC Grid Map") -> Path:
    required_geojson_paths = _validate_required_files()
    bus_geojson = _load_geojson(required_geojson_paths["bus"])
    center_lat, center_lon = _bus_center(bus_geojson)

    template = TEMPLATE_FILE.read_text(encoding="utf-8")
    built_at = datetime.now(timezone.utc).replace(microsecond=0).isoformat()

    html = (
        template.replace("{{MAP_TITLE}}", map_title)
        .replace("{{CENTER_LAT}}", f"{center_lat:.6f}")
        .replace("{{CENTER_LON}}", f"{center_lon:.6f}")
        .replace("{{BUILT_AT}}", built_at)
    )

    output_file.parent.mkdir(parents=True, exist_ok=True)
    output_file.write_text(html, encoding="utf-8")
    return output_file


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Build a static HTML map that depends on local assets/ and gis/ files."
    )
    parser.add_argument(
        "--output",
        default=str(DEFAULT_OUTPUT_FILE),
        help="Output HTML file path (default: index.html at repository root).",
    )
    parser.add_argument(
        "--title",
        default="RTS-GMLC Grid Map",
        help="Document title shown in the generated map page.",
    )
    return parser.parse_args()


def main() -> None:
    args = _parse_args()
    output_path = build_map(output_file=Path(args.output), map_title=args.title)
    print(f"Map created: {output_path}")


if __name__ == "__main__":
    main()
