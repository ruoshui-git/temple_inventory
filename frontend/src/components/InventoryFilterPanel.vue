<script setup lang="ts">
import { computed, ref } from "vue";
import InventoryIcon from "./InventoryIcon.vue";
import CompactFilterSection from "./CompactFilterSection.vue";
import WarehouseSelector from "./WarehouseSelector.vue";
import CategorySelector from "./CategorySelector.vue";

export type ExpiryFilter =
	| "all"
	| "overdue"
	| "overdue_within"
	| "overdue_beyond"
	| "remaining_within"
	| "remaining_beyond"
	| "none"
	| "custom";
export type InventoryFilterState = {
	warehouses: string[];
	categories: string[];
	inStock: boolean;
	expiry: ExpiryFilter;
	expiryDays?: string;
	expiryFromDays?: string;
	expiryToDays?: string;
};
export type InventoryFilterNode = {
	name: string;
	label: string;
	parent?: string;
	isGroup?: boolean;
	count?: number;
};

const props = withDefaults(
	defineProps<{
		modelValue: InventoryFilterState;
		warehouses: InventoryFilterNode[];
		categories: InventoryFilterNode[];
		expiryPrimary?: boolean;
		expiryCounts?: Partial<Record<ExpiryFilter, number>>;
		customError?: string;
	}>(),
	{ expiryPrimary: false },
);
const emit = defineEmits<{ "update:modelValue": [value: InventoryFilterState] }>();
const instanceId = Math.random().toString(36).slice(2);

const selectorWarehouses = computed(() =>
	props.warehouses.map((node) => ({
		name: node.name,
		warehouse_name: node.label,
		parent_warehouse: node.parent,
		is_group: node.isGroup,
		lft: (node as any).lft,
		rgt: (node as any).rgt,
	})),
);
const selectorCategories = computed(() =>
	props.categories.map((node) => ({
		name: node.name,
		item_group_name: node.label,
		parent_item_group: node.parent,
		is_group: node.isGroup,
		lft: (node as any).lft,
		rgt: (node as any).rgt,
	})),
);
const selectorWarehouseCounts = computed(() =>
	Object.fromEntries(
		props.warehouses
			.filter((node) => node.count !== undefined)
			.map((node) => [node.name, node.count]),
	),
);
const selectorCategoryCounts = computed(() =>
	Object.fromEntries(
		props.categories
			.filter((node) => node.count !== undefined)
			.map((node) => [node.name, node.count]),
	),
);

const warehouseOpen = ref(true);
const categoryOpen = ref(false);
const moreOpen = ref(false);

const expiryOptions: Array<{ value: ExpiryFilter; label: string }> = [
	{ value: "all", label: "全部效期" },
	{ value: "overdue_within", label: "已过期天数以下" },
	{ value: "overdue_beyond", label: "已过期天数以上" },
	{ value: "remaining_within", label: "还剩天数以下" },
	{ value: "remaining_beyond", label: "还剩天数以上" },
	{ value: "none", label: "无效期" },
	{ value: "custom", label: "自定义" },
];

function update(patch: Partial<InventoryFilterState>) {
	emit("update:modelValue", { ...props.modelValue, ...patch });
}

function clearSection(key: "warehouses" | "categories") {
	update({ [key]: [] });
}
function clearAll() {
	emit("update:modelValue", {
		warehouses: [],
		categories: [],
		inStock: false,
		expiry: "all",
		expiryDays: props.modelValue.expiryDays || "30",
		expiryFromDays: props.modelValue.expiryFromDays || "-30",
		expiryToDays: props.modelValue.expiryToDays || "30",
	});
}
function expiryLabel(option: { value: ExpiryFilter; label: string }) {
	if (
		["overdue_within", "overdue_beyond", "remaining_within", "remaining_beyond"].includes(
			option.value,
		)
	)
		return option.label.replace("天数", `${props.modelValue.expiryDays || "30"} 天`);
	return option.label;
}
</script>

<template>
	<div class="inventory-filter-panel compact-filter-sections">
		<CompactFilterSection
			title="仓库 / 位置"
			icon="warehouse"
			:count="modelValue.warehouses.length ? `${modelValue.warehouses.length} 项` : 0"
			:initial-open="warehouseOpen"
			:clearable="Boolean(modelValue.warehouses.length)"
			@clear="clearSection('warehouses')"
			@toggle="warehouseOpen = $event"
		>
			<WarehouseSelector
				:model-value="modelValue.warehouses"
				:rows="selectorWarehouses"
				:counts="selectorWarehouseCounts"
				title="仓库 / 位置"
				placeholder="搜索仓库或位置"
				embedded
				@update:model-value="update({ warehouses: $event })"
			/>
		</CompactFilterSection>

		<CompactFilterSection
			title="物品类别"
			icon="card"
			:count="modelValue.categories.length ? `${modelValue.categories.length} 项` : 0"
			:initial-open="categoryOpen"
			:clearable="Boolean(modelValue.categories.length)"
			@clear="clearSection('categories')"
			@toggle="categoryOpen = $event"
		>
			<CategorySelector
				:model-value="modelValue.categories"
				:rows="selectorCategories"
				:counts="selectorCategoryCounts"
				title="物品类别"
				placeholder="搜索物品类别"
				embedded
				@update:model-value="update({ categories: $event })"
			/>
		</CompactFilterSection>

		<label class="stock-filter"
			><input
				type="checkbox"
				:checked="modelValue.inStock"
				@change="update({ inStock: ($event.target as HTMLInputElement).checked })"
			/><span><b>有库存</b><small>隐藏零库存物品或批次</small></span></label
		>

		<section v-if="expiryPrimary" class="expiry-section">
			<div class="expiry-heading">
				<h3>效期范围</h3>
				<label
					>天数<input
						:value="modelValue.expiryDays || '30'"
						type="number"
						min="1"
						max="3650"
						@input="update({ expiryDays: ($event.target as HTMLInputElement).value })"
				/></label>
			</div>
			<div class="expiry-options">
				<label
					v-for="option in expiryOptions"
					:key="option.value"
					:class="{ selected: modelValue.expiry === option.value }"
					><input
						type="radio"
						:name="`primary-expiry-${instanceId}`"
						:value="option.value"
						:checked="modelValue.expiry === option.value"
						@change="update({ expiry: option.value })" /><span>{{
						expiryLabel(option)
					}}</span
					><small class="option-count">{{ expiryCounts?.[option.value] ?? "—" }}</small
					><span v-if="option.value === 'custom'" class="custom-range">
						<input
							:value="modelValue.expiryFromDays || ''"
							type="number"
							aria-label="自定义效期起始天数"
							@input="
								update({
									expiryFromDays: ($event.target as HTMLInputElement).value,
								})
							"
						/><span>–</span
						><input
							:value="modelValue.expiryToDays || ''"
							type="number"
							aria-label="自定义效期结束天数"
							@input="
								update({ expiryToDays: ($event.target as HTMLInputElement).value })
							"
						/> </span
				></label>
			</div>
			<p v-if="customError" class="custom-error" role="alert">{{ customError }}</p>
		</section>

		<section v-else class="filter-section more-section">
			<div class="filter-section-heading">
				<button type="button" :aria-expanded="moreOpen" @click="moreOpen = !moreOpen">
					<InventoryIcon name="filter" /><span>更多条件</span
					><small v-if="modelValue.expiry !== 'all'">1 项</small
					><span
						class="disclosure-triangle"
						:class="{ expanded: moreOpen }"
						aria-hidden="true"
					></span>
				</button>
			</div>
			<div v-if="moreOpen" class="filter-section-body expiry-section">
				<div class="expiry-heading">
					<h3>效期范围</h3>
					<label
						>天数<input
							:value="modelValue.expiryDays || '30'"
							type="number"
							min="1"
							max="3650"
							@input="
								update({ expiryDays: ($event.target as HTMLInputElement).value })
							"
					/></label>
				</div>
				<div class="expiry-options">
					<label
						v-for="option in expiryOptions"
						:key="option.value"
						:class="{ selected: modelValue.expiry === option.value }"
						><input
							type="radio"
							:name="`more-expiry-${instanceId}`"
							:value="option.value"
							:checked="modelValue.expiry === option.value"
							@change="update({ expiry: option.value })" /><span>{{
							expiryLabel(option)
						}}</span
						><small class="option-count">{{
							expiryCounts?.[option.value] ?? "—"
						}}</small
						><span v-if="option.value === 'custom'" class="custom-range">
							<input
								:value="modelValue.expiryFromDays || ''"
								type="number"
								aria-label="自定义效期起始天数"
								@input="
									update({
										expiryFromDays: ($event.target as HTMLInputElement).value,
									})
								"
							/><span>–</span
							><input
								:value="modelValue.expiryToDays || ''"
								type="number"
								aria-label="自定义效期结束天数"
								@input="
									update({
										expiryToDays: ($event.target as HTMLInputElement).value,
									})
								"
							/> </span
					></label>
				</div>
				<p v-if="customError" class="custom-error" role="alert">{{ customError }}</p>
			</div>
		</section>

		<button type="button" class="clear-all-filters" @click="clearAll">清空全部筛选</button>
	</div>
</template>

<style scoped>
.inventory-filter-panel {
	display: grid;
	gap: 10px;
	color: #343c46;
	font:
		450 14px/1.45 Inter,
		"Noto Sans SC",
		-apple-system,
		BlinkMacSystemFont,
		"Segoe UI",
		"Microsoft YaHei",
		sans-serif;
}
.filter-section,
.expiry-section,
.stock-filter {
	border: 1px solid #e5dfd5;
	border-radius: 10px;
	background: #fff;
}
.filter-section-heading {
	display: flex;
	align-items: center;
	padding: 2px 7px 2px 2px;
}
.filter-section-heading > button:first-child {
	display: flex;
	flex: 1;
	align-items: center;
	gap: 8px;
	min-height: 44px;
	padding: 7px 8px;
	border: 0;
	background: transparent;
	color: #313a45;
	text-align: left;
	font: inherit;
	font-weight: 650;
}
.filter-section-heading > button:first-child > span:not(.disclosure-triangle) {
	flex: 1;
}
.filter-section-heading small {
	color: #8a6a43;
	font-size: 11px;
	font-weight: 600;
}
.disclosure-triangle {
	display: inline-block;
	flex: none;
	width: 0;
	height: 0;
	border-top: 4px solid transparent;
	border-bottom: 4px solid transparent;
	border-left: 6px solid currentColor;
	color: #8a8177;
	transition: transform 120ms ease;
}
.disclosure-triangle.expanded {
	transform: rotate(90deg);
}
.section-clear {
	min-height: 34px;
	padding: 4px 6px;
	border: 0;
	background: transparent;
	color: #8a5a2c;
	font: inherit;
	font-size: 12px;
}
.filter-section-body {
	padding: 0 10px 10px;
	border-top: 1px solid #eee9e1;
}
.stock-filter input,
.expiry-options input {
	flex: none;
	width: 14px;
	height: 14px;
	margin: 0;
	accent-color: #9a6939;
}
.stock-filter input[type="checkbox"] {
	appearance: none;
	display: grid;
	place-content: center;
	box-sizing: border-box;
	inline-size: 13px;
	block-size: 13px;
	min-width: 0;
	min-height: 0;
	padding: 0;
	border: 1px solid #aaa299;
	border-radius: 3px;
	background: #fff;
}
.stock-filter input[type="checkbox"]::before {
	content: "";
	width: 4px;
	height: 7px;
	border-bottom: 1.5px solid #fff;
	border-right: 1.5px solid #fff;
	transform: translateY(-1px) rotate(45deg) scale(0);
	transform-origin: center;
}
.stock-filter input[type="checkbox"]:checked,
.stock-filter input[type="checkbox"]:indeterminate {
	border-color: #956536;
	background: #956536;
}
.stock-filter input[type="checkbox"]:checked::before {
	transform: translateY(-1px) rotate(45deg) scale(1);
}
.stock-filter input[type="checkbox"]:indeterminate::before {
	width: 7px;
	height: 0;
	border-bottom-width: 1.5px;
	border-right: 0;
	transform: none;
}
.stock-filter {
	display: flex;
	align-items: center;
	gap: 9px;
	min-height: 52px;
	padding: 8px 12px;
	cursor: pointer;
}
.stock-filter span {
	display: flex;
	flex-direction: column;
}
.stock-filter small {
	color: #817a71;
	font-size: 11px;
}
.expiry-heading {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 8px;
	padding: 10px 11px 5px;
}
.expiry-heading h3 {
	margin: 0;
	font-size: 13px;
}
.expiry-heading label {
	display: flex;
	align-items: center;
	gap: 5px;
	color: #777870;
	font-size: 12px;
}
.expiry-heading input,
.custom-range input {
	width: 58px;
	height: 30px;
	padding: 3px 5px;
	border: 1px solid #ddd7cd;
	border-radius: 6px;
}
.expiry-options {
	display: grid;
	padding: 4px 10px 10px;
}
.expiry-options > label {
	display: grid;
	grid-template-columns: 16px minmax(0, 1fr) auto;
	align-items: center;
	gap: 7px;
	min-height: 36px;
	padding: 4px 3px;
	border-radius: 6px;
	cursor: pointer;
}
.expiry-options > label:hover,
.expiry-options > label.selected {
	background: #f5f1eb;
}
.option-count {
	color: #8b8379;
	font-size: 11px;
}
.custom-range {
	grid-column: 2 / -1;
	display: flex;
	align-items: center;
	gap: 5px;
	padding-bottom: 4px;
}
.custom-error {
	margin: -3px 12px 10px;
	color: #a63e33;
	font-size: 11px;
}
.expiry-section {
	padding: 11px;
}
.expiry-section h3 {
	margin: 0 0 9px;
	color: #343c46;
	font-size: 14px;
}
.expiry-options {
	display: grid;
	grid-template-columns: repeat(2, minmax(0, 1fr));
	gap: 6px;
}
.expiry-options label {
	display: grid;
	grid-template-columns: minmax(0, 1fr) auto;
	align-items: center;
	gap: 6px;
	min-height: 40px;
	padding: 6px 8px;
	border: 1px solid #e5dfd5;
	border-radius: 7px;
	background: #fbfaf8;
	cursor: pointer;
}
.expiry-options label.selected {
	border-color: #c7a67f;
	background: #f3eadf;
	color: #76502c;
}
.expiry-options label span {
	display: flex;
	flex-direction: column;
	min-width: 0;
}
.expiry-options label input[type="radio"] {
	position: absolute;
	width: 1px;
	height: 1px;
	margin: -1px;
	padding: 0;
	overflow: hidden;
	clip: rect(0 0 0 0);
	white-space: nowrap;
	border: 0;
}
.expiry-options label:focus-within {
	outline: 2px solid #946c3f;
	outline-offset: 2px;
}
.expiry-options .custom-range {
	grid-column: 1 / -1;
	justify-self: end;
}
.expiry-options .option-count {
	justify-self: end;
}
.expiry-options {
	grid-template-columns: 1fr;
	gap: 4px;
}
.expiry-options small {
	color: #7c746b;
	font-size: 10px;
	white-space: nowrap;
}
.more-section .expiry-section {
	padding: 10px 0 0;
	border: 0;
	border-radius: 0;
}
.clear-all-filters {
	min-height: 42px;
	border: 1px solid #dfd6c9;
	border-radius: 8px;
	background: #faf8f4;
	color: #80572e;
	font: inherit;
	font-weight: 600;
}
button {
	cursor: pointer;
}
button:focus-visible,
input:focus-visible {
	outline: 2px solid #946c3f;
	outline-offset: 2px;
}
@media (max-width: 760px) {
	.stock-filter input,
	.expiry-options input {
		width: 16px;
		height: 16px;
	}
	.stock-filter input[type="checkbox"] {
		inline-size: 16px;
		block-size: 16px;
	}
}
@media (max-width: 420px) {
	.expiry-options {
		grid-template-columns: 1fr;
	}
}
</style>
