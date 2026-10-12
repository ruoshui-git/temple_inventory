<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";
import UiLoadingBoundary from "./UiLoadingBoundary.vue";

export type ColumnSummaryValue =
	| { type: "number"; value: number }
	| {
			type: "quantity";
			unitless_total: number;
			by_uom: Array<{ uom: string; qty: number }>;
	  }
	| {
			type: "grouped_quantity";
			unitless_total: number;
			groups: Array<{
				key: string;
				label: string;
				by_uom: Array<{ uom: string; qty: number }>;
			}>;
	  };

export type ColumnSummary = Record<string, ColumnSummaryValue>;

const props = withDefaults(
	defineProps<{
		open: boolean;
		title?: string;
		columns: Array<{ key: string; label: string; summary?: string }>;
		summaries?: ColumnSummary;
		loading?: boolean;
	}>(),
	{ title: "列汇总", summaries: () => ({}), loading: false },
);
const emit = defineEmits<{ "update:open": [open: boolean] }>();
const closeButton = ref<HTMLButtonElement>();
const summaryRegion = ref<HTMLElement>();
const previousFocus = ref<HTMLElement>();
const previousHtmlOverflow = ref("");
const previousBodyOverflow = ref("");
const wasOpen = ref(false);
const visibleColumns = computed(() =>
	props.columns.filter((column) => column.summary && props.summaries?.[column.summary]),
);
function close() {
	emit("update:open", false);
}
function onKeydown(event: KeyboardEvent) {
	if (event.key === "Escape") {
		event.preventDefault();
		close();
		return;
	}
	if (event.key !== "Tab") return;
	const focusable = Array.from(
		(event.currentTarget as HTMLElement).querySelectorAll<HTMLElement>(
			".column-summary-dialog button, .column-summary-dialog [href], .column-summary-dialog input, .column-summary-dialog select, .column-summary-dialog textarea, .column-summary-dialog [tabindex]:not([tabindex='-1'])",
		),
	);
	if (!focusable.length) return;
	const first = focusable[0];
	const last = focusable[focusable.length - 1];
	if (event.shiftKey && document.activeElement === first) {
		event.preventDefault();
		last.focus();
	} else if (!event.shiftKey && document.activeElement === last) {
		event.preventDefault();
		first.focus();
	}
}
function format(value: number) {
	return new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 6 }).format(value);
}
watch(
	() => props.open,
	async (open) => {
		if (open) {
			if (!wasOpen.value) {
				previousFocus.value = document.activeElement as HTMLElement;
				previousHtmlOverflow.value = document.documentElement.style.overflow;
				previousBodyOverflow.value = document.body.style.overflow;
			}
			wasOpen.value = true;
			document.documentElement.style.overflow = "hidden";
			document.body.style.overflow = "hidden";
			await nextTick();
			closeButton.value?.focus();
		} else if (wasOpen.value) {
			if (document.documentElement.style.overflow === "hidden")
				document.documentElement.style.overflow = previousHtmlOverflow.value;
			if (document.body.style.overflow === "hidden")
				document.body.style.overflow = previousBodyOverflow.value;
			wasOpen.value = false;
			previousFocus.value?.focus?.();
		}
	},
	{ immediate: true },
);
onBeforeUnmount(() => {
	if (wasOpen.value && document.documentElement.style.overflow === "hidden")
		document.documentElement.style.overflow = previousHtmlOverflow.value;
	if (wasOpen.value && document.body.style.overflow === "hidden")
		document.body.style.overflow = previousBodyOverflow.value;
});
</script>

<template>
	<Teleport to="body">
		<div v-if="open" class="column-summary-backdrop" @click.self="close">
			<section
				class="column-summary-dialog"
				role="dialog"
				aria-modal="true"
				:aria-label="title"
				@keydown="onKeydown"
			>
				<header>
					<h2>{{ title }}</h2>
					<button ref="closeButton" type="button" aria-label="关闭列汇总" @click="close">
						×
					</button>
				</header>
				<div
					ref="summaryRegion"
					class="column-summary-data"
					:inert="loading ? true : undefined"
				>
					<p v-if="!loading && !visibleColumns.length" class="column-summary-empty">
						当前结果没有可汇总的数值列。
					</p>
					<dl v-else-if="visibleColumns.length" class="column-summary-list">
						<template v-for="column in visibleColumns" :key="column.key">
							<dt>{{ column.label }}</dt>
							<dd>
								<template v-if="summaries[column.summary!]?.type === 'number'">
									{{ format((summaries[column.summary!] as any).value) }}
								</template>
								<template
									v-else-if="summaries[column.summary!]?.type === 'quantity'"
								>
									<strong>{{
										format((summaries[column.summary!] as any).unitless_total)
									}}</strong
									><small>比较总量（无单位）</small>
									<span
										v-for="unit in (summaries[column.summary!] as any).by_uom"
										:key="unit.uom"
										>{{ format(unit.qty) }} {{ unit.uom }}</span
									>
								</template>
								<template v-else>
									<strong>{{
										format((summaries[column.summary!] as any).unitless_total)
									}}</strong
									><small>比较总量（无单位）</small>
									<span
										v-for="group in (summaries[column.summary!] as any).groups"
										:key="group.key"
										><b>{{ group.label }}</b
										><i v-for="unit in group.by_uom" :key="unit.uom"
											>{{ format(unit.qty) }} {{ unit.uom }}</i
										></span
									>
								</template>
							</dd>
						</template>
					</dl>
				</div>
				<UiLoadingBoundary
					class="column-summary-loading-boundary-proxy"
					:busy="loading"
					:mode="visibleColumns.length ? 'refresh' : 'initial'"
					:message="visibleColumns.length ? '正在更新汇总…' : '正在加载汇总…'"
					:region="summaryRegion"
					:dim-region="Boolean(visibleColumns.length)"
					:block-interactions="false"
				/>
			</section>
		</div>
	</Teleport>
</template>

<style scoped>
.column-summary-backdrop {
	position: fixed;
	inset: 0;
	z-index: var(--ti-layer-overlay);
	display: grid;
	place-items: center;
	padding: var(--ti-space-4);
	background: var(--ti-overlay-scrim);
}
.column-summary-dialog {
	width: min(560px, 100%);
	max-height: min(720px, 90dvh);
	overflow: auto;
	border-radius: var(--ti-radius-card);
	background: var(--ti-surface);
	box-shadow: var(--ti-shadow-overlay);
}
.column-summary-dialog header {
	display: flex;
	align-items: center;
	justify-content: space-between;
	padding: var(--ti-space-4) var(--ti-space-4) var(--ti-space-2);
	margin: 0;
}
.column-summary-dialog h2 {
	margin: 0;
	font-size: var(--ti-font-section);
}
.column-summary-dialog header button {
	min-width: var(--ti-control-height);
	min-height: var(--ti-control-height);
	border: 0;
	border-radius: var(--ti-radius-control);
	background: transparent;
	font-size: var(--ti-font-heading);
}
@media (max-width: 1023px) {
	.column-summary-dialog header button {
		min-width: var(--ti-density-control);
		min-height: var(--ti-density-control);
	}
}
.column-summary-list {
	display: grid;
	grid-template-columns: minmax(100px, 1fr) minmax(160px, 2fr);
	gap: 0;
	margin: 0;
	padding: 0 var(--ti-space-4) var(--ti-space-4);
}
.column-summary-list dt,
.column-summary-list dd {
	margin: 0;
	padding: var(--ti-space-3) 0;
	border-top: 1px solid var(--ti-accent-soft);
}
.column-summary-list dd {
	display: flex;
	flex-direction: column;
	gap: var(--ti-space-1);
	text-align: right;
}
.column-summary-list dd small,
.column-summary-list dd span {
	color: var(--ti-muted);
	font-size: var(--ti-font-small);
}
.column-summary-list dd span {
	display: block;
}
.column-summary-list dd i {
	display: block;
	font-style: normal;
}
.column-summary-empty {
	padding: var(--ti-space-4);
	color: var(--ti-muted);
}
.column-summary-loading-boundary-proxy {
	display: contents;
}
.column-summary-data {
	min-height: 64px;
}
@media (max-width: 700px) {
	.column-summary-backdrop {
		align-items: end;
		padding: 0;
	}
	.column-summary-dialog {
		width: 100%;
		max-height: 82dvh;
		border-radius: var(--ti-radius-card) 16px 0 0;
	}
}
</style>
