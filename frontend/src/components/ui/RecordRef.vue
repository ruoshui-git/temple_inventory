<script setup lang="ts">
import InventoryIcon from "../InventoryIcon.vue";
import NativeStatusBadge from "./NativeStatusBadge.vue";

const props = withDefaults(
	defineProps<{
		kind: string;
		identity: string;
		count?: number;
		status?: string | number;
		documentName?: string;
		tooltip?: string;
		measureWord?: string;
		disabled?: boolean;
	}>(),
	{ measureWord: "笔" },
);
const emit = defineEmits<{ open: [] }>();
const icon: Record<string, string> = {
	Loan: "loan",
	Return: "return",
	Reconcile: "count",
	Activity: "activity",
	"Stock Reconciliation": "count",
};
const kindLabel: Record<string, string> = {
	Loan: "借出",
	Return: "归还",
	Reconcile: "盘点",
	Activity: "活动",
	"Stock Entry": "库存操作",
	"Stock Reconciliation": "库存盘点",
};
const label = () => {
	const kind = kindLabel[props.kind] || props.kind;
	const subject =
		props.count === undefined
			? props.identity
			: `${props.count} ${props.measureWord}${kind === "借出" ? "借出" : "记录"}`;
	return `${kind}记录 ${subject}`;
};
</script>

<template>
	<button
		type="button"
		class="record-ref-chip"
		:aria-label="label()"
		:title="tooltip || documentName || label()"
		:disabled="disabled"
		@click="emit('open')"
	>
		<InventoryIcon :name="icon[kind] || 'document'" />
		<span class="record-ref-main">
			<span>{{
				count === undefined
					? identity
					: `${count} ${measureWord}${(kindLabel[kind] || kind) === "借出" ? "借出" : "记录"}`
			}}</span>
			<small v-if="documentName">{{ documentName }}</small>
		</span>
		<NativeStatusBadge v-if="status !== undefined" :status="status" />
	</button>
</template>
