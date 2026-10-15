<script setup lang="ts">
import { computed, ref } from "vue";
import { enteredQty } from "../conversionModel";
import { reviewSession, type ReviewDraft, type DraftLine } from "../reviewModel";

const props = defineProps<{ draft: ReviewDraft; collapsible?: boolean }>();
const item = (code: string) => reviewSession.stock.find((row) => row.code === code);
const enteredQuantity = enteredQty;
const choices = ref<Record<string, boolean>>({});
function isOpen(place: string) {
	return choices.value[place] ?? (groups.value.length === 1 && props.draft.lines.length <= 5);
}
function totals(lines: DraftLine[]) {
	const values = new Map<string, number>();
	lines.forEach((line) =>
		values.set(line.uom, (values.get(line.uom) || 0) + Number(line.qty || 0)),
	);
	return [...values].map(([uom, qty]) => `${qty} ${uom}`).join(" · ");
}
const groups = computed(() => {
	const result = new Map<string, DraftLine[]>();
	for (const line of props.draft.lines) {
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
			@toggle="collapsible && (choices[place] = ($event.target as HTMLDetailsElement).open)"
		>
			<component :is="collapsible ? 'summary' : 'strong'"
				>{{ place }} · {{ new Set(lines.map((line) => line.code)).size }} 种物品 ·
				{{ lines.length }} 行分配 · {{ totals(lines) }}</component
			>
			<p v-for="line in lines" :key="line.id" :data-summary-line-id="line.id">
				{{ item(line.code)?.name || line.code }} · {{ line.qty }} {{ line.uom }}
				<small class="muted">
					{{ line.code }}
					<template v-if="line.sourceLocation && line.sourceLocation !== line.location">
						· {{ line.sourceLocation }} → {{ line.location || "未选择目标" }}
					</template>
					<template v-if="item(line.code)?.tracksBatch">
						· 批次
						{{ line.batch || (draft.kind === "Receive" ? "自动生成" : "未选择") }}
					</template>
					<template v-if="item(line.code)?.tracksExpiry">
						· 到期 {{ line.expiry || "未设置" }}</template
					>
					<template v-if="line.entryUom">
						· 输入 {{ enteredQuantity(line) }} {{ line.entryUom }} · 1
						{{ line.entryUom }} = {{ line.conversionFactor }} {{ line.uom }}</template
					>
					<template v-if="line.loanName || draft.loanName">
						· 借出 {{ line.loanName || draft.loanName }} / 原明细
						{{ (line.loanLineIndex || 0) + 1 }}
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
