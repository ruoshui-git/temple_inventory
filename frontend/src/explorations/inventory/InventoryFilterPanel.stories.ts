import type { Meta, StoryObj } from "@storybook/vue3-vite";
import { expect, userEvent } from "storybook/test";
import { ref } from "vue";
import InventoryFilterPanel, {
  type InventoryFilterNode,
  type InventoryFilterState,
} from "../../components/InventoryFilterPanel.vue";
import { categories, items, warehouses } from "./fixtures";

type StoryArgs = {
  initial: InventoryFilterState;
  expiryPrimary: boolean;
};

const matchesWarehouse = (locations: string[], selected: string) =>
  locations.some((location) => {
    let node = warehouses.find((row) => row.name === location);
    while (node) {
      if (node.name === selected) return true;
      node = warehouses.find((row) => row.name === node?.parent_warehouse);
    }
    return false;
  });

const warehouseNodes: InventoryFilterNode[] = warehouses.map((node) => ({
  name: node.name,
  label: node.local_label || node.name,
  parent: node.parent_warehouse,
  isGroup: Boolean(node.is_group),
  count: items.filter((item) => matchesWarehouse(item.locations, node.name))
    .length,
}));
const categoryNodes: InventoryFilterNode[] = categories.map((node) => ({
  name: node.name,
  label: node.item_group_name,
  parent: node.parent_item_group,
  isGroup: Boolean(node.is_group),
  count: items.filter((item) => item.category === node.name).length,
}));

const render = (args: StoryArgs) => ({
  components: { InventoryFilterPanel },
  setup() {
    const filters = ref<InventoryFilterState>({
      ...args.initial,
      warehouses: [...args.initial.warehouses],
      categories: [...args.initial.categories],
    });
    return { args, categoryNodes, filters, warehouseNodes };
  },
  template: `
    <div style="box-sizing:border-box;width:280px;min-height:760px;padding:14px;background:#fbfaf7">
      <InventoryFilterPanel
        v-model="filters"
        :warehouses="warehouseNodes"
        :categories="categoryNodes"
        :expiry-primary="args.expiryPrimary"
      />
    </div>
  `,
});

const meta = {
  title: "Explorations/Inventory Filter Panel",
  render,
  parameters: { layout: "centered" },
  args: {
    initial: { warehouses: [], categories: [], inStock: true, expiry: "all" },
    expiryPrimary: false,
  },
} satisfies Meta<StoryArgs>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ canvas }) => {
    await expect(
      canvas.getByRole("searchbox", { name: "搜索仓库或位置" }),
    ).toBeVisible();
    await expect(
      canvas.queryByRole("searchbox", { name: "搜索物品类别" }),
    ).not.toBeInTheDocument();
    const stockCheckbox = canvas.getByRole("checkbox", { name: /有库存/ });
    await expect(stockCheckbox).toBeChecked();
    await expect(getComputedStyle(stockCheckbox).width).toBe("13px");
    await expect(getComputedStyle(stockCheckbox).height).toBe("13px");
    await expect(getComputedStyle(stockCheckbox).padding).toBe("0px");
  },
};

export const Expanded: Story = {
  play: async ({ canvas }) => {
    await userEvent.click(canvas.getByRole("button", { name: /物品类别/ }));
    await expect(
      canvas.getByRole("searchbox", { name: "搜索仓库或位置" }),
    ).toBeVisible();
    await expect(
      canvas.getByRole("searchbox", { name: "搜索物品类别" }),
    ).toBeVisible();
    const warehouseSearch = canvas.getByRole("searchbox", {
      name: "搜索仓库或位置",
    });
    await userEvent.type(warehouseSearch, "侧柜");
    await expect(canvas.getByRole("checkbox", { name: /侧柜/ })).toBeVisible();
    await userEvent.clear(warehouseSearch);
    const hall = canvas.getByRole("checkbox", { name: /大殿/ });
    const cabinet = canvas.getByRole("checkbox", { name: /侧柜/ });
    await userEvent.click(hall);
    await expect(hall).toBeChecked();
    await expect(cabinet).toBeChecked();
    await userEvent.click(cabinet);
    await expect(hall).toBePartiallyChecked();
  },
};

export const Selected: Story = {
  args: {
    initial: {
      warehouses: ["hall"],
      categories: ["厨房用品"],
      inStock: true,
      expiry: "remaining_within",
      expiryDays: "90",
    },
  },
  play: async ({ canvas }) => {
    const clearButtons = canvas.getAllByRole("button", { name: "清除" });
    await expect(clearButtons).toHaveLength(2);
    await userEvent.click(clearButtons[0]);
    await expect(
      canvas.queryAllByRole("button", { name: "清除" }),
    ).toHaveLength(1);
    await userEvent.click(canvas.getByRole("button", { name: "清除" }));
    await expect(
      canvas.queryByRole("button", { name: "清除" }),
    ).not.toBeInTheDocument();
  },
};

export const MoreConditions: Story = {
  play: async ({ canvas }) => {
    await userEvent.click(canvas.getByRole("button", { name: /更多条件/ }));
    await userEvent.click(
      canvas.getByRole("radio", { name: /还剩 30 天以下/ }),
    );
    await expect(
      canvas.getByRole("radio", { name: /还剩 30 天以下/ }),
    ).toBeChecked();
  },
};

export const ExpiryPrimary: Story = {
  args: {
    initial: {
      warehouses: [],
      categories: [],
      inStock: true,
      expiry: "overdue_within",
    },
    expiryPrimary: true,
  },
};

export const MobileContent: Story = {
  name: "Mobile Content",
  parameters: { viewport: { defaultViewport: "mobile" } },
};
