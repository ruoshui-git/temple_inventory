<script setup lang="ts">
import { nextTick, onMounted, onScopeDispose, ref, watch } from "vue";
import type { ColumnPreferencesController, DataColumn } from "../../lib/dataTable";

// The 显示字段 trigger and its panel. The panel teleports to body; positioning follows the
// trigger, and Escape or an outside pointer closes it.
const props = defineProps<{
	preferences: ColumnPreferencesController;
	columns: DataColumn[];
}>();

const open = ref(false);
const trigger = ref<HTMLButtonElement>();
const panel = ref<HTMLDivElement>();
const panelStyle = ref<Record<string, string>>({});

function labelFor(id: string) {
	return props.columns.find((item) => String(item.id) === id)?.label || id;
}

function positionPanel() {
	const triggerElement = trigger.value;
	const panelElement = panel.value;
	if (!open.value || !triggerElement || !panelElement) return;
	const margin = 12;
	const gap = 8;
	const viewportHeight = window.innerHeight;
	const viewportWidth = window.innerWidth;
	const triggerRect = triggerElement.getBoundingClientRect();
	const panelRect = panelElement.getBoundingClientRect();
	const panelHeight = panelRect.height || panelElement.offsetHeight;
	const panelWidth = panelRect.width || panelElement.offsetWidth;
	const roomBelow = viewportHeight - triggerRect.bottom - margin;
	const roomAbove = triggerRect.top - margin;
	let top: number;
	if (panelHeight <= roomBelow) top = triggerRect.bottom + gap;
	else if (panelHeight <= roomAbove) top = triggerRect.top - panelHeight - gap;
	else if (roomAbove > roomBelow) top = margin;
	else top = Math.max(margin, viewportHeight - margin - panelHeight);
	const left = Math.min(
		Math.max(margin, triggerRect.right - panelWidth),
		Math.max(margin, viewportWidth - panelWidth - margin),
	);
	panelStyle.value = {
		position: "fixed",
		top: `${top}px`,
		left: `${left}px`,
		maxHeight: `${Math.max(80, Math.min(520, viewportHeight - margin * 2))}px`,
	};
}

function closeSettings(returnFocus = false) {
	open.value = false;
	if (returnFocus) void nextTick(() => trigger.value?.focus());
}

function showSettings() {
	open.value = true;
	void nextTick(() => {
		positionPanel();
		panel.value?.focus();
	});
}

function toggleSettings() {
	if (open.value) closeSettings();
	else showSettings();
}

function repositionOpenPanel() {
	if (open.value) void nextTick(positionPanel);
}

function onDocumentPointer(event: PointerEvent) {
	const target = event.target;
	if (
		open.value &&
		target instanceof Node &&
		!panel.value?.contains(target) &&
		!trigger.value?.contains(target)
	)
		closeSettings();
}

function onDocumentKeydown(event: KeyboardEvent) {
	if (!open.value || event.key !== "Escape") return;
	event.stopImmediatePropagation();
	event.preventDefault();
	closeSettings(true);
}

function moveColumn(id: string, direction: -1 | 1) {
	const order = [...props.preferences.order.value];
	const index = order.indexOf(id);
	const next = index + direction;
	if (index < 0 || next < 0 || next >= order.length) return;
	[order[index], order[next]] = [order[next]!, order[index]!];
	props.preferences.reorder(order);
	void nextTick(() => {
		const buttons = Array.from(
			panel.value?.querySelectorAll<HTMLButtonElement>("button[data-column-move]") || [],
		);
		const validButtons = buttons.filter(
			(button) => button.dataset.columnMove === id && !button.disabled,
		);
		(
			validButtons.find((button) => button.dataset.columnDirection === String(direction)) ||
			validButtons[0]
		)?.focus();
	});
}

watch(
	[
		open,
		() => props.columns.length,
		() => props.preferences.order.value.length,
		() => props.preferences.visible.value.length,
	],
	repositionOpenPanel,
	{ flush: "post" },
);
onMounted(() => {
	document.addEventListener("pointerdown", onDocumentPointer);
	document.addEventListener("keydown", onDocumentKeydown);
	window.addEventListener("resize", repositionOpenPanel);
	window.addEventListener("scroll", repositionOpenPanel, true);
});
onScopeDispose(() => {
	document.removeEventListener("pointerdown", onDocumentPointer);
	document.removeEventListener("keydown", onDocumentKeydown);
	window.removeEventListener("resize", repositionOpenPanel);
	window.removeEventListener("scroll", repositionOpenPanel, true);
});
</script>

<template>
	<button
		ref="trigger"
		type="button"
		class="data-table-column-trigger"
		:aria-expanded="open"
		aria-label="显示字段"
		title="显示字段"
		@click="toggleSettings"
	>
		☷
	</button>
	<Teleport to="body">
		<div
			v-if="open"
			ref="panel"
			class="data-table-column-panel"
			role="group"
			aria-label="设置表格列"
			tabindex="-1"
			:style="panelStyle"
		>
			<div class="data-table-column-panel-heading">
				<strong>显示字段</strong>
				<button type="button" class="data-table-link-button" @click="preferences.reset">
					恢复默认
				</button>
			</div>
			<ul>
				<li v-for="(column, index) in preferences.order.value" :key="column">
					<label>
						<input
							type="checkbox"
							:checked="
								(
									preferences.effectiveVisible?.value ||
									preferences.visible.value
								).includes(column)
							"
							:disabled="
								Boolean(
									columns.find((item) => String(item.id) === column)?.required,
								) || preferences.forcedVisible?.value.includes(column)
							"
							@change="preferences.toggle(column)"
						/>
						<span>{{ labelFor(column) }}</span>
					</label>
					<div class="data-table-column-order">
						<button
							type="button"
							:disabled="index === 0"
							:data-column-move="column"
							data-column-direction="-1"
							:aria-label="`上移${labelFor(column)}`"
							@click="moveColumn(column, -1)"
						>
							↑
						</button>
						<button
							type="button"
							:disabled="index === preferences.order.value.length - 1"
							:data-column-move="column"
							data-column-direction="1"
							:aria-label="`下移${labelFor(column)}`"
							@click="moveColumn(column, 1)"
						>
							↓
						</button>
					</div>
				</li>
			</ul>
			<p v-if="preferences.saveState.value === 'saving'" role="status">正在保存列设置…</p>
			<div
				v-else-if="preferences.saveState.value === 'error'"
				class="data-table-save-error"
				role="alert"
			>
				<span>{{ preferences.saveError.value }}</span
				><button type="button" @click="preferences.retry">重试</button>
			</div>
		</div>
	</Teleport>
</template>
