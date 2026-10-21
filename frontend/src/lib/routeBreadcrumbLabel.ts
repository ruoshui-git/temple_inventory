import {
  inject,
  onScopeDispose,
  provide,
  ref,
  watch,
  type InjectionKey,
  type Ref,
} from "vue";

interface BreadcrumbLabelContext {
  value: Ref<string | undefined>;
  owner: Ref<symbol | undefined>;
}
export const routeBreadcrumbLabelKey: InjectionKey<BreadcrumbLabelContext> =
  Symbol("route-breadcrumb-label");

export function provideRouteBreadcrumbLabel(value: Ref<string | undefined>) {
  provide(routeBreadcrumbLabelKey, { value, owner: ref<symbol>() });
}

export function useRouteBreadcrumbLabel(label: () => string | undefined) {
  const target = inject(routeBreadcrumbLabelKey, undefined);
  const owner = Symbol("breadcrumb-label-owner");
  watch(
    label,
    (value) => {
      if (target) {
        target.owner.value = owner;
        target.value.value = value?.trim() || undefined;
      }
    },
    { immediate: true },
  );
  onScopeDispose(() => {
    if (target?.owner.value === owner) {
      target.owner.value = undefined;
      target.value.value = undefined;
    }
  });
}
