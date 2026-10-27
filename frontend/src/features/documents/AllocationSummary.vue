<script setup lang="ts">
import { warehouseLabel, warehousePath } from "../../lib/warehouseLabel";
import { unitLabel, sortByUnit } from "../../lib/units";
import { computed, ref } from "vue";
import { enteredQty } from "../../lib/quantityConversion";
import {
	useOperationContext,
	allocationDestination,
	operationSectionLocation,
	type OperationDraft,
	type AllocationLine,
} from "./operationModel";
import { useReferenceData } from "../../services/contracts";
import ItemLine from "../../components/ui/ItemLine.vue";
import DisclosureSection from "../../components/ui/DisclosureSection.vue";
import LocationEndpoint from "../../components/ui/LocationEndpoint.vue";
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
	return sortByUnit([...values], ([uom]) => uom)
		.map(([uom, qty]) => `${qty} ${unitLabel(uom)}`)
		.join(" · ");
}
const groups = computed(() => {
	const result = new Map<string, AllocationLine[]>();
	for (const line of props.draft.items) {
		const place = operationSectionLocation(props.draft.kind, line) || "未选择库位";
		if (!result.has(place)) result.set(place, []);
		result.get(place)!.push(line);
	}
	return [...result.entries()];
});
</script>

<template>
	<div class="review-list preview-allocation-summary">
		<component
			:is="collapsible ? DisclosureSection : 'section'"
			v-for="[place, lines] in groups"
			:key="place"
			:title="warehouseLabel(place, reference.warehouses)"
			:count="
				collapsible ? `${new Set(lines.map((line) => line.code)).size} 种物品` : undefined
			"
			:summary="collapsible ? `${lines.length} 条明细 · ${totals(lines)}` : undefined"
			:open="collapsible ? isOpen(place) : undefined"
			@update:open="choices[place] = $event"
		>
			<strong v-if="!collapsible" :title="warehousePath(place, reference.warehouses)"
				>{{ warehouseLabel(place, reference.warehouses) }} ·
				{{ new Set(lines.map((line) => line.code)).size }} 种物品 ·
				{{ lines.length }} 条明细 · {{ totals(lines) }}</strong
			>
			<div
				v-for="line in lines"
				:key="line.id"
				class="allocation-summary-entry"
				:data-summary-line-id="line.id"
			>
				<div class="allocation-summary-copy">
					<div class="allocation-summary-identity">
						<ItemLine :item="itemIdentity(line)" :size="24">
							<template #secondary>{{ line.code }}</template>
						</ItemLine>
						<span class="allocation-summary-quantity"
							>· {{ line.qty }} {{ unitLabel(line.uom) }}</span
						>
					</div>
					<dl class="ti-fields allocation-summary-fields">
						<div v-if="allocationDestination(draft, line, reference.damagedLeaves)">
							<dt>来源 → 去向</dt>
							<dd>
								<LocationEndpoint
									:warehouse="
										draft.kind === 'Receive'
											? ''
											: line.sourceLocation || line.location
									"
									:kind="draft.kind"
									role="来源位置"
								/>
								→
								<LocationEndpoint
									:warehouse="
										allocationDestination(draft, line, reference.damagedLeaves)
									"
									:kind="draft.kind"
									role="去向位置"
								/>
							</dd>
						</div>
						<div v-if="tracksBatch(line)">
							<dt>批次</dt>
							<dd>
								{{
									line.batch ||
									line.batchAllocations
										?.map(
											(allocation) =>
												`${allocation.batch} ${allocation.qty} ${unitLabel(line.uom)}${allocation.expiry ? ` · 到期 ${allocation.expiry}` : ""}`,
										)
										.join(" · ") ||
									(draft.kind === "Receive" &&
									draft.status === "draft" &&
									!line.nativeBundle
										? "自动生成"
										: "未记录")
								}}
							</dd>
						</div>
						<div v-if="tracksExpiry(line) && !line.batchAllocations?.length">
							<dt>到期</dt>
							<dd>{{ line.expiry || "未设置" }}</dd>
						</div>
						<div
							v-if="
								line.entryUom &&
								line.entryUom !== line.uom &&
								Number(line.conversionFactor || 1) !== 1
							"
						>
							<dt>换算</dt>
							<dd>
								{{ enteredQuantity(line) }} {{ unitLabel(line.entryUom) }} ×
								{{ line.conversionFactor }} {{ unitLabel(line.uom) }}/{{
									unitLabel(line.entryUom)
								}}
								= {{ line.qty }} {{ unitLabel(line.uom) }}
							</dd>
						</div>
						<div v-if="line.loanName || draft.loanName">
							<dt>原借出</dt>
							<dd>{{ line.loanName || draft.loanName }}</dd>
						</div>
						<div v-if="line.returnOutcome">
							<dt>处理结果</dt>
							<dd>
								{{
									line.returnOutcome === "lost"
										? "遗失"
										: line.returnOutcome === "damaged"
											? "损坏归还"
											: "完好归还"
								}}
							</dd>
						</div>
						<div v-if="line.manufacturingDate">
							<dt>生产日期</dt>
							<dd>{{ line.manufacturingDate }}</dd>
						</div>
						<div v-if="line.reason">
							<dt>原因</dt>
							<dd>{{ line.reason }}</dd>
						</div>
					</dl>
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
	grid-template-columns: minmax(0, 1fr);
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
.allocation-summary-quantity {
	white-space: nowrap;
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
</style>
