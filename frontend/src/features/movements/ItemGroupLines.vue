<script setup lang="ts">
import MovementHistoryTable from "../../components/ui/MovementHistoryTable.vue";
import type { HistoryRow } from "./useMovementHistory";

withDefaults(
	defineProps<{
		rows: HistoryRow[];
		total: number;
		next: number | null;
		loading: boolean;
		error: string;
		initialized: boolean;
		stale: boolean;
		historyComplete?: boolean;
		sortBy: string;
		sortDirection: "asc" | "desc";
		loanBalance?: boolean;
	}>(),
	{ historyComplete: true, loanBalance: false },
);
const emit = defineEmits<{
	loadMore: [];
	retry: [];
	sort: [field: string];
	openDocument: [doctype: string, name: string];
	openLoan: [name: string];
}>();
</script>

<template>
	<MovementHistoryTable
		:rows="rows"
		:total="total"
		:next="next"
		:loading="loading"
		:error="error"
		:initialized="initialized"
		:stale="stale"
		:history-complete="historyComplete"
		:sort-by="sortBy"
		:sort-direction="sortDirection"
		:mode="loanBalance ? 'loan-balance' : undefined"
		@load-more="emit('loadMore')"
		@retry="emit('retry')"
		@sort="emit('sort', $event)"
		@open-document="(doctype, name) => emit('openDocument', doctype, name)"
		@open-loan="emit('openLoan', $event)"
	/>
</template>
