// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { defineComponent, h, ref, reactive } from "vue";
import {
  createBrowseMemory,
  provideBrowseMemory,
  useBrowseState,
} from "../src/lib/browseMemory";
import { newReportQuery } from "../src/lib/reportContract";
import type { InventoryServices, ReportPage } from "../src/services/contracts";

const wrappers: VueWrapper[] = [];
afterEach(() => {
  wrappers.splice(0).forEach((wrapper) => wrapper.unmount());
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
function services() {
  const call = vi.fn(
    async (_endpoint: string, args: Record<string, unknown> = {}) => {
      const start = Number(args.start || 0);
      return {
        rows: [start, start + 1].map((id) => ({ id, qty: 7 })),
        matched_count: 6,
        next_start: start < 4 ? start + 2 : null,
      };
    },
  );
  const report = vi.fn(
    async (query, options = {}) =>
      ({
        ...(await call("report", options)),
        query,
        table: options.table || "summary",
      }) as ReportPage,
  );
  return { call, report, upload: vi.fn() } as unknown as InventoryServices;
}

describe("browse navigation memory", () => {
  it("returns remembered rows immediately and notifies the controller with the fresh response", async () => {
    let entry = "site:user:/stock:1";
    const source = services(),
      memory = createBrowseMemory(() => entry),
      wrapped = memory.wrap(source);
    await wrapped.call("browse.inventory_page", {
      query: { search: "A" },
      page_length: 2,
    });
    entry = "site:user:/item/A:2";
    memory.activate();
    entry = "site:user:/stock:1";
    memory.activate();
    let resolve!: (value: unknown) => void;
    vi.mocked(source.call).mockImplementationOnce(
      () => new Promise((done) => (resolve = done)) as never,
    );
    const onRefresh = vi.fn();
    const result = await wrapped.callBrowse!<{ rows: { qty: number }[] }>(
      "browse.inventory_page",
      {
        query: { search: "A" },
        page_length: 2,
      },
      undefined,
      { onRefresh },
    );
    expect(result.rows[0]?.qty).toBe(7);
    await new Promise((done) => setTimeout(done, 0));
    resolve({
      rows: [
        { id: 0, qty: 9 },
        { id: 1, qty: 9 },
      ],
      matched_count: 6,
      next_start: 2,
    });
    await flushPromises();
    expect(onRefresh).toHaveBeenCalledWith(
      expect.objectContaining({
        rows: [
          { id: 0, qty: 9 },
          { id: 1, qty: 9 },
        ],
      }),
    );
    expect(source.call).toHaveBeenCalledTimes(2);
  });

  it("clears remembered responses after successful writes and never crosses accounts, queries or five minutes", async () => {
    let entry = "site:user:/stock:1";
    const source = services(),
      memory = createBrowseMemory(() => entry),
      wrapped = memory.wrap(source);
    await wrapped.call("browse.inventory_page", { query: { search: "A" } });
    entry = "site:user:/item/A:2";
    memory.activate();
    entry = "site:user:/stock:1";
    memory.activate();
    vi.mocked(source.call).mockResolvedValueOnce({
      rows: [{ qty: 8 }],
      matched_count: 1,
      next_start: null,
    } as never);
    await wrapped.call("native_api.save_document", {});
    const fresh = vi.fn();
    await wrapped.callBrowse!(
      "browse.inventory_page",
      { query: { search: "A" } },
      undefined,
      { onRefresh: fresh },
    );
    expect(fresh).not.toHaveBeenCalled();
    entry = "site:other:/stock:1";
    memory.activate();
    const accountFresh = vi.fn();
    await wrapped.callBrowse!(
      "browse.inventory_page",
      { query: { search: "A" } },
      undefined,
      { onRefresh: accountFresh },
    );
    expect(accountFresh).not.toHaveBeenCalled();
    entry = "site:user:/stock:1";
    memory.activate();
    const queryFresh = vi.fn();
    await wrapped.callBrowse!(
      "browse.inventory_page",
      { query: { search: "B" } },
      undefined,
      { onRefresh: queryFresh },
    );
    expect(queryFresh).not.toHaveBeenCalled();
    await wrapped.call("browse.inventory_page", { query: { search: "A" } });
    entry = "site:user:/item/A:2";
    memory.activate();
    entry = "site:user:/stock:1";
    memory.activate();
    vi.spyOn(Date, "now").mockReturnValue(Date.now() + 5 * 60_000 + 1);
    const expiredFresh = vi.fn();
    await wrapped.callBrowse!(
      "browse.inventory_page",
      { query: { search: "A" } },
      undefined,
      { onRefresh: expiredFresh },
    );
    expect(expiredFresh).not.toHaveBeenCalled();
  });

  it("scopes browse-group snapshots to each browser history entry", () => {
    let entry = "site:manager:/loans?view=items:1";
    const memory = createBrowseMemory(() => entry);
    memory.activate();
    expect(memory.identity()).toBe(entry);
    entry = "site:manager:/loans?view=records:2";
    memory.activate();
    expect(memory.identity()).toBe(entry);
    entry = "site:manager:/loans?view=items:1";
    memory.activate();
    expect(memory.identity()).toBe(entry);
  });

  it("rereads the previous page depth, uses fresh quantities, and never replays writes", async () => {
    let entry = "site:manager:/stock:1";
    const source = services(),
      memory = createBrowseMemory(() => entry),
      wrapped = memory.wrap(source);
    await wrapped.call("browse.inventory_page", {
      query: { search: "A" },
      start: 0,
      page_length: 2,
    });
    await wrapped.call("browse.inventory_page", {
      query: { search: "A" },
      start: 2,
      page_length: 2,
    });
    await wrapped.call("native_api.save_document", { name: "DRAFT-A" });
    entry = "site:manager:/stock/items/A:2";
    memory.activate();
    entry = "site:manager:/stock:1";
    memory.activate();
    vi.mocked(source.call).mockImplementation(async (_endpoint, args = {}) => {
      const start = Number(args.start || 0);
      return {
        rows: [start, start + 1].map((id) => ({ id, qty: 9 })),
        matched_count: 6,
        next_start: start + 2,
      } as never;
    });
    const result = await wrapped.call<{
      rows: { qty: number }[];
      next_start: number;
    }>("browse.inventory_page", { query: { search: "A" }, page_length: 2 });
    expect(result.rows.map((row) => row.qty)).toEqual([9, 9, 9, 9]);
    expect(result.next_start).toBe(4);
    expect(
      vi
        .mocked(source.call)
        .mock.calls.filter(
          ([endpoint]) => endpoint === "native_api.save_document",
        ),
    ).toHaveLength(1);
    // The replay is consumed; an ordinary refresh starts from its first page.
    expect(
      (
        await wrapped.call<{ rows: unknown[] }>("browse.inventory_page", {
          query: { search: "A" },
          page_length: 2,
        })
      ).rows,
    ).toHaveLength(2);
  });

  it("restores depth within the endpoint page limit in one enlarged request", async () => {
    let entry = "restore-depth";
    const source = services(),
      memory = createBrowseMemory(() => entry),
      wrapped = memory.wrap(source);
    vi.mocked(source.call).mockImplementation(async (_endpoint, args = {}) => {
      const start = Number(args.start || 0),
        length = Number(args.page_length || 30);
      return {
        rows: Array.from({ length }, (_, index) => ({ id: start + index })),
        matched_count: 200,
        next_start: start + length < 200 ? start + length : null,
      } as never;
    });
    await wrapped.call("browse.inventory_page", { page_length: 20 });
    await wrapped.call("browse.inventory_page", { start: 20, page_length: 20 });
    entry = "other";
    memory.activate();
    entry = "restore-depth";
    memory.activate();
    vi.mocked(source.call).mockClear();

    const restored = await wrapped.call<{ rows: unknown[] }>(
      "browse.inventory_page",
      {
        page_length: 20,
      },
    );

    expect(restored.rows).toHaveLength(40);
    expect(vi.mocked(source.call)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(source.call).mock.calls[0]?.[1]?.page_length).toBe(40);
  });

  it("restores main and related report tables independently and isolates account and scope", async () => {
    let entry = "site:manager:/reports:1";
    const source = services(),
      memory = createBrowseMemory(() => entry),
      wrapped = memory.wrap(source),
      query = newReportQuery("inventory");
    await wrapped.report(query);
    await wrapped.report(query, { table: "summary", start: 2 });
    await wrapped.report(query, { table: "locations" });
    await wrapped.report(query, { table: "locations", start: 2 });
    await wrapped.report(query, { table: "locations", start: 4 });
    entry = "other";
    memory.activate();
    entry = "site:manager:/reports:1";
    memory.activate();
    expect((await wrapped.report(query)).rows).toHaveLength(4);
    expect(
      (await wrapped.report(query, { table: "locations" })).rows,
    ).toHaveLength(6);
    entry = "site:another:/reports:1";
    memory.activate();
    expect((await wrapped.report(query)).rows).toHaveLength(2);
    entry = "site:manager:/reports:1";
    memory.activate();
    expect(
      (await wrapped.report({ ...query, search: "another scope" })).rows,
    ).toHaveLength(2);
  });

  it("keeps failed replay retryable and stops after an aborted request", async () => {
    let entry = "a";
    const source = services(),
      memory = createBrowseMemory(() => entry),
      wrapped = memory.wrap(source);
    await wrapped.call("browse.native_drafts", {});
    await wrapped.call("browse.native_drafts", { start: 2 });
    entry = "b";
    memory.activate();
    entry = "a";
    memory.activate();
    vi.mocked(source.call).mockRejectedValueOnce(new Error("网络失败"));
    await expect(wrapped.call("browse.native_drafts", {})).rejects.toThrow(
      "网络失败",
    );
    expect(
      (await wrapped.call<{ rows: unknown[] }>("browse.native_drafts", {}))
        .rows,
    ).toHaveLength(4);
    entry = "b";
    memory.activate();
    entry = "a";
    memory.activate();
    const controller = new AbortController();
    controller.abort();
    const count = vi.mocked(source.call).mock.calls.length;
    await wrapped.call("browse.native_drafts", {}, controller.signal);
    expect(vi.mocked(source.call).mock.calls.length - count).toBe(1);
    expect(
      (await wrapped.call<{ rows: unknown[] }>("browse.native_drafts", {}))
        .rows,
    ).toHaveLength(4);
  });

  it("refuses a result count change during replay instead of claiming complete restoration", async () => {
    let entry = "a";
    const source = services(),
      memory = createBrowseMemory(() => entry),
      wrapped = memory.wrap(source);
    await wrapped.call("browse.counts_page", {});
    await wrapped.call("browse.counts_page", { start: 2 });
    entry = "b";
    memory.activate();
    entry = "a";
    memory.activate();
    vi.mocked(source.call)
      .mockResolvedValueOnce({
        rows: [{ id: 1 }],
        matched_count: 6,
        next_start: 2,
      } as never)
      .mockResolvedValueOnce({
        rows: [{ id: 2 }],
        matched_count: 5,
        next_start: null,
      } as never);
    await expect(wrapped.call("browse.counts_page", {})).rejects.toThrow(
      "浏览期间结果已变化",
    );
  });

  it("retains view, selection, disclosure and horizontal position only for the matching history scope", async () => {
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      frames.push(callback);
      return frames.length;
    });
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    vi.stubGlobal("scrollTo", vi.fn());
    let entry = "site:manager:/stock:1";
    const memory = createBrowseMemory(() => entry),
      current = reactive({ scope: "A" });
    let selection!: ReturnType<typeof ref<string[]>>,
      view!: ReturnType<typeof ref<string>>;
    const page = defineComponent({
      setup() {
        selection = ref<string[]>([]);
        view = ref("card");
        useBrowseState(
          "stock",
          () => current.scope,
          () => ({ selected: selection.value, view: view.value }),
          (value) => {
            selection.value = value.selected as string[];
            view.value = String(value.view);
          },
          () => true,
        );
        return () =>
          h("section", [
            h("div", { "data-browse-scroll": "table" }, [
              h("details", { "data-browse-details": "analysis" }, [
                h("summary", "分析"),
              ]),
            ]),
          ]);
      },
    });
    const root = defineComponent({
      setup() {
        provideBrowseMemory(memory);
        return () => h(page);
      },
    });
    const open = () => {
      const wrapper = mount(root, { attachTo: document.body });
      wrappers.push(wrapper);
      return wrapper;
    };
    const settle = async () => {
      await flushPromises();
      while (frames.length) {
        frames.shift()!(0);
        await flushPromises();
      }
    };
    const first = open();
    await settle();
    selection.value = ["A", "B"];
    view.value = "table";
    first.find("[data-browse-scroll]").element.scrollLeft = 180;
    (first.find("details").element as HTMLDetailsElement).open = true;
    first.unmount();
    wrappers.pop();
    entry = "site:manager:/stock/items/A:2";
    memory.activate();
    entry = "site:manager:/stock:1";
    memory.activate();
    const back = open();
    await settle();
    expect(selection.value).toEqual(["A", "B"]);
    expect(view.value).toBe("table");
    expect(back.find("[data-browse-scroll]").element.scrollLeft).toBe(180);
    expect((back.find("details").element as HTMLDetailsElement).open).toBe(
      true,
    );
    back.unmount();
    wrappers.pop();
    current.scope = "different";
    const changed = open();
    await settle();
    expect(selection.value).toEqual([]);
    expect(view.value).toBe("card");
    changed.unmount();
    wrappers.pop();
    entry = "site:manager:/stock:3";
    const fresh = open();
    await settle();
    expect(selection.value).toEqual([]);
    expect(fresh.find("[data-browse-scroll]").element.scrollLeft).toBe(0);
  });
});
