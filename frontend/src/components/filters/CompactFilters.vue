<script setup lang="ts">
import { computed, useSlots, ref, watch, nextTick } from "vue";
import { useResponsiveLayout } from "../../composables/useResponsiveLayout";
import { emptyScope, type BrowseScope } from "../../lib/browseQuery";
import {
	scopeFilterChips,
	scopeFilterLabels,
	type ScopeFilterField,
} from "../../lib/filterPresentation";
import BrowseFilters from "./BrowseFilters.vue";
import FilterPanel from "../ui/FilterPanel.vue";
import UiButton from "../ui/UiButton.vue";

import { useReferenceData } from "../../services/contracts";
const reference = useReferenceData();

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
const activePanel = ref("");
const panels = new Map<string, InstanceType<typeof FilterPanel>>();
let switching = false;
function registerPanel(key: string, value: unknown) {
	if (value) panels.set(key, value as InstanceType<typeof FilterPanel>);
	else panels.delete(key);
}
function panelChanged(key: string, value: boolean) {
	if (value) activePanel.value = key;
	else if (!switching && activePanel.value === key) activePanel.value = "";
	emit("update:open", value);
}
watch(
	isMobile,
	async (mobile) => {
		if (!activePanel.value) return;
		const next = mobile
			? "all"
			: activePanel.value === "all"
				? primary.value[0] || "more"
				: activePanel.value;
		switching = true;
		await nextTick();
		panels.get(next)?.show();
		activePanel.value = next;
		switching = false;
	},
	{ flush: "post" },
);
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
const chips = computed(() => scopeFilterChips(scope.value, reference));
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
function show() {
	panels.get(isMobile.value ? "all" : primary.value[0] || "more")?.show();
}
defineExpose({ show });
</script>
<template>
	<div class="preview-compact-filters">
		<div class="compact-filter-toolbar">
			<FilterPanel
				v-if="isMobile"
				:ref="(value) => registerPanel('all', value)"
				label="筛选"
				:count="count"
				:context="context"
				:active="active"
				@update:open="panelChanged('all', $event)"
			>
				<BrowseFilters
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
					><UiButton @click="clear">清空筛选</UiButton></template
				>
			</FilterPanel>
			<template v-else>
				<FilterPanel
					v-for="field in primary"
					:key="field"
					:ref="(value) => registerPanel(field, value)"
					:label="scopeFilterLabels[field]"
					:count="fieldCount(field)"
					:context="context"
					:active="active"
					@update:open="panelChanged(field, $event)"
				>
					<BrowseFilters
						v-model="scope"
						:fields="[field]"
						:movement="movement"
						:records="records"
						:hide-activity="hideActivity"
					/>
				</FilterPanel>
				<FilterPanel
					v-if="secondary.length || slots.default"
					:ref="(value) => registerPanel('more', value)"
					label="更多筛选"
					:count="
						secondary.reduce((total, field) => total + fieldCount(field), extraCount)
					"
					:context="context"
					:active="active"
					@update:open="panelChanged('more', $event)"
				>
					<BrowseFilters
						v-if="secondary.length"
						v-model="scope"
						:fields="secondary"
						:movement="movement"
						:records="records"
					/>
					<slot />
				</FilterPanel>
			</template>
			<UiButton v-if="!isMobile" :disabled="!count" @click="clear">清空筛选</UiButton>
			<slot name="actions" />
		</div>
		<div
			v-if="chips.length || slots.chips"
			class="compact-filter-chips"
			aria-label="已应用筛选"
		>
			<UiButton
				v-for="chip in chips"
				:key="chip.key"
				variant="ghost"
				:aria-label="`移除${chip.label}`"
				@click="remove(chip.field, chip.value)"
				>{{ chip.label }} <span aria-hidden="true">×</span></UiButton
			>
			<slot name="chips" />
		</div>
	</div>
</template>
