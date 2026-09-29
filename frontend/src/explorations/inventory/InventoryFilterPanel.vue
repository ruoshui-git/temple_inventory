<script setup lang="ts">
import { computed, ref } from "vue";
import ExplorationIcon from "./ExplorationIcon.vue";

export type ExpiryFilter = "attention" | "all" | "expired" | "30" | "90" | "180" | "none";
export type InventoryFilterState = {
	warehouses: string[];
	categories: string[];
	inStock: boolean;
	expiry: ExpiryFilter;
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
	}>(),
	{ expiryPrimary: false },
);
const emit = defineEmits<{ "update:modelValue": [value: InventoryFilterState] }>();
const instanceId = Math.random().toString(36).slice(2);

const warehouseOpen = ref(true);
const categoryOpen = ref(false);
const moreOpen = ref(false);
const warehouseTerm = ref("");
const categoryTerm = ref("");
const expandedWarehouseNodes = ref(
	new Set(props.warehouses.filter((node) => node.isGroup).map((node) => node.name)),
);
const expandedCategoryNodes = ref(
	new Set(props.categories.filter((node) => node.isGroup).map((node) => node.name)),
);

const expiryOptions: Array<{ value: ExpiryFilter; label: string; hint?: string }> = [
	{ value: "attention", label: "需关注", hint: "已过期及未来 30 天" },
	{ value: "all", label: "全部" },
	{ value: "expired", label: "已过期" },
	{ value: "30", label: "30 天内" },
	{ value: "90", label: "90 天内" },
	{ value: "180", label: "180 天内" },
	{ value: "none", label: "无效期" },
];

function update(patch: Partial<InventoryFilterState>) {
	emit("update:modelValue", { ...props.modelValue, ...patch });
}
function parentOf(node: InventoryFilterNode) {
	return node.parent || "";
}
function childrenOf(node: InventoryFilterNode, nodes: InventoryFilterNode[]) {
	return nodes.filter((child) => parentOf(child) === node.name);
}
function descendantsOf(node: InventoryFilterNode, nodes: InventoryFilterNode[]) {
	const descendants: InventoryFilterNode[] = [];
	const visit = (parent: InventoryFilterNode) => {
		for (const child of childrenOf(parent, nodes)) {
			descendants.push(child);
			visit(child);
		}
	};
	visit(node);
	return descendants;
}
function leavesOf(node: InventoryFilterNode, nodes: InventoryFilterNode[]) {
	const descendants = descendantsOf(node, nodes);
	return node.isGroup ? descendants.filter((child) => !child.isGroup) : [node];
}
function ancestorsOf(node: InventoryFilterNode, nodes: InventoryFilterNode[]) {
	const ancestors: InventoryFilterNode[] = [];
	let parent = nodes.find((candidate) => candidate.name === parentOf(node));
	while (parent && !ancestors.some((candidate) => candidate.name === parent?.name)) {
		ancestors.push(parent);
		parent = nodes.find((candidate) => candidate.name === parentOf(parent!));
	}
	return ancestors;
}
function nodeSelected(node: InventoryFilterNode, values: string[], nodes: InventoryFilterNode[]) {
	return (
		values.includes(node.name) ||
		ancestorsOf(node, nodes).some((parent) => values.includes(parent.name))
	);
}
function nodePartial(node: InventoryFilterNode, values: string[], nodes: InventoryFilterNode[]) {
	if (!node.isGroup || values.includes(node.name)) return false;
	const leaves = leavesOf(node, nodes);
	return (
		leaves.some((leaf) => nodeSelected(leaf, values, nodes)) &&
		!leaves.every((leaf) => nodeSelected(leaf, values, nodes))
	);
}
function toggleNode(
	node: InventoryFilterNode,
	key: "warehouses" | "categories",
	nodes: InventoryFilterNode[],
) {
	const next = new Set(props.modelValue[key]);
	const leaves = leavesOf(node, nodes);
	if (node.isGroup) {
		const fullySelected = valuesCoverNode(node, [...next], nodes);
		next.delete(node.name);
		for (const descendant of descendantsOf(node, nodes)) next.delete(descendant.name);
		if (!fullySelected) next.add(node.name);
	} else {
		const coveringAncestor = ancestorsOf(node, nodes).find((parent) => next.has(parent.name));
		if (coveringAncestor) {
			next.delete(coveringAncestor.name);
			for (const leaf of leavesOf(coveringAncestor, nodes)) {
				if (leaf.name !== node.name) next.add(leaf.name);
			}
		} else if (next.has(node.name)) next.delete(node.name);
		else next.add(node.name);
	}
	for (const value of [...next]) {
		const candidate = nodes.find((item) => item.name === value);
		if (candidate && ancestorsOf(candidate, nodes).some((parent) => next.has(parent.name)))
			next.delete(value);
	}
	update({ [key]: [...next] });
}
function valuesCoverNode(
	node: InventoryFilterNode,
	values: string[],
	nodes: InventoryFilterNode[],
) {
	return (
		values.includes(node.name) ||
		leavesOf(node, nodes).every((leaf) => nodeSelected(leaf, values, nodes))
	);
}
function depth(node: InventoryFilterNode, nodes: InventoryFilterNode[]) {
	return ancestorsOf(node, nodes).length;
}
function toggleExpanded(name: string, expanded: Set<string>) {
	const next = new Set(expanded);
	next.has(name) ? next.delete(name) : next.add(name);
	return next;
}
function visibleNodes(nodes: InventoryFilterNode[], term: string, expanded: Set<string>) {
	const query = term.trim().toLocaleLowerCase();
	const matches = (node: InventoryFilterNode) => node.label.toLocaleLowerCase().includes(query);
	return nodes.filter((node) => {
		if (query)
			return (
				matches(node) ||
				descendantsOf(node, nodes).some(matches) ||
				ancestorsOf(node, nodes).some(matches)
			);
		return ancestorsOf(node, nodes).every((parent) => expanded.has(parent.name));
	});
}

const visibleWarehouses = computed(() =>
	visibleNodes(props.warehouses, warehouseTerm.value, expandedWarehouseNodes.value),
);
const visibleCategories = computed(() =>
	visibleNodes(props.categories, categoryTerm.value, expandedCategoryNodes.value),
);

function clearSection(key: "warehouses" | "categories") {
	update({ [key]: [] });
}
function clearAll() {
	emit("update:modelValue", { warehouses: [], categories: [], inStock: false, expiry: "all" });
}
</script>

<template>
	<div class="inventory-filter-panel">
		<section class="filter-section">
			<div class="filter-section-heading">
				<button
					type="button"
					:aria-expanded="warehouseOpen"
					@click="warehouseOpen = !warehouseOpen"
				>
					<ExplorationIcon name="warehouse" />
					<span>仓库 / 位置</span>
					<small v-if="modelValue.warehouses.length"
						>{{ modelValue.warehouses.length }} 项</small
					>
					<span
						class="disclosure-triangle"
						:class="{ expanded: warehouseOpen }"
						aria-hidden="true"
					></span>
				</button>
				<button
					v-if="modelValue.warehouses.length"
					type="button"
					class="section-clear"
					@click="clearSection('warehouses')"
				>
					清除
				</button>
			</div>
			<div v-if="warehouseOpen" class="filter-section-body">
				<label class="filter-search"
					><ExplorationIcon name="search" /><input
						v-model="warehouseTerm"
						type="search"
						placeholder="搜索仓库或位置"
						aria-label="搜索仓库或位置"
				/></label>
				<p v-if="!visibleWarehouses.length" class="filter-empty">没有匹配的位置</p>
				<ul v-else class="filter-tree">
					<li
						v-for="node in visibleWarehouses"
						:key="node.name"
						:style="{ '--tree-depth': depth(node, warehouses) }"
					>
						<button
							v-if="node.isGroup"
							type="button"
							class="node-toggle"
							:aria-label="`${expandedWarehouseNodes.has(node.name) ? '收起' : '展开'} ${node.label}`"
							:aria-expanded="expandedWarehouseNodes.has(node.name)"
							@click="
								expandedWarehouseNodes = toggleExpanded(
									node.name,
									expandedWarehouseNodes,
								)
							"
						>
							<span
								class="disclosure-triangle"
								:class="{ expanded: expandedWarehouseNodes.has(node.name) }"
								aria-hidden="true"
							></span>
						</button>
						<span v-else class="node-spacer"></span>
						<label
							><input
								type="checkbox"
								:checked="valuesCoverNode(node, modelValue.warehouses, warehouses)"
								:indeterminate="
									nodePartial(node, modelValue.warehouses, warehouses)
								"
								@change="toggleNode(node, 'warehouses', warehouses)"
							/><span>{{ node.label }}</span
							><small v-if="node.count !== undefined">{{ node.count }}</small></label
						>
					</li>
				</ul>
			</div>
		</section>

		<section class="filter-section">
			<div class="filter-section-heading">
				<button
					type="button"
					:aria-expanded="categoryOpen"
					@click="categoryOpen = !categoryOpen"
				>
					<ExplorationIcon name="card" />
					<span>物品类别</span>
					<small v-if="modelValue.categories.length"
						>{{ modelValue.categories.length }} 项</small
					>
					<span
						class="disclosure-triangle"
						:class="{ expanded: categoryOpen }"
						aria-hidden="true"
					></span>
				</button>
				<button
					v-if="modelValue.categories.length"
					type="button"
					class="section-clear"
					@click="clearSection('categories')"
				>
					清除
				</button>
			</div>
			<div v-if="categoryOpen" class="filter-section-body">
				<label class="filter-search"
					><ExplorationIcon name="search" /><input
						v-model="categoryTerm"
						type="search"
						placeholder="搜索物品类别"
						aria-label="搜索物品类别"
				/></label>
				<p v-if="!visibleCategories.length" class="filter-empty">没有匹配的类别</p>
				<ul v-else class="filter-tree">
					<li
						v-for="node in visibleCategories"
						:key="node.name"
						:style="{ '--tree-depth': depth(node, categories) }"
					>
						<button
							v-if="node.isGroup"
							type="button"
							class="node-toggle"
							:aria-label="`${expandedCategoryNodes.has(node.name) ? '收起' : '展开'} ${node.label}`"
							:aria-expanded="expandedCategoryNodes.has(node.name)"
							@click="
								expandedCategoryNodes = toggleExpanded(
									node.name,
									expandedCategoryNodes,
								)
							"
						>
							<span
								class="disclosure-triangle"
								:class="{ expanded: expandedCategoryNodes.has(node.name) }"
								aria-hidden="true"
							></span>
						</button>
						<span v-else class="node-spacer"></span>
						<label
							><input
								type="checkbox"
								:checked="valuesCoverNode(node, modelValue.categories, categories)"
								:indeterminate="
									nodePartial(node, modelValue.categories, categories)
								"
								@change="toggleNode(node, 'categories', categories)"
							/><span>{{ node.label }}</span
							><small v-if="node.count !== undefined">{{ node.count }}</small></label
						>
					</li>
				</ul>
			</div>
		</section>

		<label class="stock-filter"
			><input
				type="checkbox"
				:checked="modelValue.inStock"
				@change="update({ inStock: ($event.target as HTMLInputElement).checked })"
			/><span><b>有库存</b><small>隐藏零库存物品或批次</small></span></label
		>

		<section v-if="expiryPrimary" class="expiry-section">
			<h3>效期</h3>
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
						@change="update({ expiry: option.value })"
					/><span
						>{{ option.label
						}}<small v-if="option.hint">{{ option.hint }}</small></span
					></label
				>
			</div>
		</section>

		<section v-else class="filter-section more-section">
			<div class="filter-section-heading">
				<button type="button" :aria-expanded="moreOpen" @click="moreOpen = !moreOpen">
					<ExplorationIcon name="filter" /><span>更多条件</span
					><small v-if="modelValue.expiry !== 'all'">1 项</small
					><span
						class="disclosure-triangle"
						:class="{ expanded: moreOpen }"
						aria-hidden="true"
					></span>
				</button>
			</div>
			<div v-if="moreOpen" class="filter-section-body expiry-section">
				<h3>效期</h3>
				<div class="expiry-options">
					<label
						v-for="option in expiryOptions.filter(
							(item) => item.value !== 'attention',
						)"
						:key="option.value"
						:class="{ selected: modelValue.expiry === option.value }"
						><input
							type="radio"
							:name="`more-expiry-${instanceId}`"
							:value="option.value"
							:checked="modelValue.expiry === option.value"
							@change="update({ expiry: option.value })"
						/><span>{{ option.label }}</span></label
					>
				</div>
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
.filter-search {
	display: flex;
	align-items: center;
	gap: 7px;
	height: 38px;
	margin: 9px 0 6px;
	padding: 0 9px;
	border: 1px solid #ddd7cd;
	border-radius: 7px;
	color: #7b8490;
	background: #fbfaf8;
}
.filter-search input {
	width: 100%;
	min-width: 0;
	height: 100%;
	padding: 0;
	border: 0;
	outline: 0;
	background: transparent;
	color: #343c46;
	font: inherit;
}
.filter-tree {
	max-height: 230px;
	overflow: auto;
	margin: 0;
	padding: 0;
	list-style: none;
	scrollbar-width: thin;
}
.filter-tree li {
	display: flex;
	align-items: center;
	min-height: 36px;
	padding-left: calc(var(--tree-depth) * 18px);
	border-radius: 6px;
}
.filter-tree li:hover {
	background: #f5f1eb;
}
.filter-tree label {
	display: flex;
	flex: 1;
	align-items: center;
	gap: 7px;
	min-width: 0;
	cursor: pointer;
}
.filter-tree label span {
	flex: 1;
	overflow-wrap: anywhere;
}
.filter-tree label small {
	color: #8b8379;
	font-size: 11px;
}
.filter-tree input,
.stock-filter input,
.expiry-options input {
	flex: none;
	width: 14px;
	height: 14px;
	margin: 0;
	accent-color: #9a6939;
}
.filter-tree input[type="checkbox"],
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
.filter-tree input[type="checkbox"]::before,
.stock-filter input[type="checkbox"]::before {
	content: "";
	width: 4px;
	height: 7px;
	border-bottom: 1.5px solid #fff;
	border-right: 1.5px solid #fff;
	transform: translateY(-1px) rotate(45deg) scale(0);
	transform-origin: center;
}
.filter-tree input[type="checkbox"]:checked,
.stock-filter input[type="checkbox"]:checked,
.filter-tree input[type="checkbox"]:indeterminate,
.stock-filter input[type="checkbox"]:indeterminate {
	border-color: #956536;
	background: #956536;
}
.filter-tree input[type="checkbox"]:checked::before,
.stock-filter input[type="checkbox"]:checked::before {
	transform: translateY(-1px) rotate(45deg) scale(1);
}
.filter-tree input[type="checkbox"]:indeterminate::before,
.stock-filter input[type="checkbox"]:indeterminate::before {
	width: 7px;
	height: 0;
	border-bottom-width: 1.5px;
	border-right: 0;
	transform: none;
}
.node-toggle,
.node-spacer {
	flex: none;
	width: 28px;
	min-width: 28px;
	min-height: 32px;
	padding: 0;
	border: 0;
	background: transparent;
	color: #776f65;
	font: inherit;
}
.node-toggle {
	display: grid;
	place-items: center;
}
.filter-empty {
	margin: 12px 3px;
	color: #817a71;
	font-size: 12px;
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
	display: flex;
	align-items: center;
	gap: 6px;
	min-height: 38px;
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
	.filter-tree input,
	.stock-filter input,
	.expiry-options input {
		width: 16px;
		height: 16px;
	}
	.filter-tree input[type="checkbox"],
	.stock-filter input[type="checkbox"] {
		inline-size: 16px;
		block-size: 16px;
	}
}
@media (max-width: 420px) {
	.expiry-options {
		grid-template-columns: 1fr;
	}
	.filter-tree {
		max-height: 190px;
	}
}
</style>
