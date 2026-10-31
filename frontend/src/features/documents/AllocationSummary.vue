<script setup lang="ts">
import { computed, ref } from "vue";
import { RouterLink } from "vue-router";
import DataTable from "../../components/ui/DataTable.vue";
import ItemImage from "../../components/ItemImage.vue";
import LocationEndpoint from "../../components/ui/LocationEndpoint.vue";
import UnitText from "../../components/ui/UnitText.vue";
import { formatQuantity, formatQuantityWithUnit } from "../../lib/formatQuantity";
import { formatConversion } from "../../lib/conversionText";
import type { DataColumn, DataTableEntry, DataTableGroup } from "../../lib/dataTable";
import { routeTarget } from "../../lib/routeRegistry";
import { sortByUnit, unitLabel } from "../../lib/units";
import { warehouseLabel, warehousePath } from "../../lib/warehouseLabel";
import { useResponsiveLayout } from "../../composables/useResponsiveLayout";
import { enteredQty } from "../../lib/quantityConversion";
import {
	useOperationContext,
	operationSectionLocation,
	type OperationDraft,
	type AllocationLine,
} from "./operationModel";
import { useReferenceData } from "../../services/contracts";

const context = useOperationContext();
const reference = useReferenceData();
const { isMobile } = useResponsiveLayout();
const props = withDefaults(
	defineProps<{ draft: OperationDraft; collapsible?: boolean; linkItems?: boolean }>(),
	{ linkItems: true },
);
type AllocationRow = Record<string, unknown> & {
	line?: AllocationLine;
	place?: string;
};
const expanded = ref(new Set<string>());
const item = (code: string) => context.stock.find((row) => row.code === code);
function lineBatch(line: AllocationLine) {
	return (
		line.batch ||
		line.batchAllocations
			?.map((allocation) => allocation.batch)
			.filter(Boolean)
			.join(" · ") ||
		(props.draft.kind === "Receive" && props.draft.status === "draft" && !line.nativeBundle
			? "自动生成"
			: "")
	);
}
function batchIds(line: AllocationLine) {
	const ids = line.batchAllocations?.map((allocation) => allocation.batch).filter(Boolean) || [];
	if (ids.length) return [...new Set(ids)];
	return line.batch ? [line.batch] : [];
}
function lineExpiry(line: AllocationLine) {
	return (
		line.expiry ||
		line.batchAllocations
			?.map((allocation) => allocation.expiry)
			.filter(Boolean)
			.join(" · ") ||
		""
	);
}
function lineManufacturingDate(line: AllocationLine) {
	return (
		line.manufacturingDate ||
		line.batchAllocations
			?.map((allocation) => allocation.manufacturingDate)
			.filter(Boolean)
			.join(" · ") ||
		""
	);
}
function stockUnit(line: AllocationLine) {
	return String(
		line.nativeFields?.stock_uom || line.uom || item(line.code)?.uom || line.entryUom || "",
	);
}
function totals(lines: AllocationLine[]) {
	const values = new Map<string, number>();
	lines.forEach((line) => {
		const uom = stockUnit(line);
		values.set(uom, (values.get(uom) || 0) + Number(line.qty || 0));
	});
	return sortByUnit([...values], ([uom]) => uom)
		.map(([uom, qty]) => formatQuantityWithUnit(qty, uom))
		.join(" · ");
}
const sections = computed(() => {
	const result = new Map<string, AllocationLine[]>();
	for (const line of props.draft.items) {
		const place = operationSectionLocation(props.draft.kind, line) || "未选择库位";
		if (!result.has(place)) result.set(place, []);
		result.get(place)!.push(line);
	}
	return [...result.entries()];
});
const columns = computed<DataColumn[]>(() => {
	const lines = props.draft.items;
	const list: DataColumn[] = [
		{ id: "image", label: "", kind: "thumb", defaultVisible: true, required: true },
		{ id: "item_name", label: "物品", kind: "primary", defaultVisible: true, required: true },
		{ id: "quantity", label: "数量", kind: "number", defaultVisible: true, required: true },
	];
	if (lines.some((line) => lineBatch(line)))
		list.splice(2, 0, { id: "batch", label: "批次", kind: "code", defaultVisible: true });
	if (lines.some((line) => lineExpiry(line)))
		list.splice(3, 0, { id: "expiry", label: "效期", kind: "date", defaultVisible: true });
	if (lines.some((line) => lineManufacturingDate(line)))
		list.splice(
			list.findIndex((column) => column.id === "quantity"),
			0,
			{
				id: "manufacturing_date",
				label: "生产日期",
				kind: "date",
				defaultVisible: true,
			},
		);
	if (props.draft.kind === "Transfer" && lines.some((line) => line.location))
		list.push({ id: "destination", label: "调入", kind: "text", defaultVisible: true });
	if (lines.some((line) => line.loanName || props.draft.loanName))
		list.push({ id: "original_loan", label: "原借出", kind: "code", defaultVisible: true });
	if (lines.some((line) => line.returnOutcome))
		list.push({ id: "outcome", label: "处理结果", kind: "status", defaultVisible: true });
	if (lines.some((line) => line.reason))
		list.push({ id: "reason", label: "原因", kind: "text", defaultVisible: true });
	if (lines.some((line) => line.note || line.allocationNote))
		list.push({ id: "note", label: "备注", kind: "text", defaultVisible: true });
	return list;
});
const tableRows = computed<DataTableEntry<AllocationRow>[]>(() => {
	const result: DataTableEntry<AllocationRow>[] = [];
	for (const [place, lines] of sections.value) {
		const id = `location:${place}`;
		const isExpanded = !expanded.value.has(id);
		result.push({
			kind: "group",
			id,
			label: warehouseLabel(place, reference.warehouses),
			labelColumn: "item_name",
			countColumn: "item_name",
			depth: 0,
			count: new Set(lines.map((line) => line.code)).size,
			countLabel: "种物品",
			expanded: isExpanded,
			hasChildren: lines.length > 0,
			value: { place },
		});
		if (!isExpanded) continue;
		for (const line of lines) {
			const current = item(line.code);
			result.push({
				kind: "record",
				id: line.id,
				value: {
					line,
					code: line.code,
					item_name: current?.name || line.displayName || line.code,
					image: current?.image || line.displayImage || "",
					batch: lineBatch(line),
					batch_name: line.batch || line.batchAllocations?.[0]?.batch || "",
					expiry: lineExpiry(line),
					manufacturing_date: lineManufacturingDate(line),
					quantity: enteredQty(line),
				},
			});
		}
	}
	return result;
});
function toggleGroup(groupId: string) {
	const next = new Set(expanded.value);
	if (next.has(groupId)) next.delete(groupId);
	else next.add(groupId);
	expanded.value = next;
}
function groupLines(group: DataTableGroup) {
	const place = String(group.value?.place || "");
	return sections.value.find(([location]) => location === place)?.[1] || [];
}
function phoneDetails(line: AllocationLine) {
	const hasBatchAllocations = Boolean(line.batchAllocations?.length);
	const details = hasBatchAllocations ? [] : batchIds(line);
	if (!hasBatchAllocations && !details.length && lineBatch(line)) details.push(lineBatch(line));
	const expiry = hasBatchAllocations ? "" : lineExpiry(line);
	if (expiry) details.push(`效期 ${expiry}`);
	const manufacturingDate = lineManufacturingDate(line);
	if (manufacturingDate) details.push(`生产 ${manufacturingDate}`);
	if (props.draft.kind === "Transfer" && line.location)
		details.push(`调入 ${warehouseLabel(line.location, reference.warehouses)}`);
	if (line.loanName || props.draft.loanName)
		details.push(`原借出 ${line.loanName || props.draft.loanName}`);
	if (line.returnOutcome)
		details.push(
			line.returnOutcome === "lost"
				? "遗失"
				: line.returnOutcome === "damaged"
					? "损坏归还"
					: "完好归还",
		);
	if (line.reason) details.push(`原因 ${line.reason}`);
	if (line.note || line.allocationNote) details.push(`备注 ${line.note || line.allocationNote}`);
	return details;
}
function quantityText(line: AllocationLine) {
	const enteredUnit = line.entryUom || line.uom;
	return (
		formatConversion({
			qty: enteredQty(line),
			uom: enteredUnit,
			factor: Number(line.conversionFactor || 1),
			stockUom: line.uom,
		}) || formatQuantityWithUnit(enteredQty(line), enteredUnit)
	);
}
function lineFor(row: Record<string, unknown>) {
	return row.line as AllocationLine;
}
function itemFor(row: Record<string, unknown>) {
	const code = String(row.code || "");
	return {
		code,
		name: String(row.item_name || code),
		image: String(row.image || ""),
		files: item(code)?.files,
	};
}
</script>

<template>
	<div v-if="isMobile" class="allocation-phone-list" aria-label="单据物品明细">
		<section v-for="[place, lines] in sections" :key="place" class="allocation-phone-group">
			<button
				type="button"
				class="allocation-phone-group-toggle"
				:aria-expanded="!expanded.has(`location:${place}`)"
				@click="toggleGroup(`location:${place}`)"
			>
				<span class="allocation-phone-group-heading">
					<strong :title="warehousePath(place, reference.warehouses)">{{
						warehouseLabel(place, reference.warehouses)
					}}</strong>
					<span
						>{{ new Set(lines.map((line) => line.code)).size }} 种物品 ·
						{{ lines.length }} 条明细 · {{ totals(lines) }}</span
					>
				</span>
				<span class="allocation-phone-chevron" aria-hidden="true">{{
					expanded.has(`location:${place}`) ? "›" : "⌄"
				}}</span>
			</button>
			<div v-if="!expanded.has(`location:${place}`)" class="allocation-phone-rows">
				<article v-for="line in lines" :key="line.id" class="allocation-phone-row">
					<ItemImage
						:item="{
							code: line.code,
							name: item(line.code)?.name || line.displayName || line.code,
							image: item(line.code)?.image || line.displayImage || '',
							files: item(line.code)?.files,
						}"
						:thumbnail-size="48"
						:target-size="48"
					/>
					<div class="allocation-phone-copy">
						<div class="allocation-phone-primary">
							<RouterLink
								v-if="linkItems"
								class="allocation-item-link"
								:title="item(line.code)?.name || line.displayName || line.code"
								:to="routeTarget('item-detail', { code: line.code })"
								>{{
									item(line.code)?.name || line.displayName || line.code
								}}</RouterLink
							>
							<span
								v-else
								class="allocation-item-name"
								:title="item(line.code)?.name || line.displayName || line.code"
								>{{ item(line.code)?.name || line.displayName || line.code }}</span
							>
							<strong class="allocation-phone-quantity">{{
								quantityText(line)
							}}</strong>
						</div>
						<div
							v-if="line.batchAllocations?.length || phoneDetails(line).length"
							class="allocation-phone-meta"
						>
							<div
								v-for="allocation in line.batchAllocations"
								:key="allocation.name || allocation.batch"
								class="allocation-batch-entry"
							>
								<RouterLink
									v-if="allocation.batch"
									:to="routeTarget('batch-detail', { name: allocation.batch })"
									>{{ allocation.batch }}</RouterLink
								>
								<span v-else>无批次</span>
								<span> · </span>
								<UnitText :name="line.uom" :qty="Number(allocation.qty || 0)" />
								<span v-if="allocation.expiry"> · {{ allocation.expiry }}</span>
							</div>
							<template
								v-for="(detail, index) in phoneDetails(line)"
								:key="`${line.id}:${detail}`"
							>
								<span v-if="index"> · </span>
								<RouterLink
									v-if="batchIds(line).includes(detail)"
									:to="routeTarget('batch-detail', { name: detail })"
									>{{ detail }}</RouterLink
								>
								<span v-else>{{ detail }}</span>
							</template>
						</div>
					</div>
				</article>
			</div>
		</section>
	</div>
	<DataTable
		v-else
		:class="['allocation-summary-table', { 'is-collapsible': collapsible }]"
		ariaLabel="单据物品明细"
		:columns="columns"
		:rows="tableRows"
		:compact="collapsible"
		empty-text="没有物品明细"
		@toggle-group="toggleGroup"
	>
		<template #group-metrics="{ group }">
			<span class="allocation-group-metrics">
				<span>{{ group.count }} 种物品</span>
				<span class="allocation-group-separator"> · </span>
				<span>{{ groupLines(group).length }} 条明细</span>
				<span class="allocation-group-separator"> · </span>
				<span>{{ totals(groupLines(group)) }}</span>
			</span>
		</template>
		<template #cell="{ column, row }">
			<template v-if="column.id === 'image'">
				<ItemImage
					:item="{
						...itemFor(row),
					}"
					:thumbnail-size="32"
					:target-size="32"
				/>
			</template>
			<RouterLink
				v-else-if="column.id === 'item_name' && linkItems"
				class="allocation-item-link"
				:title="String(row.item_name || '')"
				:to="routeTarget('item-detail', { code: String(row.code || '') })"
				>{{ String(row.item_name || "") }}</RouterLink
			>
			<span v-else-if="column.id === 'item_name'" class="allocation-item-name">{{
				String(row.item_name || "")
			}}</span>
			<template v-else-if="column.id === 'batch'">
				<template v-if="lineFor(row).batchAllocations?.length">
					<span
						v-for="allocation in lineFor(row).batchAllocations"
						:key="allocation.name || allocation.batch"
						class="allocation-batch-entry"
					>
						<RouterLink
							v-if="allocation.batch"
							class="allocation-batch-link"
							:to="routeTarget('batch-detail', { name: allocation.batch })"
							>{{ allocation.batch }}</RouterLink
						>
						<span v-else>无批次</span>
						<span> · </span>
						<UnitText :name="lineFor(row).uom" :qty="Number(allocation.qty || 0)" />
					</span>
				</template>
				<RouterLink
					v-else-if="row.batch_name"
					class="allocation-batch-link"
					:to="routeTarget('batch-detail', { name: String(row.batch_name) })"
					>{{ String(row.batch) }}</RouterLink
				>
				<template v-else>{{ String(row.batch || "") }}</template>
			</template>
			<template v-else-if="column.id === 'expiry' && lineFor(row).batchAllocations?.length">
				<span
					v-for="allocation in lineFor(row).batchAllocations"
					:key="allocation.name || allocation.batch"
					class="allocation-expiry-entry"
					>{{ allocation.expiry || lineFor(row).expiry || "—" }}</span
				>
			</template>
			<template v-else-if="column.id === 'quantity'">
				<span class="allocation-quantity">{{ quantityText(lineFor(row)) }}</span>
			</template>
			<template v-else-if="column.id === 'destination'">
				<LocationEndpoint
					:warehouse="lineFor(row).location"
					kind="Transfer"
					role="去向位置"
				/>
			</template>
			<template v-else-if="column.id === 'original_loan'">{{
				lineFor(row).loanName || draft.loanName
			}}</template>
			<template v-else-if="column.id === 'outcome'">
				{{
					lineFor(row).returnOutcome === "lost"
						? "遗失"
						: lineFor(row).returnOutcome === "damaged"
							? "损坏归还"
							: "完好归还"
				}}
			</template>
			<template v-else-if="column.id === 'reason'">{{ lineFor(row).reason }}</template>
			<template v-else-if="column.id === 'note'">{{
				lineFor(row).note || lineFor(row).allocationNote
			}}</template>
		</template>
	</DataTable>
</template>

<style scoped>
.allocation-summary-table {
	min-width: 0;
}
.allocation-group-metrics {
	display: inline-flex;
	max-width: 100%;
	flex-wrap: wrap;
	margin-inline-start: var(--p-space-2);
	color: var(--p-muted);
	font-size: var(--p-small);
}
.allocation-group-metrics > span:not(.allocation-group-separator) {
	white-space: nowrap;
}
.allocation-group-separator {
	white-space: pre;
}
.allocation-summary-table.is-collapsible .allocation-group-metrics {
	flex: 1 0 100%;
	margin-inline-start: 1.5rem;
	white-space: normal;
}
.allocation-summary-table.is-collapsible :deep(.data-table-group-identity) {
	flex-wrap: wrap;
}
.allocation-item-link,
.allocation-item-name {
	display: -webkit-box;
	max-width: 28rem;
	overflow: hidden;
	-webkit-box-orient: vertical;
	-webkit-line-clamp: 2;
	text-decoration: none;
}
.allocation-item-link:hover {
	text-decoration: underline;
}
.allocation-quantity {
	display: inline-block;
	white-space: nowrap;
}
.allocation-batch-entry,
.allocation-expiry-entry {
	display: block;
}
.allocation-batch-entry {
	width: max-content;
	max-width: none;
	white-space: nowrap;
}
.allocation-summary-table :deep(.data-table-group-count) {
	display: none;
}
.allocation-batch-link {
	white-space: nowrap;
}
.allocation-summary-table :deep(td.data-column-code > .allocation-batch-entry) {
	width: max-content;
	max-width: none;
	overflow: visible;
	text-overflow: clip;
}
.allocation-phone-list {
	display: grid;
	gap: var(--p-space-3);
}
.allocation-phone-group {
	min-width: 0;
}
.allocation-phone-group-toggle {
	display: flex;
	width: 100%;
	min-height: 48px;
	align-items: center;
	justify-content: space-between;
	gap: var(--p-space-2);
	padding: var(--p-space-2) 0;
	border: 0;
	border-bottom: 1px solid var(--p-border);
	background: transparent;
	color: inherit;
	text-align: left;
}
.allocation-phone-group-heading {
	display: grid;
	min-width: 0;
	gap: 2px;
}
.allocation-phone-group-heading > strong,
.allocation-phone-group-heading > span {
	overflow-wrap: anywhere;
}
.allocation-phone-group-heading > span,
.allocation-phone-meta {
	color: var(--p-muted);
	font-size: var(--p-small);
}
.allocation-phone-chevron {
	flex: none;
	font-size: 1.2rem;
}
.allocation-phone-rows {
	display: grid;
}
.allocation-phone-row {
	display: grid;
	grid-template-columns: 48px minmax(0, 1fr);
	min-width: 0;
	align-items: center;
	gap: var(--p-space-2);
	padding: var(--p-space-2) 0;
	border-bottom: 1px solid var(--p-border);
}
.allocation-phone-copy {
	min-width: 0;
}
.allocation-phone-primary {
	display: flex;
	min-width: 0;
	align-items: flex-start;
	justify-content: space-between;
	gap: var(--p-space-2);
}
.allocation-phone-primary .allocation-item-link,
.allocation-phone-primary .allocation-item-name {
	display: -webkit-box;
	min-width: 0;
	flex: 1 1 auto;
	-webkit-box-orient: vertical;
	overflow: hidden;
	-webkit-line-clamp: 2;
}
.allocation-phone-quantity {
	flex: 0 1 50%;
	min-width: 0;
	text-align: right;
	white-space: normal;
	overflow-wrap: anywhere;
}
.allocation-phone-quantity > span {
	color: var(--p-muted);
	font-weight: 400;
}
.allocation-phone-meta {
	margin-top: 2px;
	line-height: 1.35;
	overflow-wrap: anywhere;
}
.allocation-phone-meta .allocation-batch-entry {
	width: auto;
	white-space: normal;
	overflow-wrap: anywhere;
}
</style>
