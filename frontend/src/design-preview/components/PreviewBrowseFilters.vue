<script setup lang="ts">
import { computed } from "vue";
import PreviewHierarchyFilter from "./PreviewHierarchyFilter.vue";
import { reviewSession } from "../reviewModel";
import { movementLabels, type BrowseScope } from "../browseModel";
const props = defineProps<{ modelValue: BrowseScope; movement?: boolean; records?: boolean }>();
const emit = defineEmits<{ "update:modelValue": [scope: BrowseScope] }>();
const scope = computed(() => props.modelValue);
function update<K extends keyof BrowseScope>(key: K, value: BrowseScope[K]) {
	emit("update:modelValue", { ...scope.value, [key]: value });
}
const categories = computed(() =>
	[...new Set(reviewSession.stock.map((item) => item.category))].map((name) => ({
		name,
		label: name,
	})),
);
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
		<label
			>物品<select
				:value="scope.item"
				@change="update('item', ($event.target as HTMLSelectElement).value)"
			>
				<option value="">全部物品</option>
				<option v-for="item in reviewSession.stock" :key="item.code" :value="item.code">
					{{ item.name }} · {{ item.code }}
				</option>
			</select></label
		>
		<label
			>活动<select
				:value="scope.activity"
				@change="update('activity', ($event.target as HTMLSelectElement).value)"
			>
				<option value="">全部活动</option>
				<option v-for="activity in activities" :key="activity">{{ activity }}</option>
			</select></label
		>
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
