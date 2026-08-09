# AGENTS.md

## Project purpose

`hass-digital-twin` is a full-screen Home Assistant custom panel for interactive GLB/glTF house models. The frontend is TypeScript, Lit, and Three.js; the Home Assistant wrapper is a custom integration under `custom_components/hass_digital_twin`.

## Source and build output

- Edit frontend source in `src/`.
- Keep the declarative starter mapping in `public/house.yaml` and model assets in `public/house/`.
- `npm run build` emits the deployable module and copies public assets to `custom_components/hass_digital_twin/frontend/`.
- Do not edit generated JavaScript in `custom_components/hass_digital_twin/frontend/`; rebuild it instead.
- Keep GLB models and textures out of Git unless they are small, redistributable demo assets. Never commit private floor plans, camera imagery, credentials, or Home Assistant backups.
- Twin mappings are private by default: `.gitignore` ignores `public/*.yaml` and whitelists only the reference twins (`house.yaml`, `garage.yaml`, `gallery.yaml`, `twins.example.yaml`). A mapping for a real house carries its room outlines and often its address, so leave it ignored. `public/twins.yaml` is generated from `twins.example.yaml` on first build.
- `scripts/publish-twin.mjs` takes a FreeCAD document all the way to the Home Assistant host: export (roofless, via `scripts/freecad-export.py`), content-hashed model into `public/models/`, mapping refresh, build, rsync. Run `npm run publish -- <document.FCStd>`.

## Development and validation

```sh
npm install
npm run build
```

Run `npm run build` after TypeScript, mapping, or public-asset changes. It includes strict TypeScript checking and the production Vite build.

## Home Assistant integration

- Keep the custom-integration domain `hass_digital_twin` stable; it defines the static URL namespace.
- The sidebar panel is registered in `custom_components/hass_digital_twin/__init__.py` and loads the generated ES module.
- Use the `hass` object and its WebSocket connection for live state, registries, and service calls. Do not add a separate authenticated backend for normal Home Assistant interactions.
- Treat actions that control devices as explicit user interactions; do not perform service calls merely from state updates.

## Architecture boundaries

- `src/panel/`: panel composition and Home Assistant property boundary.
- `src/renderer/`: Three.js scene, interaction, lighting, and camera behavior.
- `src/home-assistant/`: typed Home Assistant adapters only.
- `src/mapping/`: schema, mapping loading, and future mapping suggestions.
- `src/ui/` and `src/editor/`: UI components and the developer mapping experience.

Keep renderer logic independent of Home Assistant transport details, and validate mapping changes through the Zod schema.
