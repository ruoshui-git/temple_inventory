<script setup lang="ts">
import { RouterLink } from "vue-router";
import DetailPopover from "../../components/ui/DetailPopover.vue";
import type { DataColumn } from "../../lib/dataTable";
import { formatSiteDateTime } from "../../lib/nativeTime";
import { movementLabels } from "../../lib/presentationLabels";
import { activityMovementTarget } from "./activityRoutes";

// One cell of an activity: shared by the browse table and the 列表 rows. The 关联流动 column
// links each movement kind; rows omit it because it is an action, not a field.
const props = defineProps<{
	column: DataColumn;
	row: Record<string, unknown>;
	typeLabel: (id: string) => string;
	kindCounts: (id: string) => { kind: string; count: number }[];
}>();
</script>

<template>
	<RouterLink
		v-if="column.id === 'title'"
		class="browse-row-link"
		:to="{ name: 'activity-detail', params: { name: String(row.id || '') } }"
		>{{ String(row.title || "") }}</RouterLink
	>
	<template v-else-if="column.id === 'typeId'">{{
		typeLabel(String(row.typeId || ""))
	}}</template>
	<template v-else-if="column.id === 'period'"
		>{{ row.start || "未设日期" }}{{ row.end ? " 至 " + row.end : "" }}</template
	>
	<template v-else-if="column.id === 'status'"
		>{{ row.status === "archived" ? "已归档" : "进行中"
		}}<span v-if="row.has_outstanding" class="badge warning"> · 有未归还借用</span></template
	>
	<template v-else-if="column.id === 'modified'">{{
		formatSiteDateTime(String(row.modified || ""))
	}}</template>
	<template v-else-if="column.id === 'start_date'">{{ row.start || "" }}</template>
	<template v-else-if="column.id === 'end_date'">{{ row.end || "" }}</template>
	<template v-else-if="column.id === 'actions'">
		<div class="activity-kind-summary">
			<RouterLink
				v-for="count in kindCounts(String(row.id)).slice(0, 3)"
				:key="count.kind"
				:to="activityMovementTarget(String(row.id), count.kind)"
				>{{ movementLabels[count.kind] }} {{ count.count }}</RouterLink
			>
			<DetailPopover
				v-if="kindCounts(String(row.id)).length > 3"
				:label="`${String(row.title || '活动')}的全部流动类型`"
				trigger-class="activity-kind-more"
				:trigger-text="`+${kindCounts(String(row.id)).length - 3}`"
			>
				<RouterLink
					v-for="count in kindCounts(String(row.id))"
					:key="count.kind"
					:to="activityMovementTarget(String(row.id), count.kind)"
					class="activity-kind-popover-link"
					>{{ movementLabels[count.kind] || "其他类型" }} {{ count.count }}</RouterLink
				>
			</DetailPopover>
		</div>
	</template>
	<template v-else>{{ row[column.id] ?? "" }}</template>
</template>
