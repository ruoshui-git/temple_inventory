<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";

export type HierarchyFilterNode = {
	name: string;
	label?: string;
	search_text?: string;
	parent?: string;
	parent_warehouse?: string;
	parent_item_group?: string;
	is_group?: number | boolean;
	lft?: number;
	rgt?: number;
	count?: number;
};

const props = withDefaults(
	defineProps<{
		modelValue: string[];
		options: HierarchyFilterNode[];
		tree?: HierarchyFilterNode[];
		placeholder: string;
		title: string;
		embedded?: boolean;
	}>(),
	{ tree: () => [], embedded: false },
);
const emit = defineEmits<{ "update:modelValue": [value: string[]] }>();

const root = ref<HTMLElement | null>(null);
const term = ref("");
const activeIndex = ref(0);
const expanded = ref(new Set<string>());
const nodes = computed(() =>
	[...props.options].sort((a, b) => Number(a.lft || 0) - Number(b.lft || 0)),
);
const allNodes = computed(() => (props.tree.length ? props.tree : nodes.value));
const byName = computed(() => new Map(allNodes.value.map((node) => [node.name, node])));
const parentOf = (node: HierarchyFilterNode) =>
	node.parent || node.parent_warehouse || node.parent_item_group || "";
const childrenOf = (node: HierarchyFilterNode) =>
	allNodes.value.filter((candidate) => parentOf(candidate) === node.name);
const roots = computed(() =>
	nodes.value.filter((node) => !allNodes.value.some((parent) => parent.name === parentOf(node))),
);
const descendants = (node: HierarchyFilterNode): HierarchyFilterNode[] => {
	const result: HierarchyFilterNode[] = [];
	const visit = (parent: HierarchyFilterNode) => {
		for (const child of childrenOf(parent)) {
			result.push(child);
			visit(child);
		}
	};
	visit(node);
	if (result.length) return result;
	return allNodes.value.filter(
		(candidate) =>
			candidate.name !== node.name &&
			candidate.lft !== undefined &&
			candidate.rgt !== undefined &&
			Number(candidate.lft) > Number(node.lft) &&
			Number(candidate.rgt) < Number(node.rgt),
	);
};
const leaves = (node: HierarchyFilterNode) =>
	node.is_group ? descendants(node).filter((candidate) => !candidate.is_group) : [node];
const path = (node: HierarchyFilterNode) => {
	if (node.label?.includes(" / ")) return node.label;
	const values = [node.label || node.name];
	let parent = byName.value.get(parentOf(node));
	const seen = new Set<string>();
	while (parent && !seen.has(parent.name)) {
		seen.add(parent.name);
		values.unshift(parent.label || parent.name);
		parent = byName.value.get(parentOf(parent));
	}
	return values.join(" / ");
};
const normalize = (value: string) =>
	value
		.toLocaleLowerCase()
		.replace(/\s*\/\s*/g, "/")
		.replace(/\s+/g, " ")
		.trim();
const matches = (node: HierarchyFilterNode) =>
	!term.value ||
	normalize(
		[node.name, node.label || "", node.search_text || "", path(node)].join(" "),
	).includes(normalize(term.value));
const visible = (node: HierarchyFilterNode) =>
	matches(node) || descendants(node).some((candidate) => matches(candidate));
function depth(node: HierarchyFilterNode) {
	let value = 0;
	let parent = byName.value.get(parentOf(node));
	const seen = new Set<string>();
	while (parent && !seen.has(parent.name)) {
		seen.add(parent.name);
		value += 1;
		parent = byName.value.get(parentOf(parent));
	}
	return value;
}
function ancestorsExpanded(node: HierarchyFilterNode) {
	if (term.value) return true;
	let parent = byName.value.get(parentOf(node));
	const seen = new Set<string>();
	while (parent && !seen.has(parent.name)) {
		if (!expanded.value.has(parent.name)) return false;
		seen.add(parent.name);
		parent = byName.value.get(parentOf(parent));
	}
	return true;
}
const displayNodes = computed(() =>
	nodes.value.filter((node) => visible(node) && ancestorsExpanded(node)),
);
const selected = (node: HierarchyFilterNode) =>
	props.modelValue.includes(node.name) ||
	props.modelValue.some((value) => {
		const parent = byName.value.get(value);
		return !!parent?.is_group && leaves(parent).some((leaf) => leaf.name === node.name);
	});
const partial = (node: HierarchyFilterNode) =>
	Boolean(node.is_group && leaves(node).some(selected) && !leaves(node).every(selected));
function toggle(node: HierarchyFilterNode) {
	const next = new Set(props.modelValue);
	if (node.is_group) {
		if (leaves(node).every(selected)) {
			next.delete(node.name);
			for (const leaf of leaves(node)) next.delete(leaf.name);
		} else {
			next.add(node.name);
			for (const leaf of leaves(node)) next.delete(leaf.name);
		}
	} else {
		const covering = allNodes.value.filter(
			(parent) =>
				parent.is_group &&
				next.has(parent.name) &&
				leaves(parent).some((leaf) => leaf.name === node.name),
		);
		if (covering.length) {
			for (const parent of covering) {
				next.delete(parent.name);
				for (const leaf of leaves(parent))
					if (leaf.name !== node.name) next.add(leaf.name);
			}
		} else if (next.has(node.name)) next.delete(node.name);
		else next.add(node.name);
	}
	for (const value of [...next]) {
		const candidate = byName.value.get(value);
		if (
			candidate &&
			allNodes.value.some(
				(parent) =>
					parent.name !== value &&
					parent.is_group &&
					next.has(parent.name) &&
					leaves(parent).some((leaf) => leaf.name === candidate.name),
			)
		)
			next.delete(value);
	}
	emit("update:modelValue", [...next]);
}
function clear() {
	emit("update:modelValue", []);
}
function remove(name: string) {
	emit(
		"update:modelValue",
		props.modelValue.filter((value) => value !== name),
	);
}
function toggleExpanded(name: string) {
	const next = new Set(expanded.value);
	if (next.has(name)) next.delete(name);
	else next.add(name);
	expanded.value = next;
}
function navigate(delta: number) {
	if (!displayNodes.value.length) return;
	activeIndex.value =
		(activeIndex.value + delta + displayNodes.value.length) % displayNodes.value.length;
	void nextTick(() =>
		root.value
			?.querySelector<HTMLInputElement>('[data-facet-index="' + activeIndex.value + '"]')
			?.focus(),
	);
}
function activateActive() {
	const node = displayNodes.value[activeIndex.value];
	if (node) toggle(node);
}
function onKeydown(event: KeyboardEvent) {
	if (event.key === "Escape") {
		if (term.value) {
			event.preventDefault();
			term.value = "";
		}
		return;
	}
	if (event.key === "ArrowDown" || event.key === "ArrowUp") {
		event.preventDefault();
		navigate(event.key === "ArrowDown" ? 1 : -1);
	} else if (event.key === "Home" || event.key === "End") {
		event.preventDefault();
		activeIndex.value = event.key === "Home" ? 0 : Math.max(0, displayNodes.value.length - 1);
	} else if (event.key === "Enter") {
		event.preventDefault();
		activateActive();
	}
}
watch(
	allNodes,
	(value) => {
		const next = new Set(expanded.value);
		for (const node of value) if (node.is_group) next.add(node.name);
		expanded.value = next;
	},
	{ immediate: true },
);
watch(term, () => {
	activeIndex.value = 0;
});
</script>

<template>
	<section ref="root" class="hierarchy-facet" :class="{ 'hierarchy-facet-embedded': embedded }">
		<header v-if="!embedded">
			<h3>{{ title }}</h3>
			<span>{{ modelValue.length }} 项已选</span
			><button
				type="button"
				class="inline-link"
				aria-label="清除本项"
				:disabled="!modelValue.length"
				@click="clear"
			>
				清除本项
			</button>
		</header>
		<div v-if="modelValue.length" class="facet-chips">
			<button
				v-for="name in modelValue"
				:key="name"
				type="button"
				:aria-label="'移除 ' + path(byName.get(name) || { name })"
				@click="remove(name)"
			>
				× <span>{{ path(byName.get(name) || { name }) }}</span>
			</button>
		</div>
		<div class="facet-input">
			<input
				v-model="term"
				type="search"
				:placeholder="placeholder"
				:aria-label="title"
				@keydown="onKeydown"
			/>
		</div>
		<div
			class="facet-suggestions hierarchy-inline-tree"
			role="tree"
			:aria-label="title + '选项'"
		>
			<p v-if="!nodes.length" class="field-hint">暂无可选项目</p>
			<p v-else-if="!roots.some(visible)" class="field-hint">没有匹配的项目</p>
			<ul v-else class="hierarchy-list">
				<li v-for="(node, index) in displayNodes" :key="node.name" role="treeitem">
					<div
						class="hierarchy-row"
						:style="{ paddingInlineStart: 0.3 + depth(node) * 1.5 + 'rem' }"
					>
						<button
							v-if="childrenOf(node).length"
							type="button"
							class="tree-toggle"
							:aria-expanded="expanded.has(node.name)"
							:aria-label="
								(expanded.has(node.name) ? '收起 ' : '展开 ') +
								(node.label || node.name)
							"
							@click="toggleExpanded(node.name)"
						>
							<span aria-hidden="true">{{
								expanded.has(node.name) ? "▾" : "▸"
							}}</span>
						</button>
						<span v-else class="tree-spacer" aria-hidden="true"></span>
						<label>
							<input
								:data-facet-index="index"
								type="checkbox"
								:checked="
									node.is_group ? leaves(node).every(selected) : selected(node)
								"
								:indeterminate="partial(node)"
								@keydown="onKeydown"
								@change="toggle(node)"
							/><span>{{ node.label || node.name }}</span
							><small v-if="node.count !== undefined" class="facet-result-count">{{
								node.count
							}}</small></label
						>
					</div>
				</li>
			</ul>
		</div>
	</section>
</template>

<style scoped>
.hierarchy-facet {
	border: 1px solid #dfd8ca;
	border-radius: 12px;
	padding: 12px;
	margin: 12px 0;
	background: #fcfbf8;
}
.hierarchy-facet-embedded {
	margin: 0;
	border: 0;
	border-radius: 0;
	padding: 0;
	background: transparent;
	box-shadow: none;
}
.hierarchy-facet header {
	display: flex;
	align-items: center;
	margin: 0 0 8px;
	gap: 7px;
}
.hierarchy-facet h3 {
	margin: 0;
	flex: 1;
}
.facet-chips {
	display: flex;
	flex-wrap: wrap;
	gap: 6px;
	overflow: visible;
	padding-bottom: 6px;
}
.facet-chips button {
	white-space: normal;
	min-height: 30px;
	padding: 4px 8px;
	background: #eee8db;
}
.facet-input {
	display: flex;
	gap: 6px;
}
.facet-input input {
	width: 100%;
	min-width: 0;
	margin: 0;
}
.facet-suggestions {
	max-height: 290px;
	overflow: auto;
	overscroll-behavior: contain;
	margin-top: 8px;
	border-top: 1px solid #e6dfd2;
}
.hierarchy-list {
	list-style: none;
	padding: 0;
	margin: 4px 0;
}
.hierarchy-row {
	display: flex;
	align-items: center;
	min-height: 38px;
	border-radius: 6px;
}
.hierarchy-row:hover,
.hierarchy-row:focus-within {
	background: #f5f1eb;
}
.hierarchy-row label {
	display: flex;
	flex: 1;
	align-items: center;
	gap: 5px;
	min-width: 0;
	cursor: pointer;
	font-weight: 500;
}
.hierarchy-row label > span {
	flex: 1;
	min-width: 0;
	overflow-wrap: anywhere;
}
.hierarchy-row input[type="checkbox"] {
	appearance: none;
	display: grid;
	flex: none;
	place-content: center;
	box-sizing: border-box;
	inline-size: 13px;
	block-size: 13px;
	min-width: 0;
	min-height: 0;
	margin: 0 5px 0 0;
	padding: 0;
	border: 1px solid #aaa299;
	border-radius: 3px;
	background: #fff;
	accent-color: #9a6939;
}
.hierarchy-row input[type="checkbox"]::before {
	content: "";
	width: 4px;
	height: 7px;
	border-right: 1.5px solid #fff;
	border-bottom: 1.5px solid #fff;
	transform: translateY(-1px) rotate(45deg) scale(0);
	transform-origin: center;
}
.hierarchy-row input[type="checkbox"]:checked,
.hierarchy-row input[type="checkbox"]:indeterminate {
	border-color: #956536;
	background: #956536;
}
.hierarchy-row input[type="checkbox"]:checked::before {
	transform: translateY(-1px) rotate(45deg) scale(1);
}
.hierarchy-row input[type="checkbox"]:indeterminate::before {
	width: 7px;
	height: 0;
	border-right: 0;
	border-bottom-width: 1.5px;
	transform: none;
}
.tree-toggle,
.tree-spacer {
	width: 24px;
	min-width: 24px;
	min-height: 32px;
	padding: 2px;
	border: 0;
	background: transparent;
	color: #776f65;
	font: inherit;
}
.tree-toggle {
	display: grid;
	place-items: center;
}
.facet-result-count {
	margin-left: auto;
	color: #8b8379;
	font-size: 11px;
}
@media (min-width: 1024px) {
	.filter-sidebar[data-filter-surface="compact"] .hierarchy-facet {
		margin: 0 0 10px;
		border-radius: 10px;
		padding: 10px;
	}
	.filter-sidebar[data-filter-surface="compact"] .hierarchy-facet header {
		margin-bottom: 6px;
	}
	.filter-sidebar[data-filter-surface="compact"] .facet-suggestions {
		max-height: 230px;
	}
}
@media (max-width: 1023px) {
	.hierarchy-row input[type="checkbox"] {
		inline-size: 16px;
		block-size: 16px;
		min-width: 16px;
		min-height: 16px;
	}
}
</style>
