import type { Meta, StoryObj } from "@storybook/vue3-vite";

import QuantitySummary from "./QuantitySummary.vue";
import type { QuantityMetric } from "./QuantitySummary.vue";

const defaultMetrics: QuantityMetric[] = [
  {
    key: "available_stock",
    label: "可用",
    quantities: [{ uom: "Nos", qty: 10081 }],
  },
  {
    key: "total_stock",
    label: "总计",
    quantities: [{ uom: "Nos", qty: 10500 }],
  },
  {
    key: "on_loan_qty",
    label: "借出",
    quantities: [{ uom: "Nos", qty: 12 }],
  },
  {
    key: "damaged_qty",
    label: "损坏",
    quantities: [{ uom: "Nos", qty: 3 }],
  },
];

const meta = {
  title: "Inventory/Quantity Summary",
  component: QuantitySummary,
  args: { metrics: defaultMetrics },
} satisfies Meta<typeof QuantitySummary>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const MultipleUOMs: Story = {
  args: {
    metrics: [
      {
        key: "available_stock",
        label: "可用",
        quantities: [
          { uom: "Nos", qty: 10081 },
          { uom: "箱", qty: 35 },
        ],
      },
      {
        key: "total_stock",
        label: "总计",
        quantities: [
          { uom: "Nos", qty: 10500 },
          { uom: "箱", qty: 37 },
        ],
      },
      {
        key: "on_loan_qty",
        label: "借出",
        quantities: [{ uom: "Nos", qty: 12 }],
      },
      {
        key: "damaged_qty",
        label: "损坏",
        quantities: [{ uom: "Nos", qty: 3 }],
      },
    ],
  },
};

export const Loading: Story = {
  args: { loading: true },
};

export const ZeroQuantities: Story = {
  args: {
    metrics: defaultMetrics.map((metric) => ({ ...metric, quantities: [] })),
  },
};

export const LargeNumbers: Story = {
  args: {
    metrics: defaultMetrics.map((metric) => ({
      ...metric,
      quantities: [{ uom: "Nos", qty: 9876543210.123456 }],
    })),
  },
};
