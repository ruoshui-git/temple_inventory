// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { mount, type VueWrapper } from "@vue/test-utils";
import { h } from "vue";
import CardFields from "../src/components/ui/CardFields.vue";
import DataCell from "../src/components/ui/DataCell.vue";
import type { DataColumn } from "../src/lib/dataTable";

const wrappers: VueWrapper[] = [];
afterEach(() => wrappers.splice(0).forEach((wrapper) => wrapper.unmount()));

const fields: DataColumn[] = [
  { id: "branch", label: "仓库" },
  { id: "serial", label: "序列号", kind: "chip" },
  { id: "expiry_date", label: "效期" },
];
const row = {
  branch: "主库",
  serial: "SN-1, SN-2",
  expiry_date: "",
};

describe("CardFields", () => {
  it("renders label/value pairs in a definition list", () => {
    const wrapper = mount(CardFields, { props: { fields, row } });
    wrappers.push(wrapper);
    const items = wrapper.findAll(".card-field");
    expect(items).toHaveLength(3);
    expect(items[0]!.get("dt").text()).toBe("仓库");
    expect(items[0]!.get("dd").text()).toBe("主库");
    expect(items[0]!.get("dd").attributes("title")).toBe("主库");
  });

  it("spans both columns for chip fields only", () => {
    const wrapper = mount(CardFields, { props: { fields, row } });
    wrappers.push(wrapper);
    const items = wrapper.findAll(".card-field");
    expect(items[0]!.classes()).not.toContain("is-wide");
    expect(items[1]!.classes()).toContain("is-wide");
  });

  it("shows an em dash for empty values but keeps zero and false", () => {
    const wrapper = mount(CardFields, {
      props: {
        fields: [
          { id: "a", label: "空" },
          { id: "b", label: "零" },
          { id: "c", label: "否" },
        ],
        row: { a: null, b: 0, c: false },
      },
    });
    wrappers.push(wrapper);
    const values = wrapper.findAll("dd").map((dd) => dd.text());
    expect(values).toEqual(["—", "0", "false"]);
  });

  it("renders the overflow count after the card fields", () => {
    const wrapper = mount(CardFields, { props: { fields, row, overflow: 4 } });
    wrappers.push(wrapper);
    expect(wrapper.get(".card-fields-more").text()).toBe("+4 项");
  });

  it("renders inline label/value pairs in the row variant", () => {
    const wrapper = mount(CardFields, {
      props: { fields, row, variant: "row", overflow: 2 },
    });
    wrappers.push(wrapper);
    expect(wrapper.find("dl").exists()).toBe(false);
    const inline = wrapper.get(".card-fields-inline");
    const spans = inline.findAll(".card-field-inline");
    expect(spans[0]!.get(".card-field-label").text()).toBe("仓库");
    expect(spans[0]!.text()).toContain("主库");
    expect(spans[2]!.text()).toContain("—");
    expect(wrapper.text()).toContain("+2 项");
  });

  it("uses a slot override for each cell", () => {
    const wrapper = mount(CardFields, {
      props: { fields: [fields[0]!], row },
      slots: {
        cell: ({ value }: { value: unknown }) =>
          h("strong", `custom:${String(value)}`),
      },
    });
    wrappers.push(wrapper);
    expect(wrapper.get("dd strong").text()).toBe("custom:主库");
  });

  it("renders nothing without fields or overflow", () => {
    const wrapper = mount(CardFields, { props: { fields: [], row } });
    wrappers.push(wrapper);
    expect(wrapper.find(".card-fields").exists()).toBe(false);
    expect(wrapper.find(".card-fields-more").exists()).toBe(false);
    expect(wrapper.find("dl, p").exists()).toBe(false);
  });
});

describe("DataCell", () => {
  it("keeps empty values blank unless an empty text is given", () => {
    const blank = mount(DataCell, {
      props: { column: { id: "note", label: "备注" }, value: null },
    });
    wrappers.push(blank);
    expect(blank.text()).toBe("");
    const dashed = mount(DataCell, {
      props: {
        column: { id: "note", label: "备注" },
        value: "",
        emptyText: "—",
      },
    });
    wrappers.push(dashed);
    expect(dashed.text()).toBe("—");
  });
});
