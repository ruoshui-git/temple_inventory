import { afterEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { defineComponent, h, nextTick, ref } from "vue";
import { useReportGroups } from "../src/composables/useReportGroups";
import { newReportQuery } from "../src/lib/reportContract";
import DataTable from "../src/components/ui/DataTable.vue";
import {
  createReferenceData,
  provideInventoryServices,
  type GroupPage,
} from "../src/services/contracts";

const wrappers: VueWrapper[] = [];
afterEach(() => wrappers.splice(0).forEach((wrapper) => wrapper.unmount()));

describe("lazy report groups", () => {
  it("formats movement kinds and Loan statuses for display without changing group values", async () => {
    for (const [dataset, field, rawLabel, expected] of [
      ["movements", "kind", "Transfer", "调拨"],
      ["loans", "status", "Settled", "已结清"],
    ] as const) {
      const reference = createReferenceData();
      Object.assign(reference, { site: `${dataset}.local`, user: "viewer" });
      const services = { call: vi.fn(), report: vi.fn(), upload: vi.fn() };
      const query = ref(newReportQuery(dataset));
      query.value.view = "records";
      query.value.groupBy = [field];
      let groups!: ReturnType<typeof useReportGroups>;
      const consumer = defineComponent({
        setup() {
          groups = useReportGroups(query, services, false);
          groups.seed(
            [
              {
                id: `${field}:${rawLabel}`,
                row_grain: "group",
                group_path: [rawLabel],
                group_depth: 1,
                group_label: rawLabel,
                has_children: true,
              },
            ],
            null,
            [],
            42,
          );
          return () => h("div");
        },
      });
      const wrapper = mount(
        defineComponent({
          setup() {
            provideInventoryServices(services, reference);
            return () => h(consumer);
          },
        }),
      );
      wrappers.push(wrapper);
      await flushPromises();
      const group = groups.entries.value[0];
      expect(groups.progress()).toEqual({ loaded: 1, total: 42 });
      expect(group?.kind).toBe("group");
      if (group?.kind === "group") {
        expect(group.label).toBe(expected);
        expect((group.value as Record<string, unknown>).group_label).toBe(
          rawLabel,
        );
      }
    }
  });

  it("hides a failed child page when collapsed and restores its retry action when reopened", async () => {
    const reference = createReferenceData();
    Object.assign(reference, { site: "collapse-error.local", user: "viewer" });
    let childCalls = 0;
    const services = {
      call: vi.fn(async (_method: string, args: Record<string, unknown>) => {
        const path = args.parent_path as string[];
        if (!path.length)
          return {
            rows: [
              {
                id: "category:a",
                row_grain: "group",
                group_path: ["A"],
                group_depth: 1,
                group_label: "A",
                has_children: true,
                stock_uom: "each",
              },
            ],
            matched_count: 1,
            next_start: null,
            parent_path: path,
            parent_unit: null,
            row_grain: "group",
            query: args.query,
          } satisfies GroupPage;
        childCalls += 1;
        if (childCalls === 1) throw new Error("child page failed");
        return {
          rows: [
            {
              id: "item:a:each",
              row_grain: "group",
              group_path: ["A", "ITEM-A"],
              group_depth: 2,
              group_label: "物品甲",
              has_children: false,
              item_code: "ITEM-A",
              stock_uom: "each",
            },
          ],
          matched_count: 1,
          next_start: null,
          parent_path: path,
          parent_unit: "each",
          row_grain: "group",
          query: args.query,
        } satisfies GroupPage;
      }),
      report: vi.fn(),
      upload: vi.fn(),
    };
    const query = ref(newReportQuery("inventory"));
    query.value.groupBy = ["category", "item"];
    let groups!: ReturnType<typeof useReportGroups>;
    const host = defineComponent({
      setup() {
        groups = useReportGroups(query, services);
        return () =>
          h(
            DataTable,
            {
              ariaLabel: "grouped inventory",
              columns: [{ id: "item_name", label: "物品" }],
              rows: groups.entries.value,
              onToggleGroup: (id: string) => void groups.toggleGroup(id),
            },
            {
              group: ({ group }: { group: { error?: string; id: string } }) =>
                h("div", [
                  group.error
                    ? h("span", { role: "alert" }, group.error)
                    : null,
                  group.error
                    ? h(
                        "button",
                        { onClick: () => void groups.retry(group.id) },
                        "重试",
                      )
                    : null,
                ]),
            },
          );
      },
    });
    const wrapper = mount(
      defineComponent({
        setup() {
          provideInventoryServices(services, reference);
          return () => h(host);
        },
      }),
    );
    wrappers.push(wrapper);
    await flushPromises();
    await wrapper.get(".data-table-group-toggle").trigger("click");
    await flushPromises();
    expect(childCalls).toBe(1);
    expect(wrapper.get('[role="alert"]').text()).toBe("child page failed");
    await wrapper.get(".data-table-group-toggle").trigger("click");
    await flushPromises();
    expect(wrapper.findAll(".data-table-group-detail-row")).toHaveLength(0);
    expect(wrapper.findAll('[role="alert"]')).toHaveLength(0);
    expect(
      wrapper.get(".data-table-group-row").attributes("aria-expanded"),
    ).toBe("false");
    await wrapper.get(".data-table-group-toggle").trigger("click");
    await flushPromises();
    expect(childCalls).toBe(1);
    expect(wrapper.get('[role="alert"]').text()).toBe("child page failed");
    await wrapper.get(".data-table-group-detail-row button").trigger("click");
    await flushPromises();
    expect(childCalls).toBe(2);
    expect(wrapper.text()).toContain("物品甲");
    expect(wrapper.findAll('[role="alert"]')).toHaveLength(0);
  });

  it("keeps the projected leaf schema when a report page seeds grouped roots", async () => {
    const reference = createReferenceData();
    Object.assign(reference, { site: "reports.local", user: "viewer" });
    const services = { call: vi.fn(), report: vi.fn(), upload: vi.fn() };
    const query = ref(newReportQuery("movements"));
    query.value.groupBy = ["item"];
    let groups!: ReturnType<typeof useReportGroups>;
    const consumer = defineComponent({
      setup() {
        groups = useReportGroups(query, services, false);
        groups.seed(
          [
            {
              id: "item:a",
              row_grain: "group",
              group_path: ["A"],
              group_depth: 1,
              group_label: "A",
              has_children: true,
              stock_uom: "Nos",
            },
          ],
          null,
          ["document", "date", "whole"],
        );
        return () => h("div");
      },
    });
    const wrapper = mount(
      defineComponent({
        setup() {
          provideInventoryServices(services, reference);
          return () => h(consumer);
        },
      }),
    );
    wrappers.push(wrapper);
    await flushPromises();
    expect(groups.leafColumns.value).toEqual(["document", "date", "whole"]);
  });

  it("keeps whole group counts stable while paginating and deduplicates native leaf identities", async () => {
    const reference = createReferenceData();
    Object.assign(reference, { site: "records.local", user: "viewer" });
    const query = ref(newReportQuery("loans"));
    query.value.view = "records";
    query.value.groupBy = ["borrower"];
    const record = (id: string, name: string) => ({
      id,
      row_grain: "record" as const,
      doctype: "Stock Entry",
      document: name,
      whole: { quantities: [{ uom: "Nos", qty: 2 }] },
    });
    const services = {
      call: vi.fn(async (_method: string, args: Record<string, unknown>) => {
        const path = args.parent_path as string[];
        const start = Number(args.start || 0);
        const rows = !path.length
          ? [
              {
                id: "borrower:a",
                row_grain: "group" as const,
                group_path: ["A"],
                group_depth: 1,
                group_label: "A",
                has_children: true,
                borrower: "A",
                stock_uom: "Nos",
                display_count: 3,
                count_label: "笔",
              },
            ]
          : start === 0
            ? [record("leaf-1", "STE-1")]
            : [record("leaf-1-copy", "STE-1"), record("leaf-2", "STE-2")];
        return {
          rows,
          matched_count: path.length ? 3 : 1,
          next_start: path.length && start === 0 ? 1 : null,
          parent_path: path,
          parent_unit: args.parent_unit as string | null,
          row_grain: path.length ? "record" : "group",
          query: args.query as GroupPage["query"],
        } satisfies GroupPage;
      }),
      report: vi.fn(),
      upload: vi.fn(),
    };
    let groups!: ReturnType<typeof useReportGroups>;
    const consumer = defineComponent({
      setup() {
        groups = useReportGroups(query, services);
        return () =>
          h(
            "button",
            { onClick: () => groups.toggleGroup("borrower:a") },
            "open",
          );
      },
    });
    const wrapper = mount(
      defineComponent({
        setup() {
          provideInventoryServices(services, reference);
          return () => h(consumer);
        },
      }),
    );
    wrappers.push(wrapper);
    await flushPromises();
    expect(groups.progress()).toEqual({ loaded: 1, total: 1 });
    expect(groups.entries.value[0]).toMatchObject({
      count: 3,
      countLabel: "记录数",
    });
    await wrapper.get("button").trigger("click");
    await flushPromises();
    expect(groups.entries.value[0]).toMatchObject({
      count: 3,
      countLabel: "记录数",
    });
    expect(groups.progress("borrower:a")).toEqual({ loaded: 1, total: 3 });
    await groups.loadMore("borrower:a");
    await flushPromises();
    expect(groups.progress("borrower:a")).toEqual({ loaded: 3, total: 3 });
    expect(groups.entries.value[0]).toMatchObject({
      count: 3,
      countLabel: "记录数",
    });
    expect(
      groups.entries.value
        .filter((entry) => entry.kind === "record")
        .map((entry) => (entry.kind === "record" ? entry.value.document : "")),
    ).toEqual(["STE-1", "STE-2"]);
  });
  it("loads roots first and requests child pages only after expanding a path and unit", async () => {
    const reference = createReferenceData();
    Object.assign(reference, { site: "groups.local", user: "viewer" });
    const calls: Array<{ method: string; args: Record<string, unknown> }> = [];
    let permissionRevoked = false;
    const services = {
      call: vi.fn(async (method: string, args: Record<string, unknown>) => {
        calls.push({ method, args });
        const path = args.parent_path as string[];
        const page: GroupPage = permissionRevoked
          ? {
              rows: [],
              matched_count: 0,
              next_start: null,
              parent_path: path,
              parent_unit: (args.parent_unit as string | null) || null,
              row_grain: "group",
              query: args.query as GroupPage["query"],
            }
          : path.length
            ? {
                rows: [
                  {
                    id: Number(args.start) ? "item:b:each" : "item:a:each",
                    row_grain: "group",
                    group_path: ["A", Number(args.start) ? "Pencil" : "Paper"],
                    group_depth: 2,
                    group_label: Number(args.start) ? "Pencil" : "Paper",
                    parent_group_id: "category:a",
                    has_children: true,
                    stock_uom: "each",
                    row_count: 1,
                  },
                ],
                matched_count: 1,
                next_start: Number(args.start) ? null : 30,
                parent_path: path,
                parent_unit: "each",
                row_grain: "group",
                query: args.query as GroupPage["query"],
              }
            : {
                rows: [
                  {
                    id: "category:a",
                    row_grain: "group",
                    group_path: ["A"],
                    group_depth: 1,
                    group_label: "A",
                    has_children: true,
                    stock_uom: "each",
                    row_count: 1,
                  },
                ],
                matched_count: 1,
                next_start: null,
                parent_path: [],
                parent_unit: null,
                row_grain: "group",
                query: args.query as GroupPage["query"],
                leaf_columns: ["document", "date", "whole"],
              };
        return page;
      }),
      report: vi.fn(),
      upload: vi.fn(),
    };
    let groups!: ReturnType<typeof useReportGroups>;
    const query = ref(newReportQuery("inventory"));
    query.value.groupBy = ["category", "item"];
    const consumer = defineComponent({
      setup() {
        groups = useReportGroups(query, services);
        return () =>
          h(
            "button",
            { onClick: () => groups.toggleGroup("category:a") },
            "open",
          );
      },
    });
    const wrapper = mount(
      defineComponent({
        setup() {
          provideInventoryServices(services, reference);
          return () => h(consumer);
        },
      }),
    );
    wrappers.push(wrapper);
    await flushPromises();
    expect(calls).toHaveLength(1);
    expect(groups.leafColumns.value).toEqual(["document", "date", "whole"]);
    expect(calls[0]?.args).toMatchObject({
      parent_path: [],
      parent_unit: null,
      start: 0,
    });
    expect(groups.entries.value.map((entry) => entry.id)).toEqual([
      "category:a",
    ]);

    await wrapper.get("button").trigger("click");
    await nextTick();
    await flushPromises();
    expect(calls).toHaveLength(2);
    expect(calls[1]?.args).toMatchObject({
      parent_path: ["A"],
      parent_unit: "each",
      start: 0,
      page_length: 30,
    });
    expect(groups.hasMore("category:a")).toBe(true);
    await groups.loadMore("category:a");
    await flushPromises();
    expect(calls[2]?.args).toMatchObject({
      parent_path: ["A"],
      parent_unit: "each",
      start: 30,
    });
    expect(groups.entries.value.map((entry) => entry.id)).toEqual([
      "category:a",
      "item:a:each",
      "item:b:each",
    ]);

    await groups.toggleGroup("category:a");
    await groups.toggleGroup("category:a");
    expect(calls).toHaveLength(3);
    expect(groups.entries.value.map((entry) => entry.id)).toEqual([
      "category:a",
      "item:a:each",
      "item:b:each",
    ]);

    query.value.groupBy = ["category"];
    await nextTick();
    await flushPromises();
    expect(calls).toHaveLength(4);
    query.value.groupBy = ["category", "item"];
    await nextTick();
    await flushPromises();
    expect(calls).toHaveLength(7);
    expect(groups.entries.value.map((entry) => entry.id)).toEqual([
      "category:a",
      "item:a:each",
      "item:b:each",
    ]);

    permissionRevoked = true;
    query.value.groupBy = ["category"];
    await nextTick();
    await flushPromises();
    expect(calls).toHaveLength(8);
    expect(calls[7]?.args).toMatchObject({ parent_path: [], start: 0 });
    expect(groups.entries.value).toEqual([]);

    reference.user = "another-viewer";
    await nextTick();
    await flushPromises();
    expect(calls).toHaveLength(9);
    expect(groups.entries.value).toEqual([]);
  });
});
