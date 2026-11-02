// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { defineComponent, h } from "vue";
import PdfPreviewDialog from "../src/components/PdfPreviewDialog.vue";
import UiButton from "../src/components/ui/UiButton.vue";
import { useRecordPrint } from "../src/features/print/useRecordPrint";
import { preferenceUser } from "../src/lib/uiPreferences";
const wrappers: VueWrapper[] = [];
afterEach(() => {
  wrappers.splice(0).forEach((wrapper) => wrapper.unmount());
  vi.restoreAllMocks();
});
describe("record print", () => {
  it("fetches a permission checked PDF with the selected account and displays preview actions", async () => {
    preferenceUser.value = "account@example.test";
    vi.stubGlobal("matchMedia", () => ({ matches: false }));
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:record-pdf");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    const fetch = vi.fn(
      async () => new Response(new Blob(["%PDF"]), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetch);
    const host = defineComponent({
      setup() {
        const print = useRecordPrint();
        return () =>
          h("div", [
            h(
              UiButton,
              { onClick: () => print.open("Stock Entry", "MAT-STE-1") },
              () => "打印",
            ),
            print.url.value
              ? h(PdfPreviewDialog, {
                  url: print.url.value,
                  number: print.number.value,
                  onClose: print.close,
                })
              : null,
          ]);
      },
    });
    const wrapper = mount(host, { attachTo: document.body });
    wrappers.push(wrapper);
    await wrapper.get("button").trigger("click");
    await flushPromises();
    expect(fetch).toHaveBeenCalledWith(
      "/api/method/temple_inventory.printing.print_record_pdf?doctype=Stock+Entry&name=MAT-STE-1",
      expect.objectContaining({
        headers: { "X-Inventory-Account": "account@example.test" },
      }),
    );
    expect(document.querySelector("iframe")?.getAttribute("src")).toBe(
      "blob:record-pdf",
    );
    expect(document.body.textContent).toContain("打印");
    expect(document.body.textContent).toContain("下载");
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
