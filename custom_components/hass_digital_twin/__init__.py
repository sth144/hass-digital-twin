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
    # Models carry a content hash in their filename, so their URLs are immutable and safe
    # to cache; the rest of the bundle must not be, or a rebuild would serve stale code.
    # The specific prefix is registered first because static routes match in order.
    models = frontend / "models"
    paths = [StaticPathConfig(f"/{DOMAIN}", str(frontend), cache_headers=False)]
    if await hass.async_add_executor_job(models.is_dir):
        paths.insert(0, StaticPathConfig(f"/{DOMAIN}/models", str(models), cache_headers=True))
    await hass.http.async_register_static_paths(paths)
    async_register_built_in_panel(hass, component_name="custom", sidebar_title="Digital Twin", sidebar_icon="mdi:cube-scan", frontend_url_path="hass-digital-twin", config={"_panel_custom": {"name": "hass-digital-twin-panel", "module_url": f"/{DOMAIN}/hass-digital-twin.js", "embed_iframe": False, "trust_external": False, "mappingUrl": f"/{DOMAIN}/twins.yaml"}})
    return True
