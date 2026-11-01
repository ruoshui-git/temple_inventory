import {
  onBeforeUnmount,
  onMounted,
  provide,
  ref,
  type InjectionKey,
  type Ref,
} from "vue";

export const browseSelectingKey: InjectionKey<Ref<boolean>> =
  Symbol("browseSelecting");

/** Selection state belongs to the browse controller so it survives responsive surface changes. */
export function useBrowseSelection() {
  const selecting = ref(false);
  const selected = ref<string[]>([]);
  provide(browseSelectingKey, selecting);
  function enter() {
    selecting.value = true;
  }
  function clear() {
    selected.value = [];
  }
  function exit() {
    selecting.value = false;
    clear();
  }
  function toggle(key: string) {
    selected.value = selected.value.includes(key)
      ? selected.value.filter((value) => value !== key)
      : [...selected.value, key];
  }
  function set(key: string, checked: boolean) {
    const has = selected.value.includes(key);
    if (checked === has) return;
    toggle(key);
  }
  function allSelected(keys: string[]) {
    return keys.length > 0 && keys.every((key) => selected.value.includes(key));
  }
  function setMany(keys: string[], checked: boolean) {
    const keySet = new Set(keys);
    selected.value = checked
      ? [...new Set([...selected.value, ...keys])]
      : selected.value.filter((key) => !keySet.has(key));
  }
  function retain(keys: Iterable<string>) {
    const available = new Set(keys);
    selected.value = selected.value.filter((key) => available.has(key));
  }
  function onKeydown(event: KeyboardEvent) {
    if (event.key !== "Escape" || !selecting.value) return;
    const target = event.target;
    if (
      target instanceof HTMLElement &&
      (target.closest('[role="dialog"], [role="menu"], [data-overlay]') ||
        target.isContentEditable ||
        /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))
    )
      return;
    event.preventDefault();
    exit();
  }
  onMounted(() => document.addEventListener("keydown", onKeydown));
  onBeforeUnmount(() => document.removeEventListener("keydown", onKeydown));
  return {
    selecting,
    selected,
    enter,
    exit,
    clear,
    toggle,
    set,
    allSelected,
    setMany,
    retain,
  };
}
