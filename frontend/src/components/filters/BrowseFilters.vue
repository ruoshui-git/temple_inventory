<script setup lang="ts">
import InventoryIcon from "../InventoryIcon.vue";
import { kindIcons } from "../../lib/kindIcons";
import RemoteSelect from "../ui/RemoteSelect.vue";
import { useFilterChoices } from "../../features/references/useFilterChoices";
const { loadItems, loadActivities } = useFilterChoices();
import { computed, inject, onBeforeUnmount } from "vue";
import HierarchyFilter from "../ui/HierarchyFilter.vue";
import FilterDisclosure from "../ui/FilterDisclosure.vue";
import type { HierarchyFilterNode } from "../ui/HierarchyFilter.vue";
import { useReferenceData } from "../../services/contracts";
const reference = useReferenceData();
import { movementLabels } from "../../lib/presentationLabels";
import { type BrowseScope } from "../../lib/browseQuery";
import { onCategoryRenamed } from "../../lib/categoryRename";
import { browseHierarchyEditKey } from "../../lib/filterPanelSession";
const props = withDefaults(
	defineProps<{
		modelValue: BrowseScope;
		movement?: boolean;
		records?: boolean;
		hideActivity?: boolean;
		hierarchyInRail?: boolean;
		disclosureMode?: boolean;
		expiryOnly?: boolean;
		fields?: Array<
			| "item"
			| "activity"
			| "categories"
			| "tracking"
			| "warehouses"
			| "kinds"
			| "sources"
			| "destinations"
		>;
	}>(),
	{ disclosureMode: false },
);
const emit = defineEmits<{ "update:modelValue": [scope: BrowseScope] }>();
const editHierarchy = inject(browseHierarchyEditKey, () => {});
const scope = computed(() => props.modelValue);
const trackingLabel = computed(() => {
	const labels: Record<string, string> = {
		all: "全部物品",
		batch: "按批次管理",
		batch_only: "仅批次（不记录效期）",
		expiry: "记录效期",
		none: "不按批次管理",
	};
	return labels[scope.value.tracking] || "全部物品";
});
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
function selectedSummary(values: string[], options: HierarchyFilterNode[]) {
	return values
		.map((value) => options.find((option) => option.name === value)?.label || value)
		.join("、");
}
</script>
<template>
	<div class="browse-filter-fields">
		<FilterDisclosure
			v-if="shows('item')"
			label="物品"
			field="item"
			:summary="
				scope.item
					? reference.items.find((row) => row.value === scope.item)?.label || scope.item
					: '不限'
			"
		>
			<RemoteSelect
				data-filter-field="item-editor"
				tabindex="-1"
				label="物品"
				:model-value="scope.item"
				:load="loadItems"
				:selected-label="reference.items.find((row) => row.value === scope.item)?.label"
				@update:model-value="update('item', $event)"
			/>
		</FilterDisclosure>
		<FilterDisclosure
			v-if="!hideActivity && shows('activity')"
			label="活动"
			field="activity"
			:summary="
				scope.activity
					? reference.activities.find((row) => row.value === scope.activity)?.label ||
						scope.activity
					: '不限'
			"
		>
			<RemoteSelect
				data-filter-field="activity-editor"
				tabindex="-1"
				label="活动"
				:model-value="scope.activity"
				:load="loadActivities"
				:selected-label="
					reference.activities.find((row) => row.value === scope.activity)?.label
				"
				@update:model-value="update('activity', $event)"
			/>
		</FilterDisclosure>
		<FilterDisclosure
			v-if="shows('categories')"
			label="物品类别"
			field="categories"
			:disclosure="disclosureMode"
			:summary="
				[
					selectedSummary(scope.categories, categories),
					scope.uncategorized ? '无分类' : '',
				]
					.filter(Boolean)
					.join('、') || '不限'
			"
		>
			<fieldset v-if="hierarchyInRail" class="browse-hierarchy-section" tabindex="-1">
				<button type="button" @click="editHierarchy('categories')">
					在侧栏中编辑类别筛选
				</button>
			</fieldset>
			<fieldset v-else class="browse-hierarchy-section" tabindex="-1">
				<HierarchyFilter
					embedded
					:model-value="scope.categories"
					:options="categories"
					title="物品类别"
					placeholder="搜索类别"
					initial-expansion="first-level"
					@update:model-value="update('categories', $event)"
				/>
				<label class="form-choice-label form-check">
					<input
						type="checkbox"
						:checked="scope.uncategorized"
						@change="
							update('uncategorized', ($event.target as HTMLInputElement).checked)
						"
					/>无分类
				</label>
			</fieldset>
		</FilterDisclosure>
		<FilterDisclosure
			v-if="shows('tracking')"
			label="物品追踪"
			field="tracking"
			:disclosure="disclosureMode"
			:summary="trackingLabel"
		>
			<label class="form-field"
				><select
					:value="scope.tracking"
					aria-label="物品追踪"
					@change="
						update(
							'tracking',
							($event.target as HTMLSelectElement).value as BrowseScope['tracking'],
						)
					"
				>
					<option value="all">全部物品</option>
					<option v-if="!expiryOnly" value="batch">按批次管理</option>
					<option value="expiry">记录效期</option>
					<option v-if="expiryOnly" value="batch_only">仅批次（不记录效期）</option>
					<option v-if="!expiryOnly" value="none">不按批次管理</option>
				</select></label
			>
		</FilterDisclosure>
		<FilterDisclosure
			v-if="shows('warehouses')"
			label="仓库 / 位置"
			field="warehouses"
			:disclosure="disclosureMode"
			:summary="selectedSummary(scope.warehouses, reference.warehouses) || '不限'"
		>
			<fieldset v-if="hierarchyInRail" class="browse-hierarchy-section" tabindex="-1">
				<button type="button" @click="editHierarchy('warehouses')">
					在侧栏中编辑仓库筛选
				</button>
			</fieldset>
			<fieldset v-else class="browse-hierarchy-section" tabindex="-1">
				<HierarchyFilter
					embedded
					:model-value="scope.warehouses"
					:options="reference.warehouses"
					title="仓库 / 位置"
					placeholder="搜索仓库或位置"
					initial-expansion="branching-leaves"
					@update:model-value="update('warehouses', $event)"
				/>
			</fieldset>
		</FilterDisclosure>
		<template v-if="movement">
			<FilterDisclosure
				v-if="shows('kinds')"
				label="流动类型"
				field="kinds"
				:summary="
					scope.kinds.length
						? scope.kinds.map((kind) => movementLabels[kind] || kind).join('、')
						: '不限'
				"
			>
				<fieldset tabindex="-1">
					<label
						v-for="(entry, kind) in kindIcons"
						:key="kind"
						class="form-choice-label form-check"
						><input
							type="checkbox"
							:checked="scope.kinds.includes(kind)"
							@change="toggleKind(kind)"
						/><InventoryIcon :name="entry.icon" />{{ entry.label }}</label
					>
				</fieldset>
			</FilterDisclosure>
			<FilterDisclosure
				v-if="shows('sources')"
				label="来源位置"
				field="sources"
				:summary="selectedSummary(scope.sources, reference.warehouses) || '不限'"
			>
				<fieldset class="browse-hierarchy-section" tabindex="-1">
					<HierarchyFilter
						v-if="shows('sources')"
						embedded
						:model-value="scope.sources"
						:options="reference.warehouses"
						title="来源位置"
						placeholder="搜索来源"
						initial-expansion="branching-leaves"
						@update:model-value="update('sources', $event)"
					/>
				</fieldset>
			</FilterDisclosure>
			<FilterDisclosure
				v-if="shows('destinations')"
				label="去向位置"
				field="destinations"
				:summary="selectedSummary(scope.destinations, reference.warehouses) || '不限'"
			>
				<fieldset class="browse-hierarchy-section" tabindex="-1">
					<HierarchyFilter
						v-if="shows('destinations')"
						embedded
						:model-value="scope.destinations"
						:options="reference.warehouses"
						title="去向位置"
						placeholder="搜索去向"
						initial-expansion="branching-leaves"
						@update:model-value="update('destinations', $event)"
					/>
				</fieldset>
			</FilterDisclosure>
		</template>
	</div>
</template>
