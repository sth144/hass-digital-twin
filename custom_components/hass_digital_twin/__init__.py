"""Register the House Panel frontend, its sidebar entry, and layout storage."""
from __future__ import annotations
import re
from pathlib import Path
from typing import Any
import voluptuous as vol
from homeassistant.components import websocket_api
from homeassistant.components.frontend import async_register_built_in_panel
from homeassistant.components.http import StaticPathConfig
from homeassistant.core import HomeAssistant
from homeassistant.helpers.storage import Store

DOMAIN = "hass_digital_twin"
STORAGE_VERSION = 1
TWIN_ID = re.compile(r"^[a-z0-9_-]{1,64}$")


def _store(hass: HomeAssistant, twin: str) -> Store[dict[str, Any]]:
    """One store per twin, so saving one layout cannot disturb another."""
    return Store(hass, STORAGE_VERSION, f"{DOMAIN}.{twin}")


def _reject_bad_twin(connection: websocket_api.ActiveConnection, msg: dict) -> bool:
    if TWIN_ID.match(msg["twin"]):
        return False
    connection.send_error(msg["id"], "invalid_twin_id", "Twin ids are lowercase words")
    return True


@websocket_api.websocket_command(
    {
        vol.Required("type"): f"{DOMAIN}/save_layout",
        vol.Required("twin"): str,
        vol.Required("mapping"): dict,
    }
)
@websocket_api.async_response
async def _save_layout(hass: HomeAssistant, connection, msg: dict) -> None:
    """Persist a twin's edited mapping so it survives reloads and other browsers."""
    if _reject_bad_twin(connection, msg):
        return
    await _store(hass, msg["twin"]).async_save(msg["mapping"])
    connection.send_result(msg["id"], {"saved": True})


@websocket_api.websocket_command(
    {vol.Required("type"): f"{DOMAIN}/load_layout", vol.Required("twin"): str}
)
@websocket_api.async_response
async def _load_layout(hass: HomeAssistant, connection, msg: dict) -> None:
    """Return the saved mapping for a twin, or null when nothing has been saved."""
    if _reject_bad_twin(connection, msg):
        return
    connection.send_result(msg["id"], {"mapping": await _store(hass, msg["twin"]).async_load()})


@websocket_api.websocket_command(
    {vol.Required("type"): f"{DOMAIN}/clear_layout", vol.Required("twin"): str}
)
@websocket_api.async_response
async def _clear_layout(hass: HomeAssistant, connection, msg: dict) -> None:
    """Drop the saved mapping so the twin falls back to its YAML."""
    if _reject_bad_twin(connection, msg):
        return
    await _store(hass, msg["twin"]).async_remove()
    connection.send_result(msg["id"], {"cleared": True})


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
    for command in (_save_layout, _load_layout, _clear_layout):
        websocket_api.async_register_command(hass, command)
    async_register_built_in_panel(hass, component_name="custom", sidebar_title="Digital Twin", sidebar_icon="mdi:cube-scan", frontend_url_path="hass-digital-twin", config={"_panel_custom": {"name": "hass-digital-twin-panel", "module_url": f"/{DOMAIN}/hass-digital-twin.js", "embed_iframe": False, "trust_external": False, "mappingUrl": f"/{DOMAIN}/twins.yaml"}})
    return True
