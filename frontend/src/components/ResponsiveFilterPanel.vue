<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useResponsiveLayout } from "../composables/useResponsiveLayout";

const props = withDefaults(
	defineProps<{
		open?: boolean;
		count?: number;
		title?: string;
		clearable?: boolean;
		showTrigger?: boolean;
	}>(),
	{
		open: false,
		count: 0,
		title: "筛选",
		clearable: false,
		showTrigger: true,
	},
);
const emit = defineEmits<{ "update:open": [value: boolean]; clear: [] }>();
const invoker = ref<HTMLElement | null>(null);
const panel = ref<HTMLElement | null>(null);
const { isMobile } = useResponsiveLayout();
let previousBodyOverflow: string | undefined;
let previousDocumentOverflow: string | undefined;
const titleId = "filter-title-" + Math.random().toString(36).slice(2);

function acquireMobileScrollLock() {
	if (previousBodyOverflow !== undefined || typeof document === "undefined") return;
	previousBodyOverflow = document.body.style.overflow;
	previousDocumentOverflow = document.documentElement.style.overflow;
	document.body.style.overflow = "hidden";
	document.documentElement.style.overflow = "hidden";
}
function releaseMobileScrollLock() {
	if (previousBodyOverflow === undefined || typeof document === "undefined") return;
	document.body.style.overflow = previousBodyOverflow;
	document.documentElement.style.overflow = previousDocumentOverflow || "";
	previousBodyOverflow = undefined;
	previousDocumentOverflow = undefined;
}

function close() {
	emit("update:open", false);
	if (isMobile.value) void nextTick(() => invoker.value?.focus());
}
function openPanel(event?: Event) {
	if (event?.currentTarget instanceof HTMLElement) invoker.value = event.currentTarget;
	emit("update:open", true);
}
function keydown(event: KeyboardEvent) {
	if (!props.open || !isMobile.value) return;
	if (event.key === "Escape") {
		event.preventDefault();
		event.stopPropagation();
		close();
		return;
	}
	if (event.key !== "Tab" || !panel.value) return;
	const focusable = Array.from(
		panel.value.querySelectorAll<HTMLElement>(
			'button,input,select,textarea,[tabindex]:not([tabindex="-1"])',
		),
	).filter((node) => !node.hasAttribute("disabled"));
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
function onPointerDown(event: PointerEvent) {
	if (!props.open || !isMobile.value || !(event.target instanceof Node)) return;
	if (panel.value?.contains(event.target)) return;
	close();
}
watch(
	[() => props.open, isMobile],
	async ([open, mobile]) => {
		if (open && mobile) {
			acquireMobileScrollLock();
			// Pages may use their own visible mobile trigger so the sidebar trigger
			// can stay out of the desktop grid. Preserve that trigger for close.
			if (!invoker.value && document.activeElement instanceof HTMLElement)
				invoker.value = document.activeElement;
			await nextTick();
			if (props.open && isMobile.value)
				panel.value
					?.querySelector<HTMLElement>('button,input,select,textarea,[tabindex="0"]')
					?.focus();
		} else {
			releaseMobileScrollLock();
		}
	},
	{ immediate: true },
);
onMounted(() => {
	window.addEventListener("keydown", keydown);
	document.addEventListener("pointerdown", onPointerDown);
});
onBeforeUnmount(() => {
	window.removeEventListener("keydown", keydown);
	document.removeEventListener("pointerdown", onPointerDown);
	releaseMobileScrollLock();
});
defineExpose({ openPanel, close });
</script>

<template>
	<button v-if="showTrigger" type="button" class="filter-trigger" @click="openPanel($event)">
		筛选<span v-if="count" class="filter-count">{{ count }}</span>
	</button>
	<Teleport to="body" :disabled="!isMobile">
		<aside
			ref="panel"
			class="filter-sidebar filter-drawer"
			data-filter-surface="compact"
			:class="{ 'filter-drawer-open': open }"
			:role="open && isMobile ? 'dialog' : undefined"
			:aria-modal="open && isMobile ? 'true' : undefined"
			:aria-labelledby="titleId"
			:data-filter-open="open && isMobile ? 'true' : 'false'"
			@keydown="keydown"
		>
			<header class="filter-drawer-header">
				<button type="button" class="filter-drawer-back" @click="close">‹ 返回</button>
				<h2 :id="titleId">{{ title }}</h2>
			</header>
			<slot />
			<button
				v-if="clearable"
				type="button"
				class="clear-all-filters compact-filter-clear"
				@click="emit('clear')"
			>
				恢复默认筛选
			</button>
			<button type="button" class="primary filter-done filter-drawer-done" @click="close">
				完成
			</button>
		</aside>
	</Teleport>
	<Teleport to="body">
		<div v-if="open && isMobile" class="filter-drawer-backdrop" @click.self="close"></div>
	</Teleport>
</template>
