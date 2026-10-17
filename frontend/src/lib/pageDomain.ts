import {
  inject,
  onBeforeUnmount,
  provide,
  shallowRef,
  watch,
  type InjectionKey,
  type ShallowRef,
} from "vue";
import type { AppDestination } from "./appNavigation";
interface PageDomain {
  owner: symbol;
  domain: AppDestination;
}
const key: InjectionKey<ShallowRef<PageDomain | undefined>> =
  Symbol("page-domain");
export function providePageDomain() {
  const value = shallowRef<PageDomain>();
  provide(key, value);
  return value;
}
export function usePageDomain(domain: () => AppDestination) {
  const value = inject(key, undefined),
    owner = Symbol("page");
  watch(
    domain,
    (domain) => {
      if (value) value.value = { owner, domain };
    },
    { immediate: true },
  );
  onBeforeUnmount(() => {
    if (value?.value?.owner === owner) value.value = undefined;
  });
}
