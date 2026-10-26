// @vitest-environment jsdom
import { defineComponent, h, nextTick, ref } from "vue";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { afterEach, describe, expect, it } from "vitest";
import Overlay from "../src/components/ui/Overlay.vue";

const wrappers: VueWrapper[] = [];
afterEach(() => {
	wrappers.splice(0).forEach((wrapper) => wrapper.unmount());
	document.body.innerHTML = "";
	history.replaceState(null, "", location.pathname);
});

describe("stacked overlays", () => {
	it("closes only the top modal on Escape and restores focus into its parent", async () => {
		const host = defineComponent({
			setup() {
				const parent = ref(true);
				const child = ref(false);
				return () => h("div", [
					parent.value && h(Overlay, { title: "Parent", onClose: () => { parent.value = false; } }, {
						default: () => h("button", { id: "open-child", onClick: () => { child.value = true; } }, "Open child"),
					}),
					child.value && h(Overlay, { title: "Child", onClose: () => { child.value = false; } }, { default: () => h("p", "Child content") }),
				]);
			},
		});
		const wrapper = mount(host, { attachTo: document.body });
		wrappers.push(wrapper);
		await flushPromises();
		const opener = document.querySelector<HTMLButtonElement>("#open-child")!;
		opener.focus();
		opener.click();
		await flushPromises();
		expect(document.querySelectorAll(".preview-overlay")).toHaveLength(2);
		document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
		await nextTick();
		await flushPromises();
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(document.querySelectorAll(".preview-overlay")).toHaveLength(1);
		expect(document.activeElement).toBe(opener);
		document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
		await flushPromises();
		expect(document.querySelectorAll(".preview-overlay")).toHaveLength(0);
	});

	it("Back closes the top stacked modal and leaves its parent active", async () => {
		const host = defineComponent({
			setup() {
				const parent = ref(true);
				const child = ref(false);
				return () => h("div", [
					parent.value && h(Overlay, { title: "Parent", onClose: () => { parent.value = false; } }, {
						default: () => h("button", { id: "open-child", onClick: () => { child.value = true; } }, "Open child"),
					}),
					child.value && h(Overlay, { title: "Child", onClose: () => { child.value = false; } }, { default: () => h("p", "Child content") }),
				]);
			},
		});
		const wrapper = mount(host, { attachTo: document.body });
		wrappers.push(wrapper);
		await flushPromises();
		const opener = document.querySelector<HTMLButtonElement>("#open-child")!;
		opener.focus();
		opener.click();
		await flushPromises();
		history.replaceState(null, "", window.location.href);
		window.dispatchEvent(new PopStateEvent("popstate", { state: null }));
		await flushPromises();
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(document.querySelectorAll(".preview-overlay")).toHaveLength(1);
		expect(document.activeElement).toBe(opener);
	});
});
