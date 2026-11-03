<script setup lang="ts">
import DataCell from "./DataCell.vue";
import Overlay from "./Overlay.vue";
import UiButton from "./UiButton.vue";
import type { DataColumn } from "../../lib/dataTable";

// Every field of one browse row in full, for values a card or 列表 row clamps or counts as 更多.
withDefaults(
	defineProps<{
		title: string;
		columns: DataColumn[];
		row: Record<string, unknown>;
		openLabel?: string;
	}>(),
	{ openLabel: "打开" },
);
const emit = defineEmits<{ close: []; open: [] }>();
</script>

<template>
	<Overlay :title="title" adaptive-creation @close="emit('close')">
		<dl class="row-fields-sheet">
			<div v-for="column in columns" :key="String(column.id)" class="row-fields-sheet-field">
				<dt>{{ column.label }}</dt>
				<dd>
					<slot name="cell" :column="column" :row="row" :value="row[String(column.id)]">
						<DataCell
							:column="column"
							:value="row[String(column.id)]"
							empty-text="—"
						/>
					</slot>
				</dd>
			</div>
		</dl>
		<template #footer>
			<UiButton variant="primary" @click="emit('open')">{{ openLabel }}</UiButton>
		</template>
	</Overlay>
</template>
