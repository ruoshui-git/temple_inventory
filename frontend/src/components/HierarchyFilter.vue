<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import { normalizeHierarchySelection } from "../lib/hierarchySelection";

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
const selection = computed(() => normalizeHierarchySelection(props.modelValue, allNodes.value));
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
const branch = (node: HierarchyFilterNode) => [node, ...descendants(node)];
function isAncestor(ancestor: HierarchyFilterNode, node: HierarchyFilterNode) {
	let parent = byName.value.get(parentOf(node));
	const seen = new Set<string>();
	while (parent && !seen.has(parent.name)) {
		if (parent.name === ancestor.name) return true;
		seen.add(parent.name);
		parent = byName.value.get(parentOf(parent));
	}
	return Boolean(
		ancestor.name !== node.name &&
		ancestor.lft !== undefined &&
		ancestor.rgt !== undefined &&
		node.lft !== undefined &&
		node.rgt !== undefined &&
		Number(ancestor.lft) < Number(node.lft) &&
		Number(ancestor.rgt) > Number(node.rgt),
	);
}
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
	selection.value.includes(node.name) ||
	selection.value.some((value) => {
		const parent = byName.value.get(value);
		return !!parent?.is_group && isAncestor(parent, node);
	});
const fullySelected = (node: HierarchyFilterNode) => {
	if (selected(node)) return true;
	const branchLeaves = leaves(node);
	return Boolean(node.is_group && branchLeaves.length && branchLeaves.every(selected));
};
const partial = (node: HierarchyFilterNode) => {
	return Boolean(
		node.is_group &&
		!fullySelected(node) &&
		descendants(node).some((candidate) => selection.value.includes(candidate.name)),
	);
};
function toggle(node: HierarchyFilterNode) {
	const next = new Set(selection.value);
	const coveredBy = allNodes.value.filter(
		(parent) => parent.is_group && next.has(parent.name) && isAncestor(parent, node),
	);
	if (coveredBy.length) {
		const covering = coveredBy.reduce((outermost, candidate) =>
			isAncestor(candidate, outermost) ? candidate : outermost,
		);
		const excludedNames = new Set(branch(node).map((candidate) => candidate.name));
		next.delete(covering.name);
		for (const leaf of leaves(covering))
			if (!excludedNames.has(leaf.name)) next.add(leaf.name);
	} else if (fullySelected(node)) {
		for (const descendant of branch(node)) next.delete(descendant.name);
	} else {
		for (const descendant of descendants(node)) next.delete(descendant.name);
		next.add(node.name);
	}
	emit("update:modelValue", normalizeHierarchySelection([...next], allNodes.value));
}
function clear() {
	emit("update:modelValue", []);
}
function remove(name: string) {
	emit(
		"update:modelValue",
		normalizeHierarchySelection(
			selection.value.filter((value) => value !== name),
			allNodes.value,
		),
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
			<span>{{ selection.length }} 项已选</span
			><button
				type="button"
				class="inline-link"
				aria-label="清除本项"
				:disabled="!selection.length"
				@click="clear"
			>
				清除本项
			</button>
		</header>
		<div v-if="selection.length" class="facet-chips">
			<button
				v-for="name in selection"
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
								:checked="fullySelected(node)"
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
	border: 1px solid var(--ti-border);
	border-radius: var(--ti-radius-control);
	padding: var(--ti-space-3);
	margin: var(--ti-space-3) 0;
	background: var(--ti-surface);
}
.hierarchy-facet-embedded {
	margin: 0;
	border: 0;
	border-radius: 0;
	padding: 0;
	background: transparent;
	box-shadow: var(--ti-shadow-card);
}
.hierarchy-facet header {
	display: flex;
	align-items: center;
	margin: 0 0 var(--ti-space-2);
	gap: var(--ti-space-2);
}
.hierarchy-facet h3 {
	margin: 0;
	flex: 1;
}
.facet-chips {
	display: flex;
	flex-wrap: wrap;
	gap: var(--ti-space-1);
	overflow: visible;
	padding-bottom: var(--ti-space-1);
}
.facet-chips button {
	white-space: normal;
	min-height: 30px;
	padding: var(--ti-space-1) var(--ti-space-2);
	background: var(--ti-accent-soft);
}
.facet-input {
	display: flex;
	gap: var(--ti-space-1);
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
	margin-top: var(--ti-space-2);
	border-top: 1px solid var(--ti-border);
}
.hierarchy-list {
	list-style: none;
	padding: 0;
	margin: var(--ti-space-1) 0;
}
.hierarchy-row {
	display: flex;
	align-items: center;
	min-height: 38px;
	border-radius: var(--ti-radius-control);
}
.hierarchy-row:hover,
.hierarchy-row:focus-within {
	background: var(--ti-canvas);
}
.hierarchy-row label {
	display: flex;
	flex: 1;
	align-items: center;
	gap: var(--ti-space-1);
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
	margin: 0 var(--ti-space-1) 0 0;
	padding: 0;
	border: 1px solid var(--ti-border-strong);
	border-radius: var(--ti-radius-control);
	background: var(--ti-surface);
	accent-color: var(--ti-accent);
}
.hierarchy-row input[type="checkbox"]::before {
	content: "";
	width: 4px;
	height: 7px;
	border-right: 1.5px solid var(--ti-surface);
	border-bottom: 1.5px solid var(--ti-surface);
	transform: translateY(-1px) rotate(45deg) scale(0);
	transform-origin: center;
}
.hierarchy-row input[type="checkbox"]:checked,
.hierarchy-row input[type="checkbox"]:indeterminate {
	border-color: var(--ti-accent);
	background: var(--ti-accent);
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
	color: var(--ti-muted);
	font: inherit;
}
.tree-toggle {
	display: grid;
	place-items: center;
}
@media (max-width: 1023px) {
	.facet-chips button,
	.tree-toggle,
	.hierarchy-row,
	.hierarchy-row label {
		min-height: var(--ti-density-control);
	}
}
.facet-result-count {
	margin-left: auto;
	color: var(--ti-muted);
	font-size: var(--ti-font-small);
}
@media (min-width: 1024px) {
	.filter-sidebar[data-filter-surface="compact"] .hierarchy-facet {
		margin: 0 0 var(--ti-space-2);
		border-radius: var(--ti-radius-control);
		padding: var(--ti-space-2);
	}
	.filter-sidebar[data-filter-surface="compact"] .hierarchy-facet header {
		margin-bottom: var(--ti-space-1);
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
