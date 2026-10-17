import { afterEach, describe, expect, it } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { defineComponent, h, reactive, ref } from "vue";
import { createMemoryHistory, createRouter } from "vue-router";
import { useNativeEditorRoute } from "../src/lib/nativeEditorRoute";
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
    routes: [{ path: "/:pathMatch(.*)*", component: host }],
  });
  await router.push("/stock");
  await router.push("/new/Receive");
  wrappers.push(mount(host, { global: { plugins: [router] } }));
  return { controller, router };
}
describe("saved native editor URLs", () => {
  it("replaces the creation URL with the native identity only after save and attachments settle", async () => {
    const { controller: c, router } = await setup();
    c.savePending.value = 1;
    c.state.identity = { doctype: "Stock Entry", name: "STE/A,1" };
    c.state.status = "saved";
    await flushPromises();
    expect(router.currentRoute.value.path).toBe("/new/Receive");
    c.savePending.value = 0;
    c.files.busy.value = true;
    await flushPromises();
    expect(router.currentRoute.value.path).toBe("/new/Receive");
    c.files.busy.value = false;
    c.dirty.value = true;
    await flushPromises();
    expect(router.currentRoute.value.path).toBe("/new/Receive");
    c.dirty.value = false;
    await flushPromises();
    expect(router.currentRoute.value.path).toBe(
      "/documents/Stock%20Entry/STE%2FA%2C1",
    );
    c.busy.value = true;
    c.state.identity = { doctype: "Stock Entry", name: "STE-AMENDED" };
    await flushPromises();
    expect(router.currentRoute.value.path).toContain("STE%2FA%2C1");
    c.busy.value = false;
    await flushPromises();
    expect(router.currentRoute.value.path).toBe(
      "/documents/Stock%20Entry/STE-AMENDED",
    );
    router.back();
    await flushPromises();
    expect(router.currentRoute.value.path).toBe("/stock");
  });
  it("does not interrupt review, conflict recovery or unapplied supporting edits", async () => {
    const { controller: c, router } = await setup();
    c.reviewOpen.value = true;
    c.state.identity = { doctype: "Stock Reconciliation", name: "COUNT-1" };
    c.state.status = "saved";
    await flushPromises();
    expect(router.currentRoute.value.path).toBe("/new/Receive");
    c.state.status = "conflict";
    c.reviewOpen.value = false;
    await flushPromises();
    expect(router.currentRoute.value.path).toBe("/new/Receive");
    c.state.status = "saved";
    c.supportingDirty.value = true;
    await flushPromises();
    expect(router.currentRoute.value.path).toBe("/new/Receive");
    c.supportingDirty.value = false;
    await flushPromises();
    expect(router.currentRoute.value.path).toBe(
      "/documents/Stock%20Reconciliation/COUNT-1",
    );
  });
});
