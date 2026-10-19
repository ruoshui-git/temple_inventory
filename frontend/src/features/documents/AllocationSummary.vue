<script setup lang="ts">
import { warehouseLabel } from "../../lib/warehouseLabel";
import { computed, ref } from "vue";
import { enteredQty } from "../../lib/quantityConversion";
import {
	useOperationContext,
	allocationDestination,
	type OperationDraft,
	type AllocationLine,
} from "./operationModel";
import { useReferenceData } from "../../services/contracts";
const context = useOperationContext();
const reference = useReferenceData();

const props = defineProps<{ draft: OperationDraft; collapsible?: boolean }>();
const item = (code: string) => context.stock.find((row) => row.code === code);
const enteredQuantity = enteredQty;
const choices = ref<Record<string, boolean>>({});
function isOpen(place: string) {
	return choices.value[place] ?? (groups.value.length === 1 && props.draft.items.length <= 5);
}
function totals(lines: AllocationLine[]) {
	const values = new Map<string, number>();
	lines.forEach((line) =>
		values.set(line.uom, (values.get(line.uom) || 0) + Number(line.qty || 0)),
	);
	return [...values].map(([uom, qty]) => `${qty} ${uom}`).join(" · ");
}
const groups = computed(() => {
	const result = new Map<string, AllocationLine[]>();
	for (const line of props.draft.items) {
		const place = line.sourceLocation || line.location || "未选择库位";
		if (!result.has(place)) result.set(place, []);
		result.get(place)!.push(line);
	}
	return [...result.entries()];
});
</script>

<template>
	<div class="review-list preview-allocation-summary">
		<component
			:is="collapsible ? 'details' : 'section'"
			v-for="[place, lines] in groups"
			:key="place"
			:open="collapsible ? isOpen(place) : undefined"
		>
			<component
				:is="collapsible ? 'summary' : 'strong'"
				@click="
					collapsible && ($event.preventDefault(), (choices[place] = !isOpen(place)))
				"
				>{{ warehouseLabel(place, reference.warehouses) }} ·
				{{ new Set(lines.map((line) => line.code)).size }} 种物品 ·
				{{ lines.length }} 条明细 · {{ totals(lines) }}</component
			>
			<p v-for="line in lines" :key="line.id" :data-summary-line-id="line.id">
				{{ item(line.code)?.name || line.code }} · {{ line.qty }} {{ line.uom }}
				<small class="muted">
					{{ line.code }}
					<template v-if="allocationDestination(draft, line, reference.damagedLeaves)">
						·
						{{
							draft.kind === "Receive"
								? "入库"
								: warehouseLabel(
										line.sourceLocation || line.location,
										reference.warehouses,
									)
						}}
						→
						{{
							warehouseLabel(
								allocationDestination(draft, line, reference.damagedLeaves),
								reference.warehouses,
							)
						}}
					</template>
					<template v-if="item(line.code)?.tracksBatch">
						<template v-if="line.batch">· 批次 {{ line.batch }}</template>
						<template v-else-if="line.batchAllocations?.length">
							<span
								v-for="allocation in line.batchAllocations"
								:key="allocation.name"
								:data-native-batch-line="allocation.name"
							>
								· 批次 {{ allocation.batch }} {{ allocation.qty }} {{ line.uom }}
								<template v-if="allocation.expiry">
									· 到期 {{ allocation.expiry }}</template
								>
							</span>
							· 原生批次组合 {{ line.recordedBundle || line.nativeBundle }}
						</template>
						<template v-else
							>· 批次
							{{
								draft.kind === "Receive" &&
								draft.status === "draft" &&
								!line.nativeBundle
									? "自动生成"
									: "未记录"
							}}</template
						>
					</template>
					<template
						v-if="item(line.code)?.tracksExpiry && !line.batchAllocations?.length"
					>
						· 到期 {{ line.expiry || "未设置" }}</template
					>
					<template v-if="line.entryUom">
						· 输入 {{ enteredQuantity(line) }} {{ line.entryUom }} · 1
						{{ line.entryUom }} = {{ line.conversionFactor }} {{ line.uom }}</template
					>
					<template v-if="line.loanName || draft.loanName">
						· 借出 {{ line.loanName || draft.loanName }}
					</template>
					<template v-if="line.returnOutcome">
						·
						{{
							line.returnOutcome === "lost"
								? "遗失"
								: line.returnOutcome === "damaged"
									? "损坏归还"
									: "完好归还"
						}}</template
					>
					<template v-if="line.manufacturingDate">
						· 生产 {{ line.manufacturingDate }}</template
					>
					<template v-if="line.reason"> · 原因 {{ line.reason }}</template>
				</small>
			</p>
		</component>
	</div>
</template>

<style scoped>
.preview-allocation-summary {
	display: grid;
	gap: var(--p-space-3);
	min-width: 0;
}
.preview-allocation-summary p {
	margin: var(--p-space-2) 0;
	overflow-wrap: anywhere;
}
.preview-allocation-summary small {
	display: block;
}
</style>
