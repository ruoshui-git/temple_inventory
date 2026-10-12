pyenv: cannot rehash: /home/frappe/.pyenv/shims isn't writable rm: cannot remove
'/home/frappe/.nvm/current': Read-only file system
<script setup lang="ts">
export interface MobileSummaryMetric {
	key: string;
	label: string;
	overall: number;
	tone: "available" | "total" | "warning" | "danger";
	details: Array<{ label: string; value: number; uom?: string }>;
}

defineProps<{ metrics: MobileSummaryMetric[]; expandedKey?: string }>();
const emit = defineEmits<{ select: [key: string] }>();
const format = (value: number) => value.toLocaleString("zh-CN");
</script>

<template>
	<section class="mobile-summary" aria-label="筛选结果汇总">
		<div class="mobile-summary-row">
			<button
				v-for="metric in metrics"
				:key="metric.key"
				type="button"
				class="mobile-summary-card"
				:class="[metric.tone, { selected: expandedKey === metric.key }]"
				:aria-expanded="expandedKey === metric.key"
				@click="emit('select', metric.key)"
			>
				<small>{{ metric.label }}</small>
				<strong>{{ format(metric.overall) }}</strong>
			</button>
		</div>
		<div
			v-if="expandedKey"
			class="mobile-summary-details"
			:class="metrics.find((metric) => metric.key === expandedKey)?.tone"
		>
			<b>{{ metrics.find((metric) => metric.key === expandedKey)?.label }}数量明细</b>
			<div>
				<span
					v-for="detail in metrics.find((metric) => metric.key === expandedKey)?.details"
					:key="detail.label"
				>
					<strong>{{ format(detail.value) }}</strong>
					<small>{{ detail.uom || detail.label }}</small>
				</span>
			</div>
		</div>
	</section>
</template>

<style scoped>
.mobile-summary {
	display: grid;
	gap: var(--ti-space-1);
}
.mobile-summary-row {
	display: grid;
	grid-template-columns: repeat(auto-fit, minmax(0, 1fr));
	gap: var(--ti-space-1);
}
.mobile-summary-card {
	display: flex;
	min-width: 0;
	min-height: 70px;
	flex-direction: column;
	align-items: flex-start;
	justify-content: center;
	padding: var(--ti-space-2) var(--ti-space-2);
	border: 1px solid var(--ti-border);
	border-radius: var(--ti-radius-control);
	background: var(--ti-surface);
	color: var(--ti-ink);
	text-align: left;
}
.mobile-summary-card small {
	color: var(--ti-muted);
	font-size: var(--ti-font-small);
}
.mobile-summary-card strong {
	font-size: var(--ti-font-section);
	line-height: 1.25;
	font-variant-numeric: tabular-nums;
}
.mobile-summary-card.available {
	background: var(--ti-success-bg);
	color: var(--ti-success);
}
.mobile-summary-card.warning {
	background: var(--ti-warning-bg);
	color: var(--ti-warning);
}
.mobile-summary-card.danger {
	background: var(--ti-danger-bg);
	color: var(--ti-danger);
}
.mobile-summary-card.selected {
	border-color: currentColor;
	box-shadow: var(--ti-shadow-card);
}
.mobile-summary-details {
	padding: var(--ti-space-2) var(--ti-space-2);
	border: 1px solid var(--ti-border);
	border-radius: var(--ti-radius-control);
	background: var(--ti-success-bg);
}
.mobile-summary-details.warning {
	border-color: var(--ti-border);
	background: var(--ti-warning-bg);
}
.mobile-summary-details.danger {
	border-color: var(--ti-border);
	background: var(--ti-danger-bg);
}
.mobile-summary-details > b {
	display: block;
	margin-bottom: var(--ti-space-2);
	font-size: var(--ti-font-small);
	font-weight: 550;
}
.mobile-summary-details > div {
	display: grid;
	grid-template-columns: repeat(auto-fit, minmax(0, 1fr));
}
.mobile-summary-details span {
	display: flex;
	flex-direction: column;
	align-items: center;
	border-right: 1px solid var(--ti-border);
}
.mobile-summary-details span:last-child {
	border: 0;
}
.mobile-summary-details strong {
	font-size: var(--ti-font-section);
}
.mobile-summary-details small {
	color: var(--ti-muted);
	font-size: var(--ti-font-small);
}
</style>
