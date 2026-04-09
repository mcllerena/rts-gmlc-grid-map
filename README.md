# rts-gmlc-grid-map

RTS-GMLC Power Grid map to visualize Contingency Analysis for the NARRS project.

## Project Structure

- `map.py`: build entrypoint that generates `index.html` from the template.
- `assets/map-template.html`: static HTML template used by the builder.
- `assets/map-styles.css`: map UI styling (Leaflet-independent styles).
- `assets/map-app.js`: frontend map logic and GeoJSON rendering.
- `assets/leaflet.css`, `assets/leaflet.js`: local Leaflet runtime assets.
- `gis/*.geojson`: map data consumed directly by the browser.

The app is intentionally static so it can be hosted directly on GitHub Pages.

## Build Map Page

Generate the map page from the template:

```bash
python3 map.py
```

This creates/updates `index.html` at repository root.

## Run Locally (Node)

Install dependencies once:

```bash
npm install
```

Start local server (build + serve):

```bash
npm run start
```

Open:

- `http://localhost:3000`

## Deploy To GitHub Pages

### Automated deployment (recommended)

This repository includes a workflow at `.github/workflows/deploy-pages.yml` that:

1. Runs on push to `main`.
2. Builds `index.html` via `map.py`.
3. Publishes the repository as a Pages artifact.

Enable GitHub Pages in repository settings and select **GitHub Actions** as the source.

### Manual deployment from local machine

```bash
npm run deploy
```

This uses `gh-pages` to publish from the current working tree.
