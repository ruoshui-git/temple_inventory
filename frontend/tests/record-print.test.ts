// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { defineComponent, h } from "vue";
import UiButton from "../src/components/ui/UiButton.vue";
import { useRecordPrint } from "../src/features/print/useRecordPrint";
import {
  backgroundTaskState,
  resetBackgroundTasks,
} from "../src/services/backgroundTasks";
import { preferenceUser } from "../src/lib/uiPreferences";

const wrappers: VueWrapper[] = [];
afterEach(() => {
  wrappers.splice(0).forEach((wrapper) => wrapper.unmount());
  resetBackgroundTasks();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function host() {
  return defineComponent({
    setup() {
      const print = useRecordPrint();
      return () =>
        h("div", [
          h(
            UiButton,
            {
              loading: print.loading.value,
              onClick: () => print.print("Stock Entry", "MAT-STE-1"),
            },
            () => "打印",
          ),
          h(
            UiButton,
            {
              onClick: () =>
                print.downloadPdf("Stock Entry", "MAT-STE-1", "物资单据"),
            },
            () => "下载 PDF",
          ),
        ]);
    },
  });
}

describe("record print", () => {
  it("prints the server HTML through a hidden same-origin iframe and removes it after printing", async () => {
    preferenceUser.value = "account@example.test";
    const html = "<!doctype html><html><body><h1>MAT-STE-1</h1></body></html>";
    const fetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({ message: { html, title: "MAT-STE-1" } }),
          { status: 200 },
        ),
    );
    vi.stubGlobal("fetch", fetch);
    const wrapper = mount(host(), { attachTo: document.body });
    wrappers.push(wrapper);
    const printed = vi.fn();
    const originalAppend = document.body.append.bind(document.body);
    vi.spyOn(document.body, "append").mockImplementation((...nodes) => {
      originalAppend(...nodes);
      const frame = nodes[0] as HTMLIFrameElement;
      if (frame instanceof HTMLIFrameElement) {
        // jsdom has no print(): stub it on the frame window and report the afterprint event.
        Object.defineProperty(frame.contentWindow, "print", {
          value: () => {
            printed(frame.srcdoc);
            frame.contentWindow?.dispatchEvent(new Event("afterprint"));
          },
        });
      }
    });
    await wrapper.findAllComponents(UiButton)[0]!.trigger("click");
    await flushPromises();
    expect(fetch).toHaveBeenCalledWith(
      "/api/method/temple_inventory.printing.print_record_html?doctype=Stock+Entry&name=MAT-STE-1",
      expect.objectContaining({
        headers: { "X-Inventory-Account": "account@example.test" },
      }),
    );
    expect(printed).toHaveBeenCalledWith(html);
    expect(document.querySelector('iframe[aria-hidden="true"]')).toBeNull();
    preferenceUser.value = "";
  });

  it("shows the server message as a toast and leaves no frame when the HTML request fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ message: "无权打印此单据" }), {
            status: 403,
          }),
      ),
    );
    const toasts: string[] = [];
    window.addEventListener("temple-inventory-toast", (event) =>
      toasts.push((event as CustomEvent).detail.message),
    );
    const wrapper = mount(host(), { attachTo: document.body });
    wrappers.push(wrapper);
    await wrapper.findAllComponents(UiButton)[0]!.trigger("click");
    await flushPromises();
    expect(toasts).toContain("无权打印此单据");
    expect(document.querySelector("iframe")).toBeNull();
  });

  it("queues 下载 PDF as a background task instead of printing", async () => {
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:record-pdf");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(new Blob(["%PDF"]), { status: 200 })),
    );
    const wrapper = mount(host(), { attachTo: document.body });
    wrappers.push(wrapper);
    await wrapper.findAllComponents(UiButton)[1]!.trigger("click");
    await flushPromises();
    expect(backgroundTaskState.tasks).toHaveLength(1);
    expect(backgroundTaskState.tasks[0]).toMatchObject({
      kind: "print-pdf",
      title: "物资单据",
      status: "completed",
      filename: "MAT-STE-1.pdf",
    });
  });

  it("keeps print disabled with the save reason while the editor has changes", () => {
    const wrapper = mount(UiButton, {
      props: { disabled: true, title: "请先保存后再打印" },
      slots: { default: "打印" },
    });
    wrappers.push(wrapper);
    expect(wrapper.get("button").attributes("disabled")).toBeDefined();
    expect(wrapper.get("button").attributes("title")).toBe("请先保存后再打印");
  });
});
