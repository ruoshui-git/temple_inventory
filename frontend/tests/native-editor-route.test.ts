import { afterEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { computed, defineComponent, h, onMounted, reactive, ref } from "vue";
import {
  createMemoryHistory,
  createRouter,
  RouterView,
  useRoute,
} from "vue-router";
import { useNativeEditorRoute } from "../src/lib/nativeEditorRoute";
import {
  routeRecords,
  routeTarget,
  routeViewIdentity,
} from "../src/lib/routeRegistry";
import type { NativeIdentity } from "../src/lib/browserRecovery";

const wrappers: VueWrapper[] = [];
afterEach(() => wrappers.splice(0).forEach((wrapper) => wrapper.unmount()));
async function setup() {
  const controller = {
    state: reactive({
      identity: undefined as NativeIdentity | undefined,
      status: "local",
    }),
    loading: ref(false),
    busy: ref(false),
    savePending: ref(0),
    reviewOpen: ref(false),
    dirty: ref(false),
    supportingDirty: ref(false),
    files: { busy: ref(false) },
  };
  const host = defineComponent({
    setup() {
      useNativeEditorRoute(() => controller);
      return () => h("section");
    },
  });
  const router = createRouter({
    history: createMemoryHistory(),
    routes: routeRecords,
  });
  await router.push(routeTarget("stock"));
  await router.push(routeTarget("movement-new", { kind: "Receive" }));
  wrappers.push(mount(host, { global: { plugins: [router] } }));
  return { controller, router };
}
describe("saved native editor URLs", () => {
  it("keeps the live editor mounted through deferred save edits and identity replacement", async () => {
    const controller = {
      state: reactive({
        identity: undefined as NativeIdentity | undefined,
        status: "local",
      }),
      loading: ref(false),
      busy: ref(false),
      savePending: ref(1),
      reviewOpen: ref(false),
      dirty: ref(true),
      supportingDirty: ref(false),
      files: { busy: ref(false) },
    };
    let mounts = 0;
    const page = defineComponent({
      setup() {
        onMounted(() => mounts++);
        useNativeEditorRoute(() => controller);
        const input = ref("");
        return () =>
          h("input", {
            "aria-label": "仍在保存的输入",
            value: input.value,
            onInput: (event: Event) =>
              (input.value = (event.target as HTMLInputElement).value),
          });
      },
    });
    const routes = routeRecords.map((record) =>
      record.name === "movement-new" || record.name === "movement-detail"
        ? { ...record, component: page }
        : record,
    );
    const router = createRouter({ history: createMemoryHistory(), routes });
    await router.push(routeTarget("stock"));
    await router.push(routeTarget("movement-new", { kind: "Receive" }));
    const root = defineComponent({
      setup() {
        const route = useRoute();
        const key = computed(() =>
          routeViewIdentity(
            route.path,
            Number(router.options.history.state.position || 0),
            typeof route.meta.stateIdentity === "string"
              ? route.meta.stateIdentity
              : undefined,
          ),
        );
        return () => h(RouterView, { key: key.value });
      },
    });
    const wrapper = mount(root, { global: { plugins: [router] } });
    wrappers.push(wrapper);
    await wrapper.find("input").setValue("新补充的备注");
    controller.state.identity = { doctype: "Stock Entry", name: "STE-1" };
    controller.state.status = "saved";
    await flushPromises();
    expect(router.currentRoute.value.path).toBe("/movements/new/Receive");
    controller.savePending.value = 0;
    controller.dirty.value = false;
    await vi.waitFor(() =>
      expect(router.currentRoute.value.path).toBe("/movements/STE-1"),
    );
    expect(wrapper.find("input").element.value).toBe("新补充的备注");
    expect(mounts).toBe(1);
  });

  it("replaces the creation URL with the native identity only after save and attachments settle", async () => {
    const { controller: c, router } = await setup();
    c.savePending.value = 1;
    c.state.identity = { doctype: "Stock Entry", name: "STE/A,1" };
    c.state.status = "saved";
    await flushPromises();
    expect(router.currentRoute.value.path).toBe("/movements/new/Receive");
    c.savePending.value = 0;
    c.files.busy.value = true;
    await flushPromises();
    expect(router.currentRoute.value.path).toBe("/movements/new/Receive");
    c.files.busy.value = false;
    c.dirty.value = true;
    await flushPromises();
    expect(router.currentRoute.value.path).toBe("/movements/new/Receive");
    c.dirty.value = false;
    await flushPromises();
    expect(router.currentRoute.value.path).toBe("/movements/STE%2FA,1");
    c.busy.value = true;
    c.state.identity = { doctype: "Stock Entry", name: "STE-AMENDED" };
    await flushPromises();
    expect(router.currentRoute.value.path).toContain("STE%2FA,1");
    c.busy.value = false;
    await flushPromises();
    expect(router.currentRoute.value.path).toBe("/movements/STE-AMENDED");
  });
  it("does not interrupt review, conflict recovery or unapplied supporting edits", async () => {
    const { controller: c, router } = await setup();
    c.reviewOpen.value = true;
    c.state.identity = { doctype: "Stock Reconciliation", name: "COUNT-1" };
    c.state.status = "saved";
    await flushPromises();
    expect(router.currentRoute.value.path).toBe("/movements/new/Receive");
    c.state.status = "conflict";
    c.reviewOpen.value = false;
    await flushPromises();
    expect(router.currentRoute.value.path).toBe("/movements/new/Receive");
    c.state.status = "saved";
    c.supportingDirty.value = true;
    await flushPromises();
    expect(router.currentRoute.value.path).toBe("/movements/new/Receive");
    c.supportingDirty.value = false;
    await vi.waitFor(() =>
      expect(router.currentRoute.value.path).toBe("/counts/COUNT-1"),
    );
  });
});
