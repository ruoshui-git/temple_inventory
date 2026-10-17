import { inject, provide, type Component, type InjectionKey } from "vue";
/** Optional artwork supplied by a host; ordinary catalog Items use their native image. */
export interface ItemArtwork {
  component: Component;
  has(code: string): boolean;
}
const key: InjectionKey<ItemArtwork> = Symbol("inventory-item-artwork");
export function provideItemArtwork(value: ItemArtwork) {
  provide(key, value);
}
export function useItemArtwork() {
  return inject(key, undefined);
}
