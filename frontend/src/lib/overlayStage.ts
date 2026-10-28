import type { InjectionKey, Ref } from "vue";
interface OverlayStage {
  host: Ref<HTMLElement | undefined>;
  active: Ref<{ titleId: string; close(): void } | undefined>;
}
export const overlayStageKey: InjectionKey<OverlayStage> =
  Symbol("overlay-stage");
