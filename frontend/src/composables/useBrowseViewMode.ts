import { computed, ref, type Ref } from "vue";

export type BrowseView = "card" | "table";

export function useBrowseViewMode(isMobile: Readonly<Ref<boolean>>) {
  const phoneView = ref<BrowseView>("table");
  const desktopView = ref<BrowseView>("table");
  const view = computed<BrowseView>({
    get: () => (isMobile.value ? phoneView.value : desktopView.value),
    set: (value) => {
      if (isMobile.value) phoneView.value = value;
      else desktopView.value = value;
    },
  });
  function snapshot() {
    return { phoneView: phoneView.value, desktopView: desktopView.value };
  }
  function restore(value: {
    phoneView?: unknown;
    desktopView?: unknown;
    view?: unknown;
  }) {
    phoneView.value = value.phoneView === "card" ? "card" : "table";
    desktopView.value =
      value.desktopView === "card" || value.view === "card" ? "card" : "table";
  }
  return { phoneView, desktopView, view, snapshot, restore };
}
