<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";

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
const isMobile = ref(
	typeof window === "undefined" || typeof window.matchMedia !== "function"
		? true
		: !window.matchMedia("(min-width: 1024px)").matches,
);
const previousBodyOverflow = ref("");
const previousDocumentOverflow = ref("");
let mediaQuery: MediaQueryList | undefined;
const titleId = "filter-title-" + Math.random().toString(36).slice(2);

function syncSurface(event?: MediaQueryListEvent | MediaQueryList) {
	if (event) {
		isMobile.value = !event.matches;
		return;
	}
	if (mediaQuery) isMobile.value = !mediaQuery.matches;
}

function close() {
	emit("update:open", false);
	void nextTick(() => invoker.value?.focus());
}
function openPanel(event?: Event) {
	if (event?.currentTarget instanceof HTMLElement) invoker.value = event.currentTarget;
	if (typeof window !== "undefined" && typeof window.matchMedia === "function")
		isMobile.value = !window.matchMedia("(min-width: 1024px)").matches;
	emit("update:open", true);
}
function keydown(event: KeyboardEvent) {
	if (!props.open) return;
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
	if (!props.open || !(event.target instanceof Node)) return;
	if (panel.value?.contains(event.target)) return;
	close();
}
watch(
	() => props.open,
	async (value) => {
		if (value) {
			previousBodyOverflow.value = document.body.style.overflow;
			previousDocumentOverflow.value = document.documentElement.style.overflow;
			document.body.style.overflow = "hidden";
			document.documentElement.style.overflow = "hidden";
			// Pages may use their own visible mobile trigger so the sidebar trigger
			// can stay out of the desktop grid. Preserve that trigger for close.
			if (!invoker.value && document.activeElement instanceof HTMLElement)
				invoker.value = document.activeElement;
			await nextTick();
			panel.value
				?.querySelector<HTMLElement>('button,input,select,textarea,[tabindex="0"]')
				?.focus();
		} else {
			document.body.style.overflow = previousBodyOverflow.value;
			document.documentElement.style.overflow = previousDocumentOverflow.value;
			previousBodyOverflow.value = "";
			previousDocumentOverflow.value = "";
		}
	},
	{ immediate: true },
);
onMounted(() => {
	if (typeof window !== "undefined" && typeof window.matchMedia === "function") {
		mediaQuery = window.matchMedia("(min-width: 1024px)");
		syncSurface(mediaQuery);
		if (typeof mediaQuery.addEventListener === "function")
			mediaQuery.addEventListener("change", syncSurface);
		else mediaQuery.addListener(syncSurface);
	}
	window.addEventListener("keydown", keydown);
	document.addEventListener("pointerdown", onPointerDown);
});
onBeforeUnmount(() => {
	if (mediaQuery) {
		if (typeof mediaQuery.removeEventListener === "function")
			mediaQuery.removeEventListener("change", syncSurface);
		else mediaQuery.removeListener(syncSurface);
		mediaQuery = undefined;
	}
	window.removeEventListener("keydown", keydown);
	document.removeEventListener("pointerdown", onPointerDown);
	document.body.style.overflow = previousBodyOverflow.value;
	document.documentElement.style.overflow = previousDocumentOverflow.value;
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
