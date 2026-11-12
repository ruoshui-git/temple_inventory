<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";
import InventoryIcon from "./InventoryIcon.vue";
import UiButton from "./ui/UiButton.vue";
import {
	backgroundTaskState,
	bindBackgroundTasks,
	downloadTask,
	removeTask,
	retryTask,
} from "../services/backgroundTasks";
import { formatSiteDateTime } from "../lib/nativeTime";
import { useInventoryServices, useOptionalReferenceData } from "../services/contracts";

const services = useInventoryServices();
const reference = useOptionalReferenceData();
const pill = ref<HTMLButtonElement>();
const tasks = computed(() => backgroundTaskState.tasks);
const running = computed(() => tasks.value.filter((task) => task.status === "running"));
const expanded = computed(() => backgroundTaskState.expanded);
const exporting = computed(() => running.value.some((task) => task.kind === "export"));
const percent = computed(() => {
	if (!running.value.length) return null;
	const values = running.value.map((task) => task.percent);
	if (values.some((value) => value === null)) return null;
	const total = values.reduce<number>((sum, value) => sum + (value ?? 0), 0);
	return Math.round(total / values.length);
});
const label = computed(() => {
	if (!running.value.length) return `${tasks.value.length} 项任务已完成`;
	const count = running.value.length;
	const action = exporting.value ? "导出" : "生成 PDF";
	return `正在${action} ${count} 项${percent.value === null ? "" : ` · ${percent.value}%`}`;
});

// Persisted export jobs resume under the signed-in account; no account means no storage.
watch(
	() => reference?.user,
	(user) => {
		if (user) bindBackgroundTasks(services, user);
	},
	{ immediate: true },
);
function requestedLabel(value: string) {
	const timezone = reference?.timezone ?? "";
	const full = formatSiteDateTime(value, timezone);
	if (!full) return value;
	const today = formatSiteDateTime(new Date().toISOString(), timezone).slice(0, 10);
	return today && full.startsWith(today) ? full.slice(11) : full;
}
function toggle() {
	backgroundTaskState.expanded = !backgroundTaskState.expanded;
}
function collapse(restoreFocus = true) {
	if (!backgroundTaskState.expanded) return;
	backgroundTaskState.expanded = false;
	if (restoreFocus) void nextTick(() => pill.value?.focus({ preventScroll: true }));
}
function keydown(event: KeyboardEvent) {
	if (event.key === "Escape") collapse();
}
watch(expanded, (value) => {
	if (value) document.addEventListener("keydown", keydown);
	else document.removeEventListener("keydown", keydown);
});
onBeforeUnmount(() => document.removeEventListener("keydown", keydown));
</script>

<template>
	<div v-if="tasks.length" class="task-tray" data-task-tray>
		<section
			v-if="expanded"
			id="task-tray-panel"
			class="task-tray-panel"
			role="region"
			aria-label="后台任务"
			aria-live="polite"
		>
			<h2 class="task-tray-title">后台任务</h2>
			<ul class="task-tray-list">
				<li
					v-for="task in tasks"
					:key="task.id"
					class="task-tray-item"
					:data-status="task.status"
				>
					<div class="task-tray-item-head">
						<strong>{{ task.title }}</strong>
						<span class="muted">{{
							task.format || (task.kind === "print-pdf" ? "PDF" : "")
						}}</span>
					</div>
					<time
						v-if="task.requestedAt"
						class="task-tray-time"
						:datetime="task.requestedAt"
						>请求于 {{ requestedLabel(task.requestedAt) }}</time
					>
					<p class="task-tray-stage">
						{{ task.status === "failed" ? task.error : task.stage }}
					</p>
					<span
						v-if="task.status === 'running' || task.downloading"
						class="task-tray-progress"
						:class="{ 'is-indeterminate': task.percent === null }"
						role="progressbar"
						:aria-label="`${task.title} 进度`"
						:aria-valuenow="task.percent ?? undefined"
						aria-valuemin="0"
						aria-valuemax="100"
					>
						<span
							:style="{ width: task.percent === null ? '' : `${task.percent}%` }"
						/>
					</span>
					<p v-if="task.downloadError" class="task-tray-error" role="alert">
						{{ task.downloadError }}
					</p>
					<div class="task-tray-actions">
						<UiButton
							v-if="task.status === 'completed'"
							size="compact"
							icon="download"
							:disabled="task.downloading"
							@click="downloadTask(task.id)"
							>{{ task.downloaded ? "再次下载" : "下载" }}</UiButton
						>
						<UiButton
							v-if="task.status === 'failed'"
							size="compact"
							icon="refresh"
							@click="retryTask(task.id)"
							>重试</UiButton
						>
						<UiButton
							v-if="task.status !== 'running' && !task.downloading"
							size="compact"
							@click="removeTask(task.id)"
							>移除</UiButton
						>
					</div>
				</li>
			</ul>
		</section>
		<button
			ref="pill"
			type="button"
			class="task-tray-pill"
			:aria-label="`${label}，展开后台任务`"
			:aria-expanded="expanded"
			aria-controls="task-tray-panel"
			@click="toggle"
		>
			<InventoryIcon name="export" />
			<span>{{ label }}</span>
			<span v-if="running.length" class="task-tray-meter" aria-hidden="true">
				<span
					:class="{ 'is-indeterminate': percent === null }"
					:style="{ width: percent === null ? '' : `${percent}%` }"
				/>
			</span>
		</button>
	</div>
</template>

<style scoped>
.task-tray {
	position: fixed;
	right: var(--p-space-4, 16px);
	bottom: var(--p-space-4, 16px);
	z-index: var(--p-z-fab);
	display: flex;
	flex-direction: column;
	align-items: flex-end;
	gap: var(--p-control-gap);
	max-width: calc(100vw - 32px);
}
@media (max-width: 1023px) {
	.task-tray {
		/* Sits above the phone bottom navigation and the browse FAB (56px + 12px gap). */
		bottom: calc(var(--app-nav-height, 84px) + 80px + env(safe-area-inset-bottom));
	}
}
.task-tray-pill {
	display: inline-flex;
	align-items: center;
	gap: var(--p-control-gap);
	min-height: var(--p-touch-target, 44px);
	max-width: 100%;
	padding-inline: var(--p-control-gap);
	border: 1px solid var(--p-border);
	border-radius: 999px;
	background: var(--p-surface);
	color: var(--p-ink);
	box-shadow: var(--p-shadow-raised);
	font: inherit;
	cursor: pointer;
}
.task-tray-pill:focus-visible {
	outline: 2px solid var(--p-focus);
	outline-offset: 2px;
}
.task-tray-meter {
	position: relative;
	width: 48px;
	height: 4px;
	overflow: hidden;
	border-radius: 2px;
	background: var(--p-border-soft);
}
.task-tray-meter > span {
	position: absolute;
	inset: 0 auto 0 0;
	background: var(--p-accent);
}
.task-tray-panel {
	width: min(360px, calc(100vw - 32px));
	max-height: 50vh;
	overflow: auto;
	padding: var(--p-card-inner-pad);
	border: 1px solid var(--p-border);
	border-radius: var(--p-radius-card, 12px);
	background: var(--p-surface);
	box-shadow: var(--p-shadow-raised);
}
.task-tray-title {
	margin: 0 0 var(--p-space-2, var(--p-space-2));
	font-size: 1rem;
}
.task-tray-list {
	display: grid;
	gap: var(--p-control-gap);
	margin: 0;
	padding: 0;
	list-style: none;
}
.task-tray-item-head {
	display: flex;
	justify-content: space-between;
	gap: var(--p-field-gap);
}
.task-tray-time {
	display: block;
	margin-top: 2px;
	font-size: var(--p-small);
	color: var(--p-muted);
}
.task-tray-stage,
.task-tray-error {
	margin: var(--p-space-1) 0;
	font-size: 0.875rem;
}
.task-tray-error {
	color: var(--p-danger);
}
.task-tray-progress {
	position: relative;
	display: block;
	height: 4px;
	overflow: hidden;
	border-radius: 2px;
	background: var(--p-border-soft);
}
.task-tray-progress > span {
	position: absolute;
	inset: 0 auto 0 0;
	background: var(--p-accent);
	transition: width var(--p-motion-fast) var(--p-motion-ease);
}
.task-tray-progress.is-indeterminate > span,
.task-tray-meter .is-indeterminate {
	width: 40% !important;
	animation: task-tray-slide 1.2s ease-in-out infinite;
}
.task-tray-actions {
	display: flex;
	flex-wrap: wrap;
	gap: var(--p-field-gap);
}
@keyframes task-tray-slide {
	from {
		transform: translateX(-100%);
	}
	to {
		transform: translateX(260%);
	}
}
@media (prefers-reduced-motion: reduce) {
	.task-tray-progress.is-indeterminate > span,
	.task-tray-meter .is-indeterminate {
		animation: none;
	}
}
</style>
