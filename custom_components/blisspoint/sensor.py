import logging
from datetime import timedelta

import aiohttp
from homeassistant.components.sensor import (
    SensorDeviceClass,
    SensorEntity,
    SensorStateClass,
)
from homeassistant.config_entries import ConfigEntry
from homeassistant.const import UnitOfPower, UnitOfTemperature
from homeassistant.core import HomeAssistant
from homeassistant.helpers.aiohttp_client import async_get_clientsession
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.helpers.update_coordinator import (
    CoordinatorEntity,
    DataUpdateCoordinator,
    UpdateFailed,
)

from .const import DOMAIN, SCAN_INTERVAL

_LOGGER = logging.getLogger(__name__)

SENSORS = [
    # (key, name, unit, device_class, state_class)
    ("th", "Hashrate", "TH/s", None, SensorStateClass.MEASUREMENT),
    ("watts", "Power", UnitOfPower.WATT, SensorDeviceClass.POWER, SensorStateClass.MEASUREMENT),
    ("chipTemp", "Chip Temperature", UnitOfTemperature.CELSIUS, SensorDeviceClass.TEMPERATURE, SensorStateClass.MEASUREMENT),
    ("fanSpeed", "Fan Speed", "%", None, SensorStateClass.MEASUREMENT),
]


async def async_setup_entry(
    hass: HomeAssistant,
    entry: ConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    url = entry.data["blisspoint_url"].rstrip("/")
    miner_ip = entry.data["miner_ip"]

    coordinator = BlisspointCoordinator(hass, url, miner_ip)
    await coordinator.async_config_entry_first_refresh()

    async_add_entities(
        BlisspointSensor(coordinator, miner_ip, key, name, unit, dev_class, state_class)
        for key, name, unit, dev_class, state_class in SENSORS
    )


class BlisspointCoordinator(DataUpdateCoordinator):
    def __init__(self, hass: HomeAssistant, url: str, miner_ip: str) -> None:
        super().__init__(
            hass,
            _LOGGER,
            name=DOMAIN,
            update_interval=timedelta(seconds=SCAN_INTERVAL),
        )
        self._url = url
        self._miner_ip = miner_ip

    async def _async_update_data(self) -> dict:
        endpoint = f"{self._url}/api/miners/{self._miner_ip}/stats"
        session = async_get_clientsession(self.hass)
        try:
            async with session.get(
                endpoint, timeout=aiohttp.ClientTimeout(total=10)
            ) as resp:
                resp.raise_for_status()
                data = await resp.json()
                return data.get("live", {})
        except Exception as err:
            raise UpdateFailed(f"Error fetching {endpoint}: {err}") from err


class BlisspointSensor(CoordinatorEntity, SensorEntity):
    def __init__(
        self,
        coordinator: BlisspointCoordinator,
        miner_ip: str,
        key: str,
        name: str,
        unit: str | None,
        device_class: SensorDeviceClass | None,
        state_class: SensorStateClass | None,
    ) -> None:
        super().__init__(coordinator)
        self._key = key
        self._attr_name = f"Blisspoint {name} ({miner_ip})"
        self._attr_native_unit_of_measurement = unit
        self._attr_device_class = device_class
        self._attr_state_class = state_class
        self._attr_unique_id = f"blisspoint_{miner_ip}_{key}"

    @property
    def native_value(self):
        return self.coordinator.data.get(self._key)
