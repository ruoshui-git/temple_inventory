import { fn } from "storybook/test";
import type { Meta, StoryObj } from "@storybook/vue3-vite";

import ActiveFilterChips from "./ActiveFilterChips.vue";
import type { FilterChip } from "./ActiveFilterChips.vue";

const fewFilters: FilterChip[] = [
  { key: "warehouse", label: "仓库：大殿" },
  { key: "group", label: "分类：个人用品" },
  { key: "available", label: "有可用库存" },
];

const manyFilters: FilterChip[] = [
  ...fewFilters,
  { key: "expiry", label: "即将到期" },
  { key: "brand", label: "品牌：Signal" },
  { key: "uom", label: "单位：Nos" },
  { key: "loan", label: "包含借出" },
  { key: "damaged", label: "包含损坏" },
  { key: "room", label: "位置：一号库房" },
];

const meta = {
  title: "Inventory/Active Filter Chips",
  component: ActiveFilterChips,
  args: {
    chips: fewFilters,
    onRemove: fn(),
    onClear: fn(),
  },
} satisfies Meta<typeof ActiveFilterChips>;

export default meta;
type Story = StoryObj<typeof meta>;

export const FewFilters: Story = {};

export const WithoutPageClear: Story = {
  args: { showClear: false },
};

export const ManyFilters: Story = {
  args: { chips: manyFilters },
};

export const SingleFilter: Story = {
  args: { chips: [fewFilters[0]] },
};
