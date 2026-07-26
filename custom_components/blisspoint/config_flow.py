import voluptuous as vol
from homeassistant import config_entries
from homeassistant.data_entry_flow import FlowResult

from .const import DOMAIN


class BlisspointConfigFlow(config_entries.ConfigFlow, domain=DOMAIN):
    VERSION = 1

    async def async_step_user(self, user_input=None) -> FlowResult:
        if user_input is not None:
            uid = f"{user_input['blisspoint_url']}_{user_input['miner_ip']}"
            await self.async_set_unique_id(uid)
            self._abort_if_unique_id_configured()
            return self.async_create_entry(
                title=f"Miner {user_input['miner_ip']}",
                data=user_input,
            )

        return self.async_show_form(
            step_id="user",
            data_schema=vol.Schema(
                {
                    vol.Required("blisspoint_url"): str,
                    vol.Required("miner_ip"): str,
                }
            ),
        )
