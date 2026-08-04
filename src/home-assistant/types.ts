export interface HassEntity { entity_id: string; state: string; attributes: Record<string, unknown>; }
export interface HassConnection { subscribeEvents(callback: (event: { data: { new_state?: HassEntity } }) => void, eventType: string): Promise<() => void>; sendMessagePromise<T>(message: Record<string, unknown>): Promise<T>; }
export interface HomeAssistant { states: Record<string, HassEntity>; connection: HassConnection; callService(domain: string, service: string, data?: Record<string, unknown>): Promise<unknown>; }
export interface AreaRegistryEntry { area_id: string; name: string; }
export interface EntityRegistryEntry { entity_id: string; area_id?: string; device_id?: string; }
