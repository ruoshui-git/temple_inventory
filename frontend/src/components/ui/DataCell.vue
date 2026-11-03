<script setup lang="ts">
import { computed } from "vue";
import UnitText from "./UnitText.vue";
import type { DataColumn } from "../../lib/dataTable";
import { dataColumnKind } from "../../lib/dataTable";
import { formatSiteDateTime, formatSiteTime } from "../../lib/nativeTime";

// Default presentation of one browse cell by its column kind. DataTable keeps empty cells
// blank (emptyText ""); card and row layouts pass "—" so a missing value stays visible.
const props = withDefaults(
	defineProps<{ column: DataColumn; value: unknown; emptyText?: string }>(),
	{ emptyText: "" },
);
const kind = computed(() => dataColumnKind(props.column));
const empty = computed(
	() => props.value === null || props.value === undefined || props.value === "",
);
</script>

<template>
	<template v-if="empty && emptyText">{{ emptyText }}</template>
	<template v-else-if="kind === 'unit'"><UnitText :name="value" /></template>
	<template v-else-if="kind === 'datetime'">{{ formatSiteDateTime(value) }}</template>
	<template v-else-if="kind === 'time'">{{ formatSiteTime(value) }}</template>
	<template v-else>{{ value }}</template>
</template>
