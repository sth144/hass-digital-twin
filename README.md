# HASS Digital Twin

An independent Home Assistant digital-twin panel built with Lit, Three.js, TypeScript, and GLB/glTF.

## Development

```sh
npm install
npm run build
```

The build produces `custom_components/hass_digital_twin/frontend/hass-digital-twin.js`. Copy `custom_components/hass_digital_twin` into your Home Assistant configuration directory, then restart Home Assistant and add `hass_digital_twin:` to your configuration. The integration registers a full-screen **Digital Twin** sidebar panel.

Put the model at `public/house/house.glb` and configure Area/entity bindings in `public/house.yaml`; both are copied to the integration during every build. `examples/house.yaml` contains the same starter mapping for reference.

## Current scaffold

- Full-screen custom panel shell with a Three.js scene, resize handling, capped pixel ratio, and tab-visibility rendering pause.
- Typed YAML/JSON mapping schema, GLB loader, and Home Assistant state/registry/service abstractions.
- Placeholder modules for area raycasting, lighting, camera previews, orbit controls, and mapping editor—the next implementation phases.
