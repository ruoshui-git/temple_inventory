<script setup lang="ts">
import { computed } from "vue";
import DataCell from "../../components/ui/DataCell.vue";
import NativeStatusBadge from "../../components/ui/NativeStatusBadge.vue";
import UiButton from "../../components/ui/UiButton.vue";
import UnitValues from "../../components/ui/UnitValues.vue";
import type { DataColumn } from "../../lib/dataTable";
import type { RecoverySnapshot } from "../../lib/browserRecovery";
import { formatSiteDateTime, formatSiteTime, relativeTime } from "../../lib/nativeTime";
import { sortByUnit } from "../../lib/units";
import type { DraftRecordEntry } from "./nativeRecordColumns";
import type { NativeRecord } from "./useNativeRecords";
import { useReferenceData } from "../../services/contracts";
import { canOnDoctype } from "../../lib/capabilities";

// One cell of a 盘点记录 or 草稿 record, shared by the table and the 列表 rows. Actions
// leave through events so the page owns navigation, deletion and recovery.
const props = withDefaults(
	defineProps<{
		column: DataColumn;
		row: Record<string, unknown>;
		mode: "drafts" | "counts";
		timezone?: string;
		localSupported?: (entry: RecoverySnapshot) => boolean;
		emptyText?: string;
	}>(),
	{ emptyText: "" },
);
const emit = defineEmits<{
	open: [row: Record<string, unknown>];
	remove: [row: Record<string, unknown>];
	discard: [row: Record<string, unknown>];
}>();
const id = computed(() => String(props.column.id));
const native = computed(() => props.row as unknown as NativeRecord);
const entry = computed(() => props.row.entry as DraftRecordEntry | undefined);
const reference = useReferenceData();
const serverDoctype = computed(
	() => entry.value?.server?.doctype || String(props.row.doctype || ""),
);
const canDeleteNative = computed(() =>
	canOnDoctype(reference.capabilities, serverDoctype.value, "delete"),
);
const canEditNative = computed(() =>
	canOnDoctype(reference.capabilities, serverDoctype.value, "write"),
);
const aggregate = (key: "gains" | "losses" | "quantities") => {
	const values =
		(
			native.value.whole as typeof native.value.whole & {
				gains?: { uom: string; qty: number }[];
				losses?: { uom: string; qty: number }[];
			}
		)[key] || [];
	return sortByUnit(values, (value) => value.uom).map((value) => ({
		uom: value.uom,
		qty: Number(value.qty),
	}));
};
const activityLabel = computed(() => {
	const agreed = props.row.activity_title;
	// A Return's header holds only the borrower and activity its settled loans agree on.
	if (!agreed && props.row.kind === "Return") return "见原借用记录";
	return agreed || "—";
});
function draftDate(value: unknown) {
	return String(value || "");
}
</script>

<template>
	<button
		v-if="id === 'document' && mode === 'counts'"
		type="button"
		class="browse-row-link"
		@click="emit('open', row)"
	>
		<strong>{{ row.document }}</strong>
	</button>
	<button
		v-else-if="id === 'document' && entry"
		type="button"
		class="browse-row-link"
		@click="emit('open', row)"
	>
		{{ row.document }}
	</button>
	<NativeStatusBadge
		v-else-if="id === 'status' && mode === 'counts'"
		:status="Number(row.docstatus)"
	/>
	<span
		v-else-if="id === 'status' && entry"
		class="browse-badge"
		:class="entry.type === 'server' ? 'is-warning' : 'is-neutral'"
		>{{ row.status }}</span
	>
	<template v-else-if="id === 'count_kind'">{{
		row.kind === "Opening" ? "期初库存" : "盘点调整"
	}}</template>
	<template v-else-if="id === 'line_count'">{{ native.whole.line_count }}</template>
	<template v-else-if="id === 'item_count' && mode === 'counts'">{{
		native.whole.item_count
	}}</template>
	<UnitValues
		v-else-if="id === 'gains' && aggregate('gains').length"
		:entries="aggregate('gains')"
		label="增加"
		signed
	/>
	<UnitValues
		v-else-if="id === 'losses' && aggregate('losses').length"
		:entries="aggregate('losses')"
		label="减少"
		signed
	/>
	<UnitValues
		v-else-if="id === 'net' && aggregate('quantities').length"
		:entries="aggregate('quantities')"
		label="增加与减少相抵后的净值"
		signed
	/>
	<span v-else-if="['gains', 'losses', 'net'].includes(id)">—</span>
	<template v-else-if="id === 'activity_title'">{{ activityLabel }}</template>
	<template v-else-if="id === 'date' && mode === 'counts'"
		>{{ row.date }} {{ formatSiteTime(row.time) }}</template
	>
	<time
		v-else-if="id === 'date' && entry"
		:datetime="draftDate(row.date)"
		:title="formatSiteDateTime(draftDate(row.date), timezone)"
		>{{ relativeTime(draftDate(row.date)) }}</time
	>
	<span v-else-if="id === 'summary'" :title="String(row.summary || '')">{{ row.summary }}</span>
	<div v-else-if="id === 'actions' && entry" class="browse-row-actions">
		<UiButton
			v-if="entry.server"
			variant="secondary"
			size="compact"
			@click="emit('open', row)"
			>{{ canEditNative ? "继续编辑" : "查看" }}</UiButton
		>
		<UiButton
			v-else-if="entry.local && localSupported?.(entry.local)"
			variant="secondary"
			size="compact"
			@click="emit('open', row)"
			>继续编辑</UiButton
		>
		<UiButton
			v-if="entry.server?.docstatus === 0 && canDeleteNative"
			variant="danger"
			size="compact"
			@click="emit('remove', row)"
			>删除</UiButton
		>
		<UiButton
			v-else-if="entry.local"
			variant="danger"
			size="compact"
			@click="emit('discard', row)"
			>放弃</UiButton
		>
	</div>
	<DataCell v-else :column="column" :value="row[id]" :empty-text="emptyText" />
</template>
