<script setup lang="ts">
import { computed } from "vue";
import { useOptionalReferenceData } from "../../services/contracts";
import { warehouseLabel, warehousePath } from "../../lib/warehouseLabel";
import InventoryIcon from "../InventoryIcon.vue";
import { kindIcons } from "../../lib/kindIcons";

const props = defineProps<{
	warehouse?: string | null;
	locations?: string[];
	kind: string;
	borrower?: string;
	role?: "来源位置" | "去向位置";
}>();
const reference = useOptionalReferenceData();
const node = computed(() => reference?.warehouses.find((entry) => entry.name === props.warehouse));
const countAdjustmentLocations = computed(() => [
	...new Set([...(props.locations || []), props.warehouse || ""].filter(Boolean)),
]);
const endpoint = computed(() => {
	if (props.kind === "Reconcile" || props.kind === "Stock Reconciliation") {
		if (props.role === "去向位置")
			return {
				label: "—",
				icon: "",
				className: "is-location",
				detail: "盘点调整不表示库外去向",
			};
		const warehouses = countAdjustmentLocations.value;
		if (!warehouses.length)
			return {
				label: "—",
				icon: "",
				className: "is-location",
				detail: "没有盘点位置",
			};
		return {
			label: warehouses
				.map((name) => warehouseLabel(name, reference?.warehouses || [], name))
				.join(" · "),
			icon: "",
			className: "is-location",
			detail: warehouses
				.map((name) => warehousePath(name, reference?.warehouses || [], name))
				.join("、"),
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
		detail: warehousePath(props.warehouse, reference?.warehouses || [], props.warehouse),
	};
});
const ariaLabel = computed(
	() =>
		`${props.kind === "Reconcile" || props.kind === "Stock Reconciliation" ? "盘点位置" : props.role || "位置"} ${endpoint.value.label}${endpoint.value.detail && endpoint.value.label !== endpoint.value.detail ? `，${endpoint.value.detail}` : ""}`,
);
</script>

<template>
	<span
		class="location-endpoint"
		:class="endpoint.className"
		:title="endpoint.detail"
		:aria-label="ariaLabel"
	>
		<InventoryIcon v-if="endpoint.icon" :name="endpoint.icon" />
		<span>{{ endpoint.label }}</span>
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
