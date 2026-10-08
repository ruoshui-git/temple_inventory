import type { Meta, StoryObj } from "@storybook/vue3-vite";
import MovementRedesign from "./MovementRedesign.vue";

const meta = {
  title: "Explorations/Movement Redesign",
  component: MovementRedesign,
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component:
          "Storybook-only static movement ledger states. Production Frappe data access remains in Movements.vue.",
      },
    },
  },
  args: {
    mode: "items",
    initiallyScrolled: false,
    initialFilterOpen: true,
    initialMoreOpen: false,
  },
} satisfies Meta<typeof MovementRedesign>;
export default meta;
type Story = StoryObj<typeof meta>;
export const DesktopItems: Story = { name: "Desktop · 明细" };
export const DesktopItemsFiltersCollapsed: Story = {
  name: "Desktop · 明细 · filters collapsed",
  args: { initialFilterOpen: false },
};
export const DesktopRecordsCompact: Story = {
  name: "Desktop · 记录 · compact",
  args: { mode: "records", initiallyScrolled: true },
};
export const DesktopItemsMoreOpen: Story = {
  name: "Desktop · 明细 · More open",
  args: { initialMoreOpen: true },
};
