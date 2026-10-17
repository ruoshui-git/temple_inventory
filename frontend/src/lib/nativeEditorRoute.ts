import { computed, watch, type Ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import type { NativeIdentity } from "./browserRecovery";
import { documentDestination } from "./nativeNavigation";

interface RoutedEditor {
  state: { identity?: NativeIdentity; status: string };
  loading: Ref<boolean>;
  busy: Ref<boolean>;
  savePending: Ref<number>;
  reviewOpen: Ref<boolean>;
  dirty: Ref<boolean>;
  supportingDirty: Ref<boolean>;
  files: { busy: Ref<boolean> };
}

/** A saved native identity must survive reload, including after amendment. */
export function useNativeEditorRoute(editor: () => RoutedEditor | undefined) {
  const route = useRoute(),
    router = useRouter();
  const target = computed(() => {
    const current = editor();
    if (
      !current?.state.identity ||
      current.loading.value ||
      current.busy.value ||
      current.savePending.value ||
      current.reviewOpen.value ||
      current.files.busy.value ||
      current.dirty.value ||
      current.supportingDirty.value ||
      !["saved", "submitted", "cancelled"].includes(current.state.status)
    )
      return "";
    return documentDestination(
      current.state.identity.doctype,
      current.state.identity.name,
    ).path;
  });
  watch(
    target,
    (path) => {
      if (path && path !== route.path) void router.replace(path);
    },
    { flush: "post" },
  );
}
