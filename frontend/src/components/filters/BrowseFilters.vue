<script setup lang="ts">
import RemoteSelect from "../ui/RemoteSelect.vue";
import { useFilterChoices } from "../../features/references/useFilterChoices";
const { loadItems, loadActivities } = useFilterChoices();
import { computed } from "vue";
import HierarchyFilter from "../ui/HierarchyFilter.vue";
import { useReferenceData } from "../../services/contracts";
const reference = useReferenceData();
import { movementLabels } from "../../lib/filterPresentation";
import { type BrowseScope } from "../../lib/browseQuery";
const props = defineProps<{
	modelValue: BrowseScope;
	movement?: boolean;
	records?: boolean;
	hideActivity?: boolean;
	fields?: Array<
		"item" | "activity" | "categories" | "warehouses" | "kinds" | "sources" | "destinations"
	>;
}>();
const emit = defineEmits<{ "update:modelValue": [scope: BrowseScope] }>();
const scope = computed(() => props.modelValue);
const shows = (field: NonNullable<typeof props.fields>[number]) =>
	!props.fields || props.fields.includes(field);
function update<K extends keyof BrowseScope>(key: K, value: BrowseScope[K]) {
	emit("update:modelValue", { ...scope.value, [key]: value });
}
const categories = computed(() => reference.categories);
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
		<RemoteSelect
			v-if="shows('item')"
			label="物品"
			:model-value="scope.item"
			:load="loadItems"
			:selected-label="reference.items.find((row) => row.value === scope.item)?.label"
			@update:model-value="update('item', $event)"
		/>
		<RemoteSelect
			v-if="!hideActivity && shows('activity')"
			label="活动"
			:model-value="scope.activity"
			:load="loadActivities"
			:selected-label="
				reference.activities.find((row) => row.value === scope.activity)?.label
			"
			@update:model-value="update('activity', $event)"
		/>
		<HierarchyFilter
			v-if="shows('categories')"
			:model-value="scope.categories"
			:options="categories"
			title="物品类别"
			placeholder="搜索类别"
			@update:model-value="update('categories', $event)"
		/>
		<HierarchyFilter
			v-if="shows('warehouses')"
			:model-value="scope.warehouses"
			:options="reference.warehouses"
			title="仓库 / 位置"
			placeholder="搜索仓库或位置"
			@update:model-value="update('warehouses', $event)"
		/>
		<template v-if="movement">
			<fieldset v-if="shows('kinds')">
				<legend>流动类型 · 可多选</legend>
				<label
					v-for="(label, kind) in movementLabels"
					v-show="records || !['Opening', 'Reconcile'].includes(kind)"
					:key="kind"
					class="preview-choice-label preview-check"
					><input
						type="checkbox"
						:checked="scope.kinds.includes(kind)"
						@change="toggleKind(kind)"
					/>{{ label }}</label
				>
			</fieldset>
			<HierarchyFilter
				v-if="shows('sources')"
				:model-value="scope.sources"
				:options="reference.warehouses"
				title="来源位置"
				placeholder="搜索来源"
				@update:model-value="update('sources', $event)"
			/>
			<HierarchyFilter
				v-if="shows('destinations')"
				:model-value="scope.destinations"
				:options="reference.warehouses"
				title="去向位置"
				placeholder="搜索去向"
				@update:model-value="update('destinations', $event)"
			/>
		</template>
	</div>
</template>
