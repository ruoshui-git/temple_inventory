<script setup lang="ts">
import PreviewSearchSelect from "./PreviewSearchSelect.vue";
import { computed } from "vue";
import PreviewHierarchyFilter from "./PreviewHierarchyFilter.vue";
import { reviewSession } from "../reviewModel";
import { movementLabels, type BrowseScope } from "../browseModel";
const props = defineProps<{
	modelValue: BrowseScope;
	movement?: boolean;
	records?: boolean;
	hideActivity?: boolean;
}>();
const emit = defineEmits<{ "update:modelValue": [scope: BrowseScope] }>();
const scope = computed(() => props.modelValue);
function update<K extends keyof BrowseScope>(key: K, value: BrowseScope[K]) {
	emit("update:modelValue", { ...scope.value, [key]: value });
}
const categories = computed(() => reviewSession.categories);
const activities = computed(() => [
	...new Set(
		[
			...reviewSession.movements.map((row) => row.activity),
			...reviewSession.loans.map((row) => row.activity),
			...reviewSession.drafts.map((row) => row.activity),
		].filter(Boolean),
	),
]);
function toggleKind(kind: string) {
	update(
		"kinds",
		scope.value.kinds.includes(kind)
			? scope.value.kinds.filter((value) => value !== kind)
			: [...scope.value.kinds, kind],
	);
}
</script>
<template>
	<div class="preview-filter-fields">
		<PreviewSearchSelect
			label="物品"
			:model-value="scope.item"
			:options="
				reviewSession.stock.map((item) => ({
					value: item.code,
					label: item.name,
					detail: item.code,
				}))
			"
			@update:model-value="update('item', $event)"
		/>
		<PreviewSearchSelect
			v-if="!hideActivity"
			label="活动"
			:model-value="scope.activity"
			:options="activities.filter(Boolean) as string[]"
			@update:model-value="update('activity', $event)"
		/>
		<PreviewHierarchyFilter
			:model-value="scope.categories"
			:options="categories"
			title="物品类别"
			placeholder="搜索类别"
			@update:model-value="update('categories', $event)"
		/>
		<PreviewHierarchyFilter
			:model-value="scope.warehouses"
			:options="reviewSession.warehouses"
			title="仓库 / 位置"
			placeholder="搜索仓库或位置"
			@update:model-value="update('warehouses', $event)"
		/>
		<template v-if="movement">
			<fieldset>
				<legend>流动类型 · 可多选</legend>
				<label
					v-for="(label, kind) in movementLabels"
					v-show="records || !['Opening', 'Reconcile'].includes(kind)"
					:key="kind"
					class="preview-check"
					><input
						type="checkbox"
						:checked="scope.kinds.includes(kind)"
						@change="toggleKind(kind)"
					/>{{ label }}</label
				>
			</fieldset>
			<PreviewHierarchyFilter
				:model-value="scope.sources"
				:options="reviewSession.warehouses"
				title="来源位置"
				placeholder="搜索来源"
				@update:model-value="update('sources', $event)"
			/>
			<PreviewHierarchyFilter
				:model-value="scope.destinations"
				:options="reviewSession.warehouses"
				title="去向位置"
				placeholder="搜索去向"
				@update:model-value="update('destinations', $event)"
			/>
		</template>
	</div>
</template>
