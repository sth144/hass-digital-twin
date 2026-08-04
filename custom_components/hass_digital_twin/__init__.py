"""Register the House Panel frontend and sidebar entry."""
from __future__ import annotations
from pathlib import Path
from homeassistant.components.frontend import async_register_built_in_panel
from homeassistant.components.http import StaticPathConfig
from homeassistant.core import HomeAssistant

DOMAIN = "hass_digital_twin"

async def async_setup(hass: HomeAssistant, config: dict) -> bool:
    """Serve the built frontend and register its custom element as a sidebar panel."""
    frontend = Path(__file__).parent / "frontend"
    await hass.http.async_register_static_paths([StaticPathConfig(f"/{DOMAIN}", str(frontend), cache_headers=False)])
    async_register_built_in_panel(hass, component_name="custom", sidebar_title="Digital Twin", sidebar_icon="mdi:home-floor-3", frontend_url_path="hass-digital-twin", config={"_panel_custom": {"name": "hass-digital-twin-panel", "module_url": f"/{DOMAIN}/hass-digital-twin.js", "embed_iframe": False, "trust_external": False, "mappingUrl": f"/{DOMAIN}/house.yaml"}})
    return True
