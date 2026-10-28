<script setup lang="ts">
import { computed } from "vue";
import { formatQuantityWithUnit } from "../../lib/formatQuantity";
import { unitLabel } from "../../lib/units";

const props = defineProps<{ name: unknown; qty?: number | string }>();
const label = computed(() => unitLabel(props.name));
const nativeName = computed(() => {
	const name =
		props.name && typeof props.name === "object" && "name" in props.name
			? String((props.name as { name: unknown }).name || "")
			: String(props.name || "");
	return name && name !== label.value ? name : undefined;
});
</script>

<template>
	<span :title="nativeName">{{
		qty === undefined ? label : formatQuantityWithUnit(Number(qty), props.name)
	}}</span>
</template>
