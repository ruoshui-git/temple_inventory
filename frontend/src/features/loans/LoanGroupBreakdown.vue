<script lang="ts">
let activeClose: (() => void) | undefined;
const openPanels = new Set<() => void>();
export function closeLoanGroupBreakdowns() {
	for (const close of openPanels) close();
}
</script>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useResponsiveLayout } from "../../composables/useResponsiveLayout";
import UiButton from "../../components/UiButton.vue";

const props = defineProps<{
	row: any;
	activeName: string;
	open: boolean;
	pinned: boolean;
	records: any[];
	total: number;
	loading: boolean;
	error: string;
	formatQuantities: (values: any[]) => string;
	warehouseText: (name: string) => string;
}>();
const emit = defineEmits<{
	show: [pinned: boolean];
	hide: [];
	more: [];
	retry: [];
}>();
const { isSurface } = useResponsiveLayout();
const open = ref(props.open);
const pinned = ref(props.pinned);
const trigger = ref<HTMLButtonElement>();
const panel = ref<HTMLElement>();
const panelStyle = ref<Record<string, string>>({});
const id = `loan-breakdown-${Math.random().toString(36).slice(2)}`;
const records = computed(() => (props.activeName === props.row.name ? props.records : []));
let dismissTimer: ReturnType<typeof setTimeout> | undefined;
const ignoreNextFocus = ref(false);

function positionPanel() {
	if (!trigger.value || !panel.value) return;
	const anchor = trigger.value.getBoundingClientRect();
	const bounds = panel.value.getBoundingClientRect();
	const left = Math.max(
		12,
		Math.min(
			anchor.left + anchor.width / 2 - bounds.width / 2,
			window.innerWidth - bounds.width - 12,
		),
	);
	const above = anchor.top - bounds.height - 10;
	const top =
		above >= 12
			? above
			: Math.min(anchor.bottom + 10, window.innerHeight - bounds.height - 12);
	panelStyle.value = { left: `${left}px`, top: `${Math.max(12, top)}px` };
}
function cancelDismiss() {
	if (dismissTimer) clearTimeout(dismissTimer);
	dismissTimer = undefined;
}
function show(pin = false) {
	cancelDismiss();
	if (activeClose !== hide) activeClose?.();
	activeClose = hide;
	if (pin) pinned.value = true;
	open.value = true;
	emit("show", pinned.value);
	void nextTick(positionPanel);
}
function hide(notify = false) {
	const wasOpen = open.value;
	cancelDismiss();
	open.value = false;
	pinned.value = false;
	if (activeClose === hide) activeClose = undefined;
	if (notify && wasOpen) emit("hide");
}
function scheduleDismiss() {
	cancelDismiss();
	if (!pinned.value) dismissTimer = setTimeout(() => hide(true), 140);
}
function toggle() {
	if (open.value && pinned.value) hide(true);
	else show(true);
}
function activate() {
	trigger.value?.click();
}
function outsidePointer(event: PointerEvent) {
	if (!open.value) return;
	const target = event.target as Node | null;
	if (target && (trigger.value?.contains(target) || panel.value?.contains(target))) return;
	hide(true);
}
function keydown(event: KeyboardEvent) {
	if (event.key === "Escape" && open.value) {
		event.stopPropagation();
		hide(true);
		ignoreNextFocus.value = document.activeElement !== trigger.value;
		trigger.value?.focus();
	}
}
function focusout(event: FocusEvent) {
	const target = event.relatedTarget as Node | null;
	if (target && (trigger.value?.contains(target) || panel.value?.contains(target))) return;
	hide(true);
}
function triggerFocus() {
	if (ignoreNextFocus.value) {
		ignoreNextFocus.value = false;
		return;
	}
	show();
}
function focusPanel() {
	show(true);
	void nextTick(() => {
		const first = panel.value?.querySelector<HTMLElement>(
			'a[href], button:not(:disabled), [tabindex="0"]',
		);
		(first || panel.value)?.focus();
	});
}
function triggerTab(event: KeyboardEvent) {
	if (event.shiftKey) return;
	event.preventDefault();
	focusPanel();
}
function resize() {
	if (open.value) positionPanel();
}
onMounted(() => {
	openPanels.add(hide);
	if (open.value) {
		activeClose?.();
		activeClose = hide;
		void nextTick(positionPanel);
	}
	document.addEventListener("pointerdown", outsidePointer);
	document.addEventListener("keydown", keydown);
	window.addEventListener("resize", resize);
	window.addEventListener("scroll", resize, true);
});
onBeforeUnmount(() => {
	openPanels.delete(hide);
	cancelDismiss();
	document.removeEventListener("pointerdown", outsidePointer);
	document.removeEventListener("keydown", keydown);
	window.removeEventListener("resize", resize);
	window.removeEventListener("scroll", resize, true);
	if (activeClose === hide) activeClose = undefined;
});
watch([records, () => props.loading], () => void nextTick(positionPanel));
watch(
	() => [props.open, props.pinned] as const,
	([nextOpen, nextPinned]) => {
		open.value = nextOpen;
		pinned.value = nextPinned;
		if (nextOpen) void nextTick(positionPanel);
	},
	{ flush: "sync" },
);
watch(
	() => props.activeName,
	(name) => {
		if (name !== props.row.name) hide();
	},
	{ flush: "sync" },
);
defineExpose({ activate, close: hide });
</script>

<template>
	<span class="loan-breakdown-anchor">
		<button
			ref="trigger"
			type="button"
			class="loan-record-count"
			data-row-control
			:aria-expanded="open"
			aria-haspopup="dialog"
			:aria-controls="id"
			:aria-label="`${row.item_name} · ${row.outcome_label} · ${row.record_count} 条记录`"
			@mouseenter="!isSurface('mobile') && show()"
			@mouseleave="scheduleDismiss"
			@focus="triggerFocus"
			@blur="focusout"
			@keydown.down.prevent="focusPanel"
			@keydown.tab="triggerTab"
			@click.stop="toggle"
		>
			{{ row.record_count }} 条记录
		</button>
		<Teleport to="body">
			<section
				v-if="open && activeName === row.name"
				:id="id"
				ref="panel"
				class="loan-breakdown"
				role="dialog"
				:aria-label="`${row.item_name} · ${row.outcome_label} 借用记录`"
				:style="panelStyle"
				tabindex="-1"
				@mouseenter="cancelDismiss"
				@mouseleave="scheduleDismiss"
				@focusout="focusout"
			>
				<header>
					<strong>{{ row.item_name }} · {{ row.outcome_label }}</strong
					><span>{{ formatQuantities(row.quantity_values) }}</span>
				</header>
				<p v-if="loading && !records.length">正在加载借用记录…</p>
				<p v-else-if="error" role="alert">
					{{ error }} <button type="button" @click="emit('retry')">重试</button>
				</p>
				<p v-else-if="!records.length">没有匹配的借用记录</p>
				<article
					v-for="record in records"
					:key="record.loan"
					class="loan-breakdown-record"
				>
					<div class="loan-breakdown-record-heading">
						<RouterLink :to="record.detail_route" data-row-control>{{
							record.loan
						}}</RouterLink
						><span>{{ formatQuantities(record.quantity_values) }}</span>
					</div>
					<div>
						{{ record.borrower || "未填写借用方" }} ·
						{{ String(record.loan_date || "").slice(0, 10) }}
					</div>
					<div>{{ record.activity_title || record.activity || "未关联活动" }}</div>
					<ul>
						<li
							v-for="(location, index) in record.locations"
							:key="`${record.loan}-${index}`"
						>
							{{ warehouseText(location.warehouse)
							}}<template v-if="location.batch_no">
								· 批次 {{ location.batch_no }}</template
							><template v-if="location.activity_title">
								· {{ location.activity_title }}</template
							>
							·
							{{ formatQuantities([{ uom: location.uom, qty: location.quantity }]) }}
						</li>
					</ul>
				</article>
				<UiButton
					v-if="records.length < total"
					variant="ghost"
					size="compact"
					type="button"
					:disabled="loading"
					@click="emit('more')"
					>{{ loading ? "正在加载…" : "加载更多记录" }}</UiButton
				>
			</section>
		</Teleport>
	</span>
</template>

<style scoped>
.loan-breakdown-anchor {
	display: inline-flex;
}
.loan-record-count {
	min-height: 30px;
	padding: var(--ti-space-1) var(--ti-space-2);
	border: 1px solid var(--ti-border);
	border-radius: var(--ti-radius-pill);
	background: var(--ti-surface-raised);
	color: var(--ti-accent-strong);
	font-size: max(12px, var(--ti-font-small));
	font-weight: 650;
}
.loan-breakdown {
	position: fixed;
	z-index: var(--ti-layer-overlay);
	box-sizing: border-box;
	width: min(440px, calc(100vw - 28px));
	max-height: min(65dvh, 540px);
	padding: var(--ti-density-gap);
	overflow: auto;
	overscroll-behavior: contain;
	border: 1px solid var(--ti-border);
	border-radius: var(--ti-radius-control);
	background: var(--ti-surface);
	box-shadow: var(--ti-shadow-overlay);
	font-size: var(--ti-font-body);
}
.loan-breakdown > header,
.loan-breakdown-record-heading {
	display: flex;
	justify-content: space-between;
	gap: var(--ti-density-row-gap);
}
.loan-breakdown-record {
	display: grid;
	gap: var(--ti-space-1);
	margin-top: var(--ti-space-2);
	padding: var(--ti-space-2) 0;
	border-top: 1px solid var(--ti-border);
}
.loan-breakdown-record ul {
	margin: 0;
	padding-left: var(--ti-space-4);
	color: var(--ti-muted);
}
</style>
