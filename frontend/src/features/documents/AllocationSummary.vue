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
import ItemImage from "../../components/ItemImage.vue";
const context = useOperationContext();
const reference = useReferenceData();

const props = defineProps<{ draft: OperationDraft; collapsible?: boolean }>();
const item = (code: string) => context.stock.find((row) => row.code === code);
function itemIdentity(line: AllocationLine) {
	const current = item(line.code);
	return {
		code: line.code,
		name: current?.name || line.displayName || line.code,
		image: current?.image || line.displayImage || "",
		files: current?.files,
	};
}
const tracksBatch = (line: AllocationLine) =>
	item(line.code)?.tracksBatch ?? line.displayTracksBatch ?? false;
const tracksExpiry = (line: AllocationLine) =>
	item(line.code)?.tracksExpiry ?? line.displayTracksExpiry ?? false;
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
			<div
				v-for="line in lines"
				:key="line.id"
				class="allocation-summary-entry"
				:data-summary-line-id="line.id"
			>
				<span class="allocation-summary-image"
					><ItemImage :item="itemIdentity(line)" :thumbnail-size="24" :target-size="24"
				/></span>
				<div class="allocation-summary-copy">
					<div class="allocation-summary-identity">
						<strong>{{
							item(line.code)?.name || line.displayName || line.code
						}}</strong>
						<span>· {{ line.qty }} {{ line.uom }}</span>
					</div>
					<small class="muted">
						{{ line.code }}
						<template
							v-if="allocationDestination(draft, line, reference.damagedLeaves)"
						>
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
						<template v-if="tracksBatch(line)">
							<template v-if="line.batch">· 批次 {{ line.batch }}</template>
							<template v-else-if="line.batchAllocations?.length">
								<span
									v-for="allocation in line.batchAllocations"
									:key="allocation.name"
									:data-native-batch-line="allocation.name"
								>
									· 批次 {{ allocation.batch }} {{ allocation.qty }}
									{{ line.uom }}
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
						<template v-if="tracksExpiry(line) && !line.batchAllocations?.length">
							· 到期 {{ line.expiry || "未设置" }}</template
						>
						<template v-if="line.entryUom">
							· 输入 {{ enteredQuantity(line) }} {{ line.entryUom }} · 1
							{{ line.entryUom }} = {{ line.conversionFactor }}
							{{ line.uom }}</template
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
				</div>
			</div>
		</component>
	</div>
</template>

<style scoped>
.preview-allocation-summary {
	display: grid;
	gap: var(--p-space-3);
	min-width: 0;
}
.preview-allocation-summary .allocation-summary-entry {
	display: grid;
	grid-template-columns: 24px minmax(0, 1fr);
	align-items: start;
	column-gap: var(--p-space-2);
	margin: var(--p-space-2) 0;
	overflow-wrap: anywhere;
}
.allocation-summary-identity {
	display: flex;
	min-width: 0;
	align-items: baseline;
	gap: 4px;
}
.allocation-summary-image {
	display: grid;
	grid-row: 1 / 3;
	width: 24px;
	height: 24px;
	flex: 0 0 24px;
	place-items: center;
}
.allocation-summary-image :deep(.async-image) {
	width: 24px;
	height: 24px;
	min-height: 0;
}
.allocation-summary-copy {
	display: contents;
}
.allocation-summary-copy,
.allocation-summary-identity > * {
	min-width: 0;
	overflow-wrap: anywhere;
}
.preview-allocation-summary small {
	display: block;
}
@media (max-width: 1023px), (pointer: coarse) {
	.preview-allocation-summary .allocation-summary-entry {
		grid-template-columns: 44px minmax(0, 1fr);
	}
	.allocation-summary-image {
		width: 44px;
		height: 100%;
		min-height: 44px;
	}
	.allocation-summary-image :deep(.item-image-button--compact-target) {
		width: 44px !important;
		height: 44px !important;
		min-height: 44px;
	}
}
</style>
