<script setup lang="ts">
import { computed } from "vue";
import { reviewSession, type ReviewDraft, type DraftLine } from "../reviewModel";

const props = defineProps<{ draft: ReviewDraft }>();
const item = (code: string) => reviewSession.stock.find((row) => row.code === code);
const enteredQuantity = (line: DraftLine) =>
	Number(line.qty) /
	(item(line.code)?.alternateUnits?.find((unit) => unit.uom === line.entryUom)?.factor || 1);
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
		<section v-for="[place, lines] in groups" :key="place">
			<strong>{{ place }}</strong>
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
						· 输入 {{ enteredQuantity(line) }} {{ line.entryUom }}</template
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
		</section>
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
