<script setup lang="ts">
import { computed } from "vue";
import { vTip } from "../../directives/tip";
import { useOptionalReferenceData } from "../../services/contracts";
import { warehouseLabel, warehouseName } from "../../lib/warehouseLabel";
import InventoryIcon from "../InventoryIcon.vue";
import LocationLabel from "./LocationLabel.vue";
import { kindIcons } from "../../lib/kindIcons";

const props = withDefaults(
	defineProps<{
		warehouse?: string | null;
		kind: string;
		borrower?: string;
		role?: "来源位置" | "去向位置";
		tooltip?: boolean;
	}>(),
	{ tooltip: true },
);
const reference = useOptionalReferenceData();
const endpoint = computed(() => {
	if (props.kind === "Reconcile" || props.kind === "Stock Reconciliation") {
		if (props.role === "去向位置")
			return {
				label: "—",
				icon: "",
				className: "is-location",
				detail: "盘点调整不表示库外去向",
			};
		if (!props.warehouse)
			return {
				label: "—",
				icon: "",
				className: "is-location",
				detail: "没有盘点位置",
			};
		return {
			label: warehouseLabel(props.warehouse, reference?.warehouses || [], props.warehouse),
			icon: "",
			className: "is-location",
			detail: warehouseName(props.warehouse, reference?.warehouses || []),
		};
	}
	const settings = reference?.settings || {};
	if (props.warehouse && props.warehouse === settings.leased_warehouse)
		return {
			label: "借出",
			icon: kindIcons.Loan.icon,
			className: "is-muted",
			detail: props.borrower ? `借用方：${props.borrower}` : "借出位置",
		};
	if (props.warehouse && props.warehouse === settings.damaged_warehouse)
		return {
			label: "损坏待处理",
			icon: "warning",
			className: "is-warning",
			detail: "损坏待处理位置",
		};
	if (!props.warehouse) {
		const labels: Record<string, string> = {
			Receive: "来自库外",
			Issue: "离开库存",
			Loss: "不再计入库存",
			Disposal: "已报废处理",
		};
		return {
			label: "外部",
			icon: "outside",
			className: "is-muted",
			detail: labels[props.kind] || "库外",
		};
	}
	return {
		label: warehouseLabel(props.warehouse, reference?.warehouses || [], props.warehouse),
		icon: "",
		className: "is-location",
		detail: warehouseName(props.warehouse, reference?.warehouses || []),
	};
});
const title = computed(() =>
	endpoint.value.className === "is-location"
		? [endpoint.value.label, endpoint.value.detail].filter(Boolean).join(" · ")
		: endpoint.value.detail,
);
const ariaLabel = computed(
	() =>
		`${props.kind === "Reconcile" || props.kind === "Stock Reconciliation" ? "盘点位置" : props.role || "位置"} ${endpoint.value.label}${endpoint.value.detail && endpoint.value.label !== endpoint.value.detail ? `，${endpoint.value.detail}` : ""}`,
);
</script>

<template>
	<span
		class="location-endpoint"
		:class="endpoint.className"
		v-tip="tooltip && endpoint.className !== 'is-location' ? title : undefined"
		:tabindex="tooltip && endpoint.className !== 'is-location' ? 0 : undefined"
		:aria-label="ariaLabel"
	>
		<InventoryIcon v-if="endpoint.icon" :name="endpoint.icon" />
		<LocationLabel
			v-if="endpoint.className === 'is-location'"
			:label="endpoint.label"
			:title="title"
			:warehouse="endpoint.label === '—' ? undefined : warehouse"
			:tooltip="tooltip"
		/>
		<span v-else>{{ endpoint.label }}</span>
	</span>
</template>

<style scoped>
.location-endpoint {
	display: inline-flex;
	align-items: center;
	vertical-align: baseline;
}
.location-endpoint :deep(svg) {
	width: 16px;
	height: 16px;
	flex: none;
	vertical-align: middle;
}
.location-endpoint > span {
	line-height: 1.4;
}
</style>
