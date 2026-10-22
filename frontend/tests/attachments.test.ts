import { afterEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { defineComponent, h, ref } from "vue";
import Attachments from "../src/components/Attachments.vue";
import { useAttachments } from "../src/features/attachments/useAttachments";
import {
  createReferenceData,
  provideInventoryServices,
} from "../src/services/contracts";

const wrappers: VueWrapper[] = [];
afterEach(() => {
  wrappers.splice(0).forEach((wrapper) => wrapper.unmount());
  vi.unstubAllGlobals();
});
const ready = {
  name: "FILE-1",
  file_name: "photo.jpg",
  file_url: "/private/files/photo.jpg",
  file_type: "JPG",
  is_private: 1,
};
function setup(
  props: {
    imagesOnly?: boolean;
    imageRole?: "main" | "attachments" | "all";
    mode?: "edit" | "display";
  } = {},
) {
  const parent = ref<{ doctype: string; name: string }>();
  const account = ref("manager");
  const writable = ref(true);
  const upload = vi.fn().mockResolvedValue(ready);
  const call = vi.fn().mockResolvedValue({ parent_version: "new-version" });
  const primary = vi.fn().mockResolvedValue(undefined);
  const parentChanged = vi.fn();
  let c!: ReturnType<typeof useAttachments>;
  const child = defineComponent({
    setup() {
      c = useAttachments({
        parent: () => parent.value,
        writable: () => writable.value,
        currentAccount: () => account.value,
        account: "manager",
        primary,
        parentChanged,
      });
      return () => h(Attachments, { controller: c, ...props });
    },
  });
  const wrapper = mount(
    defineComponent({
      setup() {
        provideInventoryServices(
          { upload, call, report: vi.fn() },
          createReferenceData(),
        );
        return () => h(child);
      },
    }),
    { attachTo: document.body },
  );
  wrappers.push(wrapper);
  return {
    wrapper,
    c,
    parent,
    account,
    writable,
    upload,
    call,
    primary,
    parentChanged,
  };
}
function button(wrapper: VueWrapper, label: string) {
  return wrapper.findAll("button").find((value) => value.text() === label)!;
}
describe("native-parent attachments", () => {
  it("keeps input files pending until a valid native parent exists and never forces camera capture", async () => {
    const { wrapper, c, parent, upload } = setup();
    const input = wrapper.get<HTMLInputElement>('input[type="file"]');
    expect(input.attributes("capture")).toBeUndefined();
    expect(input.attributes("multiple")).toBeDefined();
    const file = new File(["receipt"], "receipt.pdf", {
      type: "application/pdf",
    });
    Object.defineProperty(input.element, "files", { value: [file] });
    await input.trigger("change");
    expect(c.files[0]?.state).toBe("pending");
    expect(wrapper.text()).toContain("保存资料后上传");
    expect(upload).not.toHaveBeenCalled();
    parent.value = { doctype: "Stock Entry", name: "SE-1" };
    await c.finalize();
    expect(upload).toHaveBeenCalledWith(
      file,
      "Stock Entry",
      "SE-1",
      expect.any(Function),
    );
    expect(c.files[0]?.state).toBe("ready");
  });
  it("filters image-only input while retaining the full document upload option elsewhere", async () => {
    const { wrapper, c } = setup({ imagesOnly: true, imageRole: "main" });
    const input = wrapper.get<HTMLInputElement>('input[type="file"]');
    expect(input.attributes("accept")).toBe("image/*");
    Object.defineProperty(input.element, "files", {
      value: [
        new File(["photo"], "photo.jpg", { type: "image/jpeg" }),
        new File(["receipt"], "receipt.pdf", { type: "application/pdf" }),
      ],
    });
    await input.trigger("change");
    expect(c.files).toHaveLength(0);
    const original = Array.from(document.querySelectorAll("button")).find(
      (button) => button.textContent === "使用原图作为主图",
    )!;
    original.click();
    await flushPromises();
    expect(c.files.map((file) => file.name)).toEqual(["photo.jpg"]);
  });
  it("keeps an image attachment byte-for-byte without mounting the cropper", async () => {
    const { wrapper, c, parent, upload } = setup({ imageRole: "attachments" });
    parent.value = { doctype: "Item", name: "ITEM-1" };
    const original = new File(["original image bytes"], "source.png", {
      type: "image/png",
    });
    const input = wrapper.get<HTMLInputElement>('input[type="file"]');
    Object.defineProperty(input.element, "files", { value: [original] });
    await input.trigger("change");
    await flushPromises();
    expect(wrapper.findComponent({ name: "ImageCrop" }).exists()).toBe(false);
    expect(upload).toHaveBeenCalledWith(
      original,
      "Item",
      "ITEM-1",
      expect.any(Function),
    );
    expect(await (upload.mock.calls[0]![0] as File).text()).toBe(
      "original image bytes",
    );
    expect(c.files[0]?.primary).toBe(false);
  });
  it("requires a confirmed private URL and retries the same parent without losing bytes", async () => {
    const { c, parent, upload } = setup();
    upload
      .mockResolvedValueOnce({ ...ready, is_private: 0 })
      .mockResolvedValueOnce({ ...ready, file_url: "/files/photo.jpg" })
      .mockResolvedValueOnce(ready);
    c.add([new File(["photo"], "photo.jpg", { type: "image/jpeg" })]);
    parent.value = { doctype: "Item", name: "ITEM-1" };
    await c.finalize();
    expect(c.files[0]?.state).toBe("error");
    expect(c.files[0]?.serverName).toBeUndefined();
    await c.finalize();
    expect(c.files[0]?.state).toBe("error");
    await c.finalize();
    expect(c.files[0]?.serverName).toBe("FILE-1");
    expect(upload.mock.calls.every((call) => call[2] === "ITEM-1")).toBe(true);
  });
  it("retains a denied removal and updates the native parent version after an authorized retry", async () => {
    const { wrapper, c, parent, call, parentChanged } = setup();
    parent.value = { doctype: "Item", name: "ITEM-1" };
    c.load([ready]);
    call.mockRejectedValueOnce(new Error("没有移除权限"));
    await c.remove(c.files[0]!);
    expect(c.files).toHaveLength(1);
    expect(c.error.value).toContain("没有移除权限");
    await flushPromises();
    await button(wrapper, "移除").trigger("click");
    await flushPromises();
    expect(c.files).toHaveLength(0);
    expect(parentChanged).toHaveBeenCalledWith("new-version");
    expect(call).toHaveBeenLastCalledWith("native_files.remove_attachment", {
      doctype: "Item",
      name: "ITEM-1",
      file_name: "FILE-1",
    });
  });
  it("blocks all mutations after account changes, including primary-image requests", async () => {
    const { c, parent, account, primary, call, upload } = setup({
      imagesOnly: true,
    });
    parent.value = { doctype: "Item", name: "ITEM-1" };
    c.load([ready]);
    account.value = "another-account";
    await c.primary(c.files[0]!);
    await c.remove(c.files[0]!);
    c.add([new File(["photo"], "new.jpg", { type: "image/jpeg" })]);
    expect(primary).not.toHaveBeenCalled();
    expect(call).not.toHaveBeenCalled();
    expect(upload).not.toHaveBeenCalled();
    expect(c.files).toHaveLength(1);
  });
  it("offers primary selection for saved Item images and hides mutations in display mode", async () => {
    const editable = setup({ imagesOnly: true });
    editable.c.load([ready]);
    await flushPromises();
    await button(editable.wrapper, "设为主图").trigger("click");
    await flushPromises();
    expect(editable.primary).toHaveBeenCalledWith("FILE-1");
    expect(editable.wrapper.text()).toContain("主图");
    const display = setup({ mode: "display", imagesOnly: true });
    display.c.load([ready]);
    await flushPromises();
    expect(display.wrapper.find('input[type="file"]').exists()).toBe(false);
    expect(button(display.wrapper, "设为主图")).toBeUndefined();
    expect(button(display.wrapper, "移除")).toBeUndefined();
    expect(button(display.wrapper, "查看附件")).toBeDefined();
  });
  it("uses primary-image labels for the cover and attachment labels for other files", async () => {
    const main = setup({ imagesOnly: true, imageRole: "main" });
    expect(main.wrapper.text()).toContain("暂无主图");
    main.c.load([ready], ready.file_url);
    await flushPromises();
    expect(button(main.wrapper, "查看主图")).toBeDefined();
    expect(main.wrapper.text()).not.toContain("查看附件");

    const attachments = setup({ imageRole: "attachments" });
    expect(attachments.wrapper.text()).toContain("暂无附件");
  });
  it("explicitly replaces the primary while preserving the prior cover as an attachment", async () => {
    const { c, parent, primary, upload } = setup({
      imagesOnly: true,
      imageRole: "main",
    });
    parent.value = { doctype: "Item", name: "ITEM-1" };
    const previous = {
      ...ready,
      name: "OLD",
      file_name: "old.jpg",
      file_url: "/private/files/old.jpg",
    };
    c.load([previous], previous.file_url);
    const replacement = new File(["new cover"], "new.jpg", {
      type: "image/jpeg",
    });
    c.add([replacement], true);
    await flushPromises();
    expect(upload).toHaveBeenCalledTimes(1);
    expect(primary).toHaveBeenCalledWith("FILE-1");
    expect(c.files.map((file) => file.serverName)).toEqual(["OLD", "FILE-1"]);
    expect(c.files.map((file) => file.primary)).toEqual([false, true]);
  });
  it("restores only reselection metadata and rejects a different filename", async () => {
    const { c, parent, upload } = setup();
    parent.value = { doctype: "Stock Entry", name: "SE-1" };
    c.restore([
      {
        id: "pending",
        name: "photo.jpg",
        type: "image/jpeg",
        url: "blob:old",
        state: "pending",
        progress: 0,
        error: "",
      },
    ]);
    expect(c.files[0]?.state).toBe("reselect");
    expect(c.files[0]?.url).toBeUndefined();
    c.reselect(c.files[0]!, new File(["different"], "other.jpg"));
    expect(upload).not.toHaveBeenCalled();
    expect(c.error.value).toContain("同名文件");
    c.reselect(
      c.files[0]!,
      new File(["photo"], "photo.jpg", { type: "image/jpeg" }),
    );
    await flushPromises();
    expect(c.files[0]?.state).toBe("ready");
  });
});

it("finalizes the selected crop and retained original once, then retries primary metadata without reuploading", async () => {
  const { c, parent, upload, primary } = setup({
    imagesOnly: true,
    imageRole: "main",
  });
  upload.mockImplementation(async (file) => ({
    ...ready,
    name: `FILE-${file.name}`,
    file_name: file.name,
    file_url: `/private/files/${file.name}`,
  }));
  primary
    .mockRejectedValueOnce(new Error("主图保存失败"))
    .mockResolvedValue(undefined);
  c.add(
    [
      new File(["crop"], "crop.png", { type: "image/png" }),
      new File(["original"], "原图-photo.jpg", { type: "image/jpeg" }),
    ],
    true,
  );
  expect(c.files.map((file) => file.primary)).toEqual([true, false]);
  parent.value = { doctype: "Item", name: "ITEM-1" };
  await c.finalize();
  expect(upload).toHaveBeenCalledTimes(2);
  expect(c.files.every((file) => file.state === "ready")).toBe(true);
  expect(c.error.value).toBe("主图保存失败");
  await c.finalize();
  expect(upload).toHaveBeenCalledTimes(2);
  expect(primary).toHaveBeenLastCalledWith("FILE-crop.png");
  await c.finalize();
  expect(primary).toHaveBeenCalledTimes(2);
});
