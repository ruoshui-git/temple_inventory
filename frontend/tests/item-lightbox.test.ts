// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { defineComponent, h, nextTick, ref } from "vue";

const call = vi.fn();
const services = {
  call,
  fileDisplayUrl: (file: { file_url: string }) => file.file_url,
};
vi.mock("../src/services/contracts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/services/contracts")>()),
  useOptionalInventoryServices: () => services,
}));

import ItemLightbox from "../src/components/ItemLightbox.vue";

const LightboxHost = defineComponent({
  props: ["item"],
  setup(props) {
    const index = ref(0);
    return () =>
      h(ItemLightbox, {
        item: props.item,
        index: index.value,
        "onUpdate:index": (value: number) => (index.value = value),
      });
  },
});

const wrappers: VueWrapper[] = [];
afterEach(() => {
  wrappers.splice(0).forEach((wrapper) => wrapper.unmount());
  call.mockReset();
});

const item = { code: "ITEM-1", name: "测试物品", image: "/private/cover.jpg" };
const attachments = [
  {
    name: "SIDE",
    file_name: "侧面.png",
    file_type: "png",
    file_url: "/private/side.png",
  },
  {
    name: "DUP",
    file_name: "重复.jpg",
    file_type: "jpg",
    file_url: "/private/cover.jpg",
  },
  {
    name: "DOC",
    file_name: "说明.pdf",
    file_type: "pdf",
    file_url: "/private/note.pdf",
  },
];

function setup() {
  const wrapper = mount(LightboxHost, {
    props: { item },
    attachTo: document.body,
  });
  wrappers.push(wrapper);
  return wrapper;
}
function bodyText() {
  return document.body.textContent || "";
}

describe("ItemLightbox", () => {
  it("loads attachments once, keeps the cover first, filters and deduplicates, and cycles", async () => {
    call.mockResolvedValue(attachments);
    const wrapper = setup();
    expect(document.body.textContent).toContain("ITEM-1");
    expect(call).toHaveBeenCalledOnce();
    expect(call).toHaveBeenCalledWith(
      "native_files.attachments",
      { doctype: "Item", name: "ITEM-1" },
      expect.anything(),
    );
    await flushPromises();
    expect(bodyText()).toContain("1 / 2");
    expect(
      Array.from(
        document.body.querySelectorAll<HTMLButtonElement>(
          'button[aria-label="上一张"], button[aria-label="下一张"]',
        ),
        (button) => button.getAttribute("aria-label"),
      ),
    ).toEqual(["上一张", "下一张"]);
    document.body
      .querySelector<HTMLButtonElement>('button[aria-label="下一张"]')
      ?.click();
    await flushPromises();
    expect(bodyText()).toContain("2 / 2");
    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }),
    );
    await flushPromises();
    expect(bodyText()).toContain("1 / 2");
    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }),
    );
    await flushPromises();
    expect(bodyText()).toContain("2 / 2");
  });

  it("swipes the image and suppresses the following click", async () => {
    call.mockResolvedValue(attachments);
    const wrapper = setup();
    await flushPromises();
    const stage = document.body.querySelector<HTMLElement>(
      ".item-lightbox-artwork",
    )!;
    for (const [type, clientX] of [
      ["pointerdown", 180],
      ["pointerup", 100],
      ["click", 100],
    ] as const) {
      const event = new Event(type, { bubbles: true });
      Object.defineProperty(event, "clientX", { value: clientX });
      stage.dispatchEvent(event);
      if (type === "pointerup") await nextTick();
    }
    expect(bodyText()).toContain("2 / 2");
  });

  it("hides navigation for a single cover and silently keeps it on fetch failure", async () => {
    call.mockRejectedValue(new Error("offline"));
    const wrapper = setup();
    await flushPromises();
    expect(
      document.body.querySelector("button[aria-label='上一张']"),
    ).toBeNull();
    expect(
      document.body.querySelector("button[aria-label='下一张']"),
    ).toBeNull();
    expect(bodyText()).not.toContain("/ 1");
    expect(bodyText()).toContain("ITEM-1");
    expect(bodyText()).not.toContain("offline");
  });

  it("keeps artwork-only items on one slide without requesting attachments", async () => {
    const wrapper = mount(ItemLightbox, {
      props: { item: { ...item, image: "" }, hasArtwork: true },
      slots: { artwork: '<div class="fixture-artwork">Artwork</div>' },
      attachTo: document.body,
    });
    wrappers.push(wrapper);
    await flushPromises();
    expect(call).not.toHaveBeenCalled();
    expect(document.body.querySelector(".fixture-artwork")).not.toBeNull();
    expect(
      document.body.querySelector("button[aria-label='下一张']"),
    ).toBeNull();
    expect(bodyText()).toContain("ITEM-1");
  });

  it("aborts and ignores a pending response when the item changes", async () => {
    let resolve!: (files: typeof attachments) => void;
    call
      .mockReturnValueOnce(new Promise((done) => (resolve = done)))
      .mockResolvedValueOnce([]);
    const wrapper = setup();
    const signal = call.mock.calls[0]?.[2] as AbortSignal;
    await wrapper.setProps({
      item: { code: "ITEM-2", name: "新物品", image: "/private/new.jpg" },
    });
    expect(signal.aborted).toBe(true);
    resolve(attachments);
    await flushPromises();
    expect(bodyText()).not.toContain("2 / 2");
    expect(bodyText()).toContain("ITEM-2");
  });

  it("aborts a pending request on close", async () => {
    let resolve!: (files: typeof attachments) => void;
    call.mockReturnValue(new Promise((done) => (resolve = done)));
    const wrapper = setup();
    const signal = call.mock.calls[0]?.[2] as AbortSignal;
    wrapper.unmount();
    expect(signal.aborted).toBe(true);
    resolve(attachments);
    await flushPromises();
  });
});
