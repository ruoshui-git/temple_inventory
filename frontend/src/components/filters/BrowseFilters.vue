<script setup lang="ts">
import RemoteSelect from "../ui/RemoteSelect.vue";
import { useFilterChoices } from "../../features/references/useFilterChoices";
const { loadItems, loadActivities } = useFilterChoices();
import { computed, inject, onBeforeUnmount } from "vue";
import HierarchyFilter from "../ui/HierarchyFilter.vue";
import { useReferenceData } from "../../services/contracts";
const reference = useReferenceData();
import { movementLabels } from "../../lib/filterPresentation";
import { type BrowseScope } from "../../lib/browseQuery";
import { onCategoryRenamed } from "../../lib/categoryRename";
import { browseHierarchyEditKey } from "../../lib/filterPanelSession";
const props = defineProps<{
	modelValue: BrowseScope;
	movement?: boolean;
	records?: boolean;
	hideActivity?: boolean;
	hierarchyInRail?: boolean;
	fields?: Array<
		"item" | "activity" | "categories" | "warehouses" | "kinds" | "sources" | "destinations"
	>;
}>();
const emit = defineEmits<{ "update:modelValue": [scope: BrowseScope] }>();
const editHierarchy = inject(browseHierarchyEditKey, () => {});
const scope = computed(() => props.modelValue);
const shows = (field: NonNullable<typeof props.fields>[number]) =>
	!props.fields || props.fields.includes(field);
function update<K extends keyof BrowseScope>(key: K, value: BrowseScope[K]) {
	emit("update:modelValue", { ...scope.value, [key]: value });
}
const stopCategoryRename = onCategoryRenamed(({ oldName, category }) => {
	if (!scope.value.categories.includes(oldName)) return;
	update("categories", [
		...new Set(
			scope.value.categories.map((name) => (name === oldName ? category.name : name)),
		),
	]);
});
onBeforeUnmount(stopCategoryRename);
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
			data-filter-field="item"
			tabindex="-1"
			label="物品"
			:model-value="scope.item"
			:load="loadItems"
			:selected-label="reference.items.find((row) => row.value === scope.item)?.label"
			@update:model-value="update('item', $event)"
		/>
		<RemoteSelect
			v-if="!hideActivity && shows('activity')"
			data-filter-field="activity"
			tabindex="-1"
			label="活动"
			:model-value="scope.activity"
			:load="loadActivities"
			:selected-label="
				reference.activities.find((row) => row.value === scope.activity)?.label
			"
			@update:model-value="update('activity', $event)"
		/>
		<fieldset
			v-if="shows('categories') && !hierarchyInRail"
			class="browse-hierarchy-section"
			data-filter-field="categories"
			tabindex="-1"
		>
			<legend>物品类别</legend>
			<HierarchyFilter
				embedded
				:model-value="scope.categories"
				:options="categories"
				title="物品类别"
				placeholder="搜索类别"
				@update:model-value="update('categories', $event)"
			/>
			<label class="preview-choice-label preview-check">
				<input
					type="checkbox"
					:checked="scope.uncategorized"
					@change="update('uncategorized', ($event.target as HTMLInputElement).checked)"
				/>无分类
			</label>
		</fieldset>
		<fieldset
			v-else-if="shows('categories') && hierarchyInRail"
			class="browse-hierarchy-rail-entry"
			data-filter-field="categories"
		>
			<legend>物品类别</legend>
			<button type="button" @click="editHierarchy('categories')">
				在侧栏中编辑类别筛选
			</button>
		</fieldset>
		<fieldset
			v-if="shows('warehouses') && !hierarchyInRail"
			class="browse-hierarchy-section"
			data-filter-field="warehouses"
			tabindex="-1"
		>
			<legend>仓库 / 位置</legend>
			<HierarchyFilter
				embedded
				:model-value="scope.warehouses"
				:options="reference.warehouses"
				title="仓库 / 位置"
				placeholder="搜索仓库或位置"
				@update:model-value="update('warehouses', $event)"
			/>
		</fieldset>
		<fieldset
			v-else-if="shows('warehouses') && hierarchyInRail"
			class="browse-hierarchy-rail-entry"
			data-filter-field="warehouses"
		>
			<legend>仓库 / 位置</legend>
			<button type="button" @click="editHierarchy('warehouses')">
				在侧栏中编辑仓库筛选
			</button>
		</fieldset>
		<template v-if="movement">
			<fieldset v-if="shows('kinds')" data-filter-field="kinds" tabindex="-1">
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
			<fieldset
				v-if="shows('sources')"
				class="browse-hierarchy-section"
				data-filter-field="sources"
				tabindex="-1"
			>
				<legend>来源位置</legend>
				<HierarchyFilter
					v-if="shows('sources')"
					embedded
					:model-value="scope.sources"
					:options="reference.warehouses"
					title="来源位置"
					placeholder="搜索来源"
					@update:model-value="update('sources', $event)"
				/>
			</fieldset>
			<fieldset
				v-if="shows('destinations')"
				class="browse-hierarchy-section"
				data-filter-field="destinations"
				tabindex="-1"
			>
				<legend>去向位置</legend>
				<HierarchyFilter
					v-if="shows('destinations')"
					embedded
					:model-value="scope.destinations"
					:options="reference.warehouses"
					title="去向位置"
					placeholder="搜索去向"
					@update:model-value="update('destinations', $event)"
				/>
			</fieldset>
		</template>
	</div>
</template>
