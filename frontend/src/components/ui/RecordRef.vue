<script setup lang="ts">
import InventoryIcon from "../InventoryIcon.vue";
import NativeStatusBadge from "./NativeStatusBadge.vue";
import { kindIcons } from "../../lib/kindIcons";

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
	...Object.fromEntries(Object.entries(kindIcons).map(([key, value]) => [key, value.icon])),
	Activity: "activity",
	"Stock Reconciliation": kindIcons.Reconcile.icon,
};
const kindLabel: Record<string, string> = {
	...Object.fromEntries(Object.entries(kindIcons).map(([key, value]) => [key, value.label])),
	Loan: kindIcons.Loan.label,
	Return: kindIcons.Return.label,
	Reconcile: kindIcons.Reconcile.label,
	Activity: "活动",
	"Stock Entry": "库存操作",
	"Stock Reconciliation": kindIcons.Reconcile.label,
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
		:title="documentName || tooltip || label()"
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
		</span>
		<NativeStatusBadge v-if="status !== undefined" :status="status" />
	</button>
</template>
