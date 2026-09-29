import { fn } from "storybook/test";
import type { Meta, StoryObj } from "@storybook/vue3-vite";

import InventoryCardGrid from "./InventoryCardGrid.vue";

const rows = [
  {
    item_code: "ITM-000161",
    item_name: "鼻吸棒 SIGNAL Natural Inhaler",
    item_group: "个人用品",
    image: null,
    available_stock: 10081,
    total_stock: 10081,
    on_loan_qty: 0,
    damaged_qty: 0,
    stock_uom: "Nos",
  },
  {
    item_code: "ITM-000162",
    item_name: "柯达相机 KODAK camera 35mm",
    item_group: "电子用品",
    image: null,
    available_stock: 5,
    total_stock: 5,
    on_loan_qty: 0,
    damaged_qty: 0,
    stock_uom: "Nos",
  },
  {
    item_code: "ITM-000163",
    item_name: "饼干烤盘 COOKIE EXCHANGE",
    item_group: "厨房用品",
    image: null,
    available_stock: 20,
    total_stock: 24,
    on_loan_qty: 3,
    damaged_qty: 1,
    stock_uom: "Nos",
  },
];

const meta = {
  title: "Inventory/Inventory Card Grid",
  component: InventoryCardGrid,
  args: {
    rows,
    onActivate: fn(),
    onToggle: fn(),
  },
} satisfies Meta<typeof InventoryCardGrid>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const CompactMobile: Story = {
  args: { compactMobile: true },
  globals: { viewport: { value: "mobile", isRotated: false } },
};

export const Loading: Story = {
  args: { rows: [], loading: true },
};

export const LoadingMore: Story = {
  args: { loadingMore: true },
};

export const Empty: Story = {
  args: { rows: [] },
};

export const Error: Story = {
  args: { rows: [], error: "库存数据暂时无法加载，请重试。" },
};

export const SelectionMode: Story = {
  args: { selectionMode: true, selectedKeys: ["ITM-000163"] },
};
