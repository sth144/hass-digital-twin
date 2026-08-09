import type { HassEntity, HomeAssistant } from "./types";

export class StateBindings {
  private unsubscribe?: () => void;
  constructor(
    private readonly hass: HomeAssistant,
    private readonly onChange: (entity: HassEntity) => void,
  ) {}
  async start() {
    this.unsubscribe = await this.hass.connection.subscribeEvents((event) => {
      if (event.data.new_state) this.onChange(event.data.new_state);
    }, "state_changed");
  }
  stop() {
    this.unsubscribe?.();
    this.unsubscribe = undefined;
  }
}
