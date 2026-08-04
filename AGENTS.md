# AGENTS.md

## Project purpose

`hass-digital-twin` is a full-screen Home Assistant custom panel for interactive GLB/glTF house models. The frontend is TypeScript, Lit, and Three.js; the Home Assistant wrapper is a custom integration under `custom_components/hass_digital_twin`.

## Source and build output

- Edit frontend source in `src/`.
- Keep the declarative starter mapping in `public/house.yaml` and model assets in `public/house/`.
- `npm run build` emits the deployable module and copies public assets to `custom_components/hass_digital_twin/frontend/`.
- Do not edit generated JavaScript in `custom_components/hass_digital_twin/frontend/`; rebuild it instead.
- Keep GLB models and textures out of Git unless they are small, redistributable demo assets. Never commit private floor plans, camera imagery, credentials, or Home Assistant backups.

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
