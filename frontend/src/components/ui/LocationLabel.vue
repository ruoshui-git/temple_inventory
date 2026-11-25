<script setup lang="ts">
import { computed } from "vue";
import { vTip } from "../../directives/tip";
import { locationTip } from "../../lib/warehouseLabel";
import { useOptionalReferenceData } from "../../services/contracts";

const props = withDefaults(
	defineProps<{
		label?: string;
		title?: string;
		warehouse?: string | null;
		tooltip?: boolean;
		focusable?: boolean;
	}>(),
	{
		label: "",
		title: "",
		tooltip: true,
	},
);
const reference = useOptionalReferenceData();
const tip = computed(() =>
	locationTip(props.warehouse, reference?.warehouses ?? [], props.title || props.label),
);
const location = computed(() => (typeof tip.value === "object" ? tip.value.location : undefined));
const displayLabel = computed(() => props.label || location.value?.path || "");
const accessibleLabel = computed(() => {
	const own = location.value?.levels.at(-1)?.name;
	return location.value
		? [location.value.path, own].filter(Boolean).join("，")
		: props.title || props.label;
});
// Not a tab stop by default: a 300-row table would gain 300 stops. Screen readers get the name
// from aria-label; standalone labels (warehouse page, details) opt in with `focusable`.
// Split at the first slash only for truncation; site + "/" + remainder is always the label itself.
const slash = computed(() => displayLabel.value.indexOf("/"));
const site = computed(() =>
	slash.value > 0 ? displayLabel.value.slice(0, slash.value) : displayLabel.value,
);
const remainder = computed(() =>
	slash.value > 0 ? displayLabel.value.slice(slash.value + 1) : "",
);
</script>

<template>
	<span
		class="location-label"
		v-tip="tooltip ? tip : undefined"
		:aria-label="accessibleLabel"
		:tabindex="focusable ? 0 : undefined"
	>
		<span class="location-label-site">{{ site }}{{ remainder ? "/" : "" }}</span>
		<span v-if="remainder" class="location-label-tail" dir="rtl">
			<bdi>{{ remainder }}</bdi>
		</span>
	</span>
</template>
