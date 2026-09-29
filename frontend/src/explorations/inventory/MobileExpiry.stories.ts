import type { Meta, StoryObj } from "@storybook/vue3-vite";
import { expect } from "storybook/test";
import MobileInventoryRedesign from "./MobileInventoryRedesign.vue";

const meta = {
  title: "Explorations/Inventory Redesign/Mobile Expiry",
  component: MobileInventoryRedesign,
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component:
          "Storybook-only batch-level expiry exploration. Every result represents one batch, even when several rows belong to the same Item.",
      },
    },
  },
  args: {
    initialPage: "expiry",
    initialView: "list",
    initialSummaryKey: "",
    initialExpiryCategory: "all",
    initialActiveFilters: false,
    initiallyScrolled: false,
  },
  globals: { viewport: { value: "mobile", isRotated: false } },
} satisfies Meta<typeof MobileInventoryRedesign>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ canvas, step }) => {
    await step("One Item renders as three independent batch rows", async () => {
      const rows = canvas.getByRole("list", { name: "效期批次列表" });
      await expect(
        rows.querySelector('[data-batch="ITM-000161-A"]'),
      ).not.toBeNull();
      await expect(
        rows.querySelector('[data-batch="ITM-000161-B"]'),
      ).not.toBeNull();
      await expect(
        rows.querySelector('[data-batch="ITM-000161-C"]'),
      ).not.toBeNull();
      await expect(canvas.getAllByText("鼻吸棒 SIGNAL")).toHaveLength(3);
    });
    await step("Search, scan, and filter share the browse row", async () => {
      const tools = canvas.getByLabelText("浏览工具");
      await expect(tools).toContainElement(
        canvas.getByRole("searchbox", { name: "搜索物品或批次号" }),
      );
      await expect(tools).toContainElement(
        canvas.getByRole("button", { name: "扫码" }),
      );
    });
  },
};

export const ExpiringSoon: Story = {
  args: { initialExpiryCategory: "soon" },
  play: async ({ canvas }) => {
    await expect(
      canvas.getByRole("button", { name: /即将到期/, pressed: true }),
    ).toBeVisible();
    await expect(canvas.getAllByText(/剩余 13 天/).length).toBeGreaterThan(0);
    await expect(canvas.queryByText(/已过期 9 天/)).not.toBeInTheDocument();
  },
};

export const Expired: Story = {
  args: { initialExpiryCategory: "expired" },
  play: async ({ canvas }) => {
    await expect(
      canvas.getByRole("button", { name: /已过期/, pressed: true }),
    ).toBeVisible();
    await expect(canvas.getAllByText(/已过期/).length).toBeGreaterThan(1);
    await expect(canvas.queryByText(/剩余 13 天/)).not.toBeInTheDocument();
  },
};

export const ActiveFilters: Story = {
  args: { initialActiveFilters: true },
  play: async ({ canvas }) => {
    await expect(canvas.getByLabelText("已选筛选条件")).toBeVisible();
    await expect(
      canvas.getByRole("button", { name: "筛选，3 项已启用" }),
    ).toBeVisible();
    await expect(
      canvas.queryByRole("button", { name: "清除全部" }),
    ).not.toBeInTheDocument();
  },
};

export const SummaryExpanded: Story = {
  args: { initialSummaryKey: "soon" },
  play: async ({ canvas }) => {
    await expect(canvas.getByText("即将到期数量明细")).toBeVisible();
    await expect(canvas.getByText("7 天内")).toBeVisible();
    await expect(canvas.getByText("8–30 天内")).toBeVisible();
  },
};

export const ScrolledList: Story = {
  args: { initiallyScrolled: true },
  play: async ({ canvas }) => {
    await expect(
      canvas.getByRole("list", { name: "效期批次列表" }),
    ).toBeVisible();
    await expect(
      canvas.queryByLabelText("筛选结果汇总"),
    ).not.toBeInTheDocument();
    await expect(
      canvas.queryByRole("group", { name: "效期状态" }),
    ).not.toBeInTheDocument();
  },
};
