<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref } from "vue";

defineProps<{ label: string; triggerText?: string; triggerClass?: string }>();

const open = ref(false);
const pinned = ref(false);
const mobile = ref(false);
const trigger = ref<HTMLButtonElement | null>(null);
const panel = ref<HTMLElement | null>(null);
const panelStyle = ref<Record<string, string>>({});
let dismissTimer: ReturnType<typeof setTimeout> | undefined;
let mediaQuery: MediaQueryList | undefined;

function cancelDismiss() {
	if (dismissTimer) clearTimeout(dismissTimer);
	dismissTimer = undefined;
}

function positionPanel() {
	if (!trigger.value || !panel.value) return;
	const anchor = trigger.value.getBoundingClientRect();
	const bounds = panel.value.getBoundingClientRect();
	const gutter = 10;
	const viewportPadding = 12;
	const left = Math.max(
		viewportPadding,
		Math.min(
			anchor.left + anchor.width / 2 - bounds.width / 2,
			window.innerWidth - bounds.width - viewportPadding,
		),
	);
	const above = anchor.top - bounds.height - gutter;
	const top =
		above >= viewportPadding
			? above
			: Math.min(
					anchor.bottom + gutter,
					window.innerHeight - bounds.height - viewportPadding,
				);
	panelStyle.value = { left: `${left}px`, top: `${Math.max(viewportPadding, top)}px` };
}

function show(pin = false) {
	cancelDismiss();
	if (pin) pinned.value = true;
	open.value = true;
	void nextTick(positionPanel);
}

function hide() {
	cancelDismiss();
	open.value = false;
	pinned.value = false;
}

function scheduleDismiss() {
	cancelDismiss();
	if (!pinned.value) dismissTimer = setTimeout(hide, 120);
}

function showOnHover() {
	if (!mobile.value) show();
}

function toggle() {
	if (open.value && pinned.value) hide();
	else show(true);
}

function handleDocumentPointer(event: Event) {
	const target = event.target as Node | null;
	if (target && (trigger.value?.contains(target) || panel.value?.contains(target))) return;
	hide();
}

function handleKeydown(event: KeyboardEvent) {
	if (event.key === "Escape" && open.value) {
		event.stopPropagation();
		hide();
	}
}

function handleViewportChange() {
	if (open.value) positionPanel();
}

function handleMediaChange(event: MediaQueryListEvent) {
	mobile.value = event.matches;
	if (mobile.value && open.value && !pinned.value) hide();
}

onMounted(() => {
	if (typeof window.matchMedia === "function") {
		mediaQuery = window.matchMedia("(max-width: 1023px)");
		mobile.value = mediaQuery.matches;
		mediaQuery.addEventListener?.("change", handleMediaChange);
	}
	document.addEventListener("pointerdown", handleDocumentPointer);
	document.addEventListener("keydown", handleKeydown);
	window.addEventListener("resize", handleViewportChange);
	window.addEventListener("scroll", handleViewportChange, true);
});

onBeforeUnmount(() => {
	cancelDismiss();
	document.removeEventListener("pointerdown", handleDocumentPointer);
	document.removeEventListener("keydown", handleKeydown);
	window.removeEventListener("resize", handleViewportChange);
	window.removeEventListener("scroll", handleViewportChange, true);
	mediaQuery?.removeEventListener?.("change", handleMediaChange);
});
</script>

<template>
	<span class="detail-popover">
		<button
			ref="trigger"
			type="button"
			class="detail-popover-trigger"
			:class="triggerClass"
			:aria-expanded="open"
			:aria-label="label"
			@mouseenter="showOnHover"
			@mouseleave="scheduleDismiss"
			@focus="show()"
			@blur="scheduleDismiss"
			@click.stop="toggle"
		>
			<slot name="trigger">{{ triggerText || label }}</slot>
		</button>
		<Teleport to="body">
			<div
				v-if="open"
				ref="panel"
				class="detail-popover-content"
				role="tooltip"
				:aria-label="label"
				:style="panelStyle"
				@mouseenter="cancelDismiss"
				@mouseleave="scheduleDismiss"
			>
				<slot />
			</div>
		</Teleport>
	</span>
</template>

<style scoped>
.detail-popover {
	display: inline-flex;
	vertical-align: middle;
}
.detail-popover-trigger {
	display: inline-flex;
	min-width: 28px;
	min-height: var(--ti-control-height);
	align-items: center;
	justify-content: center;
	padding: 2px var(--ti-space-2);
	border: 1px solid var(--ti-border-strong);
	border-radius: var(--ti-radius-card);
	background: var(--ti-surface);
	color: var(--ti-accent);
	font: inherit;
	font-variant-numeric: tabular-nums;
	cursor: pointer;
}
.detail-popover-trigger:hover,
.detail-popover-trigger[aria-expanded="true"] {
	border-color: var(--ti-accent);
	background: var(--ti-accent-soft);
	box-shadow: var(--ti-shadow-card);
}
.detail-popover-trigger:focus-visible {
	border-color: var(--ti-accent);
	background: var(--ti-accent-soft);
	outline: none;
	box-shadow: var(--ti-focus-ring);
}
.detail-popover-content {
	position: fixed;
	z-index: var(--ti-layer-popover);
	box-sizing: border-box;
	width: max-content;
	min-width: 180px;
	max-width: min(320px, calc(100vw - 24px));
	max-height: min(360px, calc(100vh - 24px));
	overflow: auto;
	padding: var(--ti-space-2) var(--ti-space-3);
	border: 1px solid var(--ti-border-strong);
	border-radius: var(--ti-radius-control);
	background: var(--ti-surface);
	color: var(--ti-ink);
	box-shadow: var(--ti-shadow-overlay);
	font-size: var(--ti-font-small);
	line-height: 1.65;
	pointer-events: auto;
}
</style>
