import { fn } from "storybook/test";
import type { Meta, StoryObj } from "@storybook/vue3-vite";
import { computed, ref } from "vue";

import ActiveFilterChips, { type FilterChip } from "./ActiveFilterChips.vue";
import CategorySelector from "./CategorySelector.vue";
import InventoryCardGrid from "./InventoryCardGrid.vue";
import QuantitySummary, { type QuantityMetric } from "./QuantitySummary.vue";
import ResponsiveFilterPanel from "./ResponsiveFilterPanel.vue";
import WarehouseSelector from "./WarehouseSelector.vue";
import type { WarehouseRecord } from "../lib/warehousePresenter";

type InventoryFixtureRow = {
  item_code: string;
  item_name: string;
  item_group: string;
  image: string | null;
  available_stock: number;
  total_stock: number;
  on_loan_qty: number;
  damaged_qty: number;
  stock_uom: string;
};

type CompositionArgs = {
  rows: InventoryFixtureRow[];
  metrics: QuantityMetric[];
  chips: FilterChip[];
  warehouses: string[];
  itemGroups: string[];
  search: string;
  total: number;
  overall: number;
  loading: boolean;
  error: string;
  selectionMode: boolean;
  selectedKeys: string[];
};

const warehouseRows: WarehouseRecord[] = [
  {
    name: "寺院物资",
    warehouse_name: "寺院物资",
    local_label: "寺院物资",
    semantic_type: "group",
    is_group: 1,
    lft: 1,
    rgt: 12,
  },
  {
    name: "大殿",
    warehouse_name: "大殿",
    local_label: "大殿",
    parent_warehouse: "寺院物资",
    semantic_type: "room",
    is_group: 1,
    lft: 2,
    rgt: 7,
  },
  {
    name: "大殿储物架",
    warehouse_name: "大殿储物架",
    local_label: "储物架",
    parent_warehouse: "大殿",
    semantic_type: "location",
    is_group: 0,
    lft: 3,
    rgt: 3,
  },
  {
    name: "大殿侧柜",
    warehouse_name: "大殿侧柜",
    local_label: "侧柜",
    parent_warehouse: "大殿",
    semantic_type: "location",
    is_group: 0,
    lft: 4,
    rgt: 4,
  },
  {
    name: "厨房",
    warehouse_name: "厨房",
    local_label: "厨房",
    parent_warehouse: "寺院物资",
    semantic_type: "room",
    is_group: 1,
    lft: 8,
    rgt: 11,
  },
  {
    name: "厨房储物架",
    warehouse_name: "厨房储物架",
    local_label: "储物架",
    parent_warehouse: "厨房",
    semantic_type: "location",
    is_group: 0,
    lft: 9,
    rgt: 9,
  },
  {
    name: "厨房冷藏柜",
    warehouse_name: "厨房冷藏柜",
    local_label: "冷藏柜",
    parent_warehouse: "厨房",
    semantic_type: "location",
    is_group: 0,
    lft: 10,
    rgt: 10,
  },
];

const categoryRows = [
  {
    name: "All Item Groups",
    item_group_name: "All Item Groups",
    is_group: 1,
    lft: 1,
    rgt: 12,
  },
  {
    name: "个人用品",
    item_group_name: "个人用品",
    parent_item_group: "All Item Groups",
    is_group: 0,
    lft: 2,
    rgt: 2,
  },
  {
    name: "电子用品",
    item_group_name: "电子用品",
    parent_item_group: "All Item Groups",
    is_group: 0,
    lft: 3,
    rgt: 3,
  },
  {
    name: "厨房用品",
    item_group_name: "厨房用品",
    parent_item_group: "All Item Groups",
    is_group: 0,
    lft: 4,
    rgt: 4,
  },
  {
    name: "清洁用品",
    item_group_name: "清洁用品",
    parent_item_group: "All Item Groups",
    is_group: 0,
    lft: 5,
    rgt: 5,
  },
  {
    name: "活动用品",
    item_group_name: "活动用品",
    parent_item_group: "All Item Groups",
    is_group: 0,
    lft: 6,
    rgt: 6,
  },
];

const warehouseCounts = {
  寺院物资: 24,
  大殿: 14,
  大殿储物架: 9,
  大殿侧柜: 5,
  厨房: 10,
  厨房储物架: 7,
  厨房冷藏柜: 3,
};

const categoryCounts = {
  个人用品: 18,
  电子用品: 4,
  厨房用品: 9,
  清洁用品: 6,
  活动用品: 3,
};

const baseRows: InventoryFixtureRow[] = [
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

const denseRows: InventoryFixtureRow[] = [
  ...baseRows,
  {
    item_code: "ITM-000164",
    item_name: "大型法会折叠桌（带防水桌布）",
    item_group: "活动用品",
    image: null,
    available_stock: 18,
    total_stock: 20,
    on_loan_qty: 2,
    damaged_qty: 0,
    stock_uom: "Nos",
  },
  {
    item_code: "ITM-000165",
    item_name: "不锈钢保温桶 40L",
    item_group: "厨房用品",
    image: null,
    available_stock: 8,
    total_stock: 10,
    on_loan_qty: 1,
    damaged_qty: 1,
    stock_uom: "Nos",
  },
  {
    item_code: "ITM-000166",
    item_name: "厨房一次性餐盒（可堆叠款）",
    item_group: "厨房用品",
    image: null,
    available_stock: 35,
    total_stock: 42,
    on_loan_qty: 0,
    damaged_qty: 7,
    stock_uom: "箱",
  },
  {
    item_code: "ITM-000167",
    item_name: "手持式扩音器 Portable Megaphone",
    item_group: "电子用品",
    image: null,
    available_stock: 3,
    total_stock: 4,
    on_loan_qty: 1,
    damaged_qty: 0,
    stock_uom: "Nos",
  },
  {
    item_code: "ITM-000168",
    item_name: "天然竹制扫帚与簸箕套装",
    item_group: "清洁用品",
    image: null,
    available_stock: 12,
    total_stock: 12,
    on_loan_qty: 0,
    damaged_qty: 0,
    stock_uom: "套",
  },
  {
    item_code: "ITM-000169",
    item_name: "活动签到台立牌与号码牌",
    item_group: "活动用品",
    image: null,
    available_stock: 26,
    total_stock: 30,
    on_loan_qty: 4,
    damaged_qty: 0,
    stock_uom: "Nos",
  },
  {
    item_code: "ITM-000170",
    item_name: "香客休息区折叠椅",
    item_group: "活动用品",
    image: null,
    available_stock: 46,
    total_stock: 50,
    on_loan_qty: 4,
    damaged_qty: 0,
    stock_uom: "Nos",
  },
  {
    item_code: "ITM-000171",
    item_name: "备用照明电池 AA 充电电池组",
    item_group: "电子用品",
    image: null,
    available_stock: 6,
    total_stock: 8,
    on_loan_qty: 2,
    damaged_qty: 0,
    stock_uom: "组",
  },
  {
    item_code: "ITM-000172",
    item_name: "志愿者工作围裙（深棕色，均码）",
    item_group: "个人用品",
    image: null,
    available_stock: 28,
    total_stock: 32,
    on_loan_qty: 3,
    damaged_qty: 1,
    stock_uom: "件",
  },
];

const defaultMetrics: QuantityMetric[] = [
  {
    key: "available_stock",
    label: "可用",
    quantities: [{ uom: "Nos", qty: 10106 }],
  },
  {
    key: "total_stock",
    label: "总计",
    quantities: [{ uom: "Nos", qty: 10110 }],
  },
  { key: "on_loan_qty", label: "借出", quantities: [{ uom: "Nos", qty: 3 }] },
  { key: "damaged_qty", label: "损坏", quantities: [{ uom: "Nos", qty: 1 }] },
];

const denseMetrics: QuantityMetric[] = [
  {
    key: "available_stock",
    label: "可用",
    quantities: [
      { uom: "Nos", qty: 10207 },
      { uom: "件", qty: 28 },
      { uom: "套", qty: 12 },
    ],
  },
  {
    key: "total_stock",
    label: "总计",
    quantities: [
      { uom: "Nos", qty: 10226 },
      { uom: "箱", qty: 42 },
      { uom: "件", qty: 32 },
    ],
  },
  { key: "on_loan_qty", label: "借出", quantities: [{ uom: "Nos", qty: 17 }] },
  {
    key: "damaged_qty",
    label: "损坏",
    quantities: [
      { uom: "Nos", qty: 9 },
      { uom: "箱", qty: 7 },
    ],
  },
];

const filteredChips: FilterChip[] = [
  { key: "warehouses", value: "大殿储物架", label: "仓库：大殿 / 储物架" },
  { key: "item_groups", value: "厨房用品", label: "分类：厨房用品" },
  { key: "search", label: "搜索：烤盘" },
];

const manyFilteredChips: FilterChip[] = [
  ...filteredChips,
  { key: "available", label: "有可用库存" },
  { key: "uom", label: "单位：Nos" },
  { key: "loan", label: "包含借出" },
  { key: "damaged", label: "包含损坏" },
];

const zeroMetrics = defaultMetrics.map((metric) => ({
  ...metric,
  quantities: [],
}));

const renderComposition = (args: CompositionArgs) => ({
  components: {
    ActiveFilterChips,
    CategorySelector,
    InventoryCardGrid,
    QuantitySummary,
    ResponsiveFilterPanel,
    WarehouseSelector,
  },
  setup() {
    const filterOpen = ref(false);
    const warehouseSelection = ref([...args.warehouses]);
    const itemGroupSelection = ref([...args.itemGroups]);
    const activeChips = ref([...args.chips]);
    const selected = ref([...args.selectedKeys]);
    const selectionMode = ref(args.selectionMode);
    const search = ref(args.search);
    const sortBy = ref("item_name");
    const sortOrder = ref<"asc" | "desc">("asc");
    const view = ref("card");

    const selectedCount = computed(() => selected.value.length);
    const activateSpy = fn();
    const toggleSpy = fn();
    const removeChipSpy = fn();
    const clearChipsSpy = fn();
    const retrySpy = fn();

    function toggleRow(row: InventoryFixtureRow) {
      toggleSpy(row);
      selected.value = selected.value.includes(row.item_code)
        ? selected.value.filter((value) => value !== row.item_code)
        : [...selected.value, row.item_code];
    }

    function activateRow(row: InventoryFixtureRow) {
      activateSpy(row);
    }

    function removeChip(chip: FilterChip) {
      removeChipSpy(chip);
      activeChips.value = activeChips.value.filter((item) => item !== chip);
      if (chip.key === "warehouses")
        warehouseSelection.value = warehouseSelection.value.filter(
          (value) => value !== chip.value,
        );
      if (chip.key === "item_groups")
        itemGroupSelection.value = itemGroupSelection.value.filter(
          (value) => value !== chip.value,
        );
      if (chip.key === "search") search.value = "";
    }

    function clearChips() {
      clearChipsSpy();
      activeChips.value = [];
      warehouseSelection.value = [];
      itemGroupSelection.value = [];
      search.value = "";
    }

    function toggleSelectionMode() {
      selectionMode.value = !selectionMode.value;
      if (!selectionMode.value) selected.value = [];
    }

    function toggleSortOrder() {
      sortOrder.value = sortOrder.value === "asc" ? "desc" : "asc";
    }

    return {
      activeChips,
      args,
      categoryCounts,
      categoryRows,
      clearChips,
      filterOpen,
      itemGroupSelection,
      removeChip,
      retrySpy,
      search,
      selected,
      selectedCount,
      selectionMode,
      sortBy,
      sortOrder,
      toggleRow,
      toggleSelectionMode,
      toggleSortOrder,
      activateRow,
      view,
      warehouseCounts,
      warehouseRows,
      warehouseSelection,
    };
  },
  template: `
		<div class="application-shell inventory-composition">
			<header class="desktop-nav">
				<div class="shell-brand-slot">
					<h1 class="shell-brand">库存</h1>
				</div>
				<nav aria-label="主导航">
					<a aria-current="page" href="#" @click.prevent>库存</a>
					<a href="#" @click.prevent>货物流动</a>
					<a href="#" @click.prevent>盘点调整</a>
					<a href="#" @click.prevent>借用</a>
					<a href="#" @click.prevent>仓库</a>
					<a href="#" @click.prevent>更多</a>
				</nav>
				<nav class="desktop-inventory-context" aria-label="当前视图">
					<a aria-current="page" href="#" @click.prevent>库存列表</a>
					<a href="#" @click.prevent>效期批次</a>
				</nav>
				<div class="shell-actions">
					<span class="pending-notice">待处理 <b>3</b></span>
					<button type="button">退出登录</button>
				</div>
			</header>

			<main class="shell-content">
				<section class="inventory-destination wide-shell viewport-list-root">
					<div class="list-layout desktop-list-layout">
						<ResponsiveFilterPanel v-model:open="filterOpen">
							<WarehouseSelector
								v-model="warehouseSelection"
								:rows="warehouseRows"
								:counts="warehouseCounts"
							/>
							<CategorySelector
								v-model="itemGroupSelection"
								:rows="categoryRows"
								:counts="categoryCounts"
							/>
						</ResponsiveFilterPanel>

						<div class="results-column">
							<div class="results-chrome">
								<div class="result-toolbar">
									<input
										v-model="search"
										type="search"
										placeholder="搜索物品或条码"
										aria-label="搜索物品或条码"
									/>
									<button
										type="button"
										class="mobile-filter-button"
										@click="filterOpen = true"
									>
										筛选
									</button>
									<button type="button" @click="toggleSelectionMode">
										{{ selectionMode ? "完成选择" : "选择物品" }}
									</button>
									<button type="button">导出</button>
									<span aria-live="polite">
										已加载 {{ args.rows.length }} · 筛选结果 {{ args.total }} · 全部
										{{ args.overall }}
									</span>
								</div>
								<ActiveFilterChips
									:chips="activeChips"
									@remove="removeChip"
									@clear="clearChips"
								/>
								<div class="inventory-modes" role="group" aria-label="库存显示方式">
									<button
										type="button"
										class="active"
										:aria-pressed="view === 'card'"
									>
										卡片
									</button>
									<button type="button" :aria-pressed="view === 'table'">表格</button>
									<label>
										排序
										<select v-model="sortBy">
											<option value="item_name">物品名称</option>
											<option value="available_stock">可用</option>
											<option value="total_stock">总计</option>
										</select>
									</label>
									<button type="button" @click="toggleSortOrder">
										{{ sortOrder === "asc" ? "升序 ↑" : "降序 ↓" }}
									</button>
								</div>
								<QuantitySummary :metrics="args.metrics" :loading="args.loading" />
							</div>

							<div class="results-scroll">
								<div class="inventory-results">
									<InventoryCardGrid
										:rows="args.rows"
										:loading="args.loading"
										:error="args.error"
										:selection-mode="selectionMode"
										:selected-keys="selected"
										@activate="activateRow"
										@toggle="toggleRow"
									>
										<template #error>
											{{ args.error }}
											<button type="button" @click="retrySpy">重试</button>
										</template>
									</InventoryCardGrid>
								</div>
							</div>
						</div>
					</div>
					<div
						v-if="selectionMode && selectedCount"
						class="context-action-bar"
						role="toolbar"
						aria-label="已选物品操作"
					>
						<span>已选 {{ selectedCount }} 项</span>
						<button type="button">入库</button>
						<button type="button">出库</button>
						<button type="button">转移</button>
					</div>
				</section>
			</main>

			<nav class="mobile-context-nav" aria-label="当前视图">
				<a aria-current="page" href="#" @click.prevent>库存列表</a>
				<a href="#" @click.prevent>效期批次</a>
			</nav>
			<nav class="mobile-nav" aria-label="主导航">
				<a aria-current="page" href="#" @click.prevent><span>库存</span></a>
				<a href="#" @click.prevent><span>流动</span></a>
				<a href="#" @click.prevent><span>调整</span></a>
				<a href="#" @click.prevent><span>借用</span></a>
				<a href="#" @click.prevent><span>仓库</span></a>
				<a href="#" @click.prevent><span>更多</span></a>
			</nav>
		</div>
	`,
});

const meta = {
  title: "Inventory/Inventory Composition",
  parameters: { layout: "fullscreen" },
  render: renderComposition,
  args: {
    rows: baseRows,
    metrics: defaultMetrics,
    chips: [],
    warehouses: [],
    itemGroups: [],
    search: "",
    total: 25,
    overall: 25,
    loading: false,
    error: "",
    selectionMode: false,
    selectedKeys: [],
  },
} satisfies Meta<CompositionArgs>;

export default meta;
type Story = StoryObj<typeof meta>;

export const DesktopDefault: Story = {
  name: "Desktop Default",
  parameters: { viewport: { defaultViewport: "desktop" } },
};

export const DesktopDense: Story = {
  name: "Desktop Dense",
  parameters: { viewport: { defaultViewport: "desktop" } },
  args: {
    rows: denseRows,
    metrics: denseMetrics,
    total: 42,
    overall: 42,
  },
};

export const Mobile: Story = {
  name: "Mobile",
  parameters: { viewport: { defaultViewport: "mobile" } },
};

export const Filtered: Story = {
  name: "Filtered",
  parameters: { viewport: { defaultViewport: "desktop" } },
  args: {
    rows: [baseRows[2]],
    metrics: [
      {
        key: "available_stock",
        label: "可用",
        quantities: [{ uom: "Nos", qty: 20 }],
      },
      {
        key: "total_stock",
        label: "总计",
        quantities: [{ uom: "Nos", qty: 24 }],
      },
      {
        key: "on_loan_qty",
        label: "借出",
        quantities: [{ uom: "Nos", qty: 3 }],
      },
      {
        key: "damaged_qty",
        label: "损坏",
        quantities: [{ uom: "Nos", qty: 1 }],
      },
    ],
    chips: manyFilteredChips,
    warehouses: ["大殿储物架"],
    itemGroups: ["厨房用品"],
    search: "烤盘",
    total: 1,
    overall: 1,
  },
};

export const SelectionMode: Story = {
  name: "Selection Mode",
  parameters: { viewport: { defaultViewport: "desktop" } },
  args: {
    selectionMode: true,
    selectedKeys: ["ITM-000163"],
  },
};

export const Loading: Story = {
  name: "Loading",
  parameters: { viewport: { defaultViewport: "desktop" } },
  args: {
    rows: [],
    loading: true,
  },
};

export const Empty: Story = {
  name: "Empty",
  parameters: { viewport: { defaultViewport: "desktop" } },
  args: {
    rows: [],
    metrics: zeroMetrics,
    total: 0,
    overall: 0,
  },
};

export const Error: Story = {
  name: "Error",
  parameters: { viewport: { defaultViewport: "desktop" } },
  args: {
    rows: [],
    metrics: zeroMetrics,
    total: 0,
    overall: 0,
    error: "库存数据暂时无法加载，请重试。",
  },
};
