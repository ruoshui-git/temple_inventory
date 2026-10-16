<script setup lang="ts">
import { computed, useSlots } from "vue";
import { useResponsiveLayout } from "../../composables/useResponsiveLayout";
import { emptyScope, type BrowseScope } from "../browseModel";
import { scopeFilterChips, scopeFilterLabels, type ScopeFilterField } from "../compactFilters";
import PreviewBrowseFilters from "./PreviewBrowseFilters.vue";
import PreviewFilterPanel from "./PreviewFilterPanel.vue";
import PreviewUiButton from "./PreviewUiButton.vue";

const props = withDefaults(
	defineProps<{
		modelValue: BrowseScope;
		movement?: boolean;
		records?: boolean;
		hideActivity?: boolean;
		fields?: ScopeFilterField[];
		resultCount?: number;
		extraCount?: number;
		context?: string;
		active?: boolean;
	}>(),
	{ extraCount: 0, active: true },
);
const emit = defineEmits<{
	"update:modelValue": [value: BrowseScope];
	clear: [];
	"update:open": [value: boolean];
}>();
const slots = useSlots();
const { isMobile } = useResponsiveLayout();
const scope = computed({
	get: () => props.modelValue,
	set: (value) => emit("update:modelValue", value),
});
const fields = computed<ScopeFilterField[]>(
	() =>
		props.fields || [
			"item",
			"categories",
			"warehouses",
			...(!props.hideActivity ? ["activity" as const] : []),
			...(props.movement ? (["kinds", "sources", "destinations"] as const) : []),
		],
);
const primary = computed(() =>
	fields.value.filter((field) => !["sources", "destinations"].includes(field)),
);
const secondary = computed(() =>
	fields.value.filter((field) => ["sources", "destinations"].includes(field)),
);
const chips = computed(() => scopeFilterChips(scope.value));
const count = computed(() => chips.value.length + props.extraCount);
const fieldCount = (field: ScopeFilterField) =>
	chips.value.filter((chip) => chip.field === field).length;
function remove(field: ScopeFilterField, value: string) {
	const previous = scope.value[field];
	scope.value = {
		...scope.value,
		[field]: Array.isArray(previous) ? previous.filter((item) => item !== value) : "",
	};
}
function clear() {
	const cleared = { ...scope.value };
	const defaults = emptyScope();
	for (const field of Object.keys(scopeFilterLabels) as ScopeFilterField[])
		Object.assign(cleared, { [field]: defaults[field] });
	scope.value = cleared;
	emit("clear");
}
</script>
<template>
	<div class="preview-compact-filters">
		<div class="compact-filter-toolbar">
			<PreviewFilterPanel
				v-if="isMobile"
				label="筛选"
				:count="count"
				:context="context"
				:active="active"
				@update:open="emit('update:open', $event)"
			>
				<PreviewBrowseFilters
					v-model="scope"
					:fields="fields"
					:movement="movement"
					:records="records"
					:hide-activity="hideActivity"
				/>
				<slot />
				<template #footer
					><span v-if="resultCount !== undefined" role="status"
						>{{ resultCount }} 项结果</span
					><PreviewUiButton @click="clear">清空筛选</PreviewUiButton></template
				>
			</PreviewFilterPanel>
			<template v-else>
				<PreviewFilterPanel
					v-for="field in primary"
					:key="field"
					:label="scopeFilterLabels[field]"
					:count="fieldCount(field)"
					:context="context"
					:active="active"
				>
					<PreviewBrowseFilters
						v-model="scope"
						:fields="[field]"
						:movement="movement"
						:records="records"
						:hide-activity="hideActivity"
					/>
				</PreviewFilterPanel>
				<PreviewFilterPanel
					v-if="secondary.length || slots.default"
					label="更多筛选"
					:count="
						secondary.reduce((total, field) => total + fieldCount(field), extraCount)
					"
					:context="context"
					:active="active"
				>
					<PreviewBrowseFilters
						v-if="secondary.length"
						v-model="scope"
						:fields="secondary"
						:movement="movement"
						:records="records"
					/>
					<slot />
				</PreviewFilterPanel>
			</template>
			<PreviewUiButton v-if="!isMobile" :disabled="!count" @click="clear"
				>清空筛选</PreviewUiButton
			>
			<slot name="actions" />
		</div>
		<div
			v-if="chips.length || slots.chips"
			class="compact-filter-chips"
			aria-label="已应用筛选"
		>
			<PreviewUiButton
				v-for="chip in chips"
				:key="chip.key"
				variant="ghost"
				:aria-label="`移除${chip.label}`"
				@click="remove(chip.field, chip.value)"
				>{{ chip.label }} <span aria-hidden="true">×</span></PreviewUiButton
			>
			<slot name="chips" />
		</div>
	</div>
</template>
