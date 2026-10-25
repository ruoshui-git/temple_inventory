<script setup lang="ts">
import { nextTick, onUpdated, ref } from "vue";
import { useAnchoredPopup } from "../../composables/useAnchoredPopup";
import { useResponsiveLayout } from "../../composables/useResponsiveLayout";
import InventoryIcon from "../InventoryIcon.vue";
import Overlay from "./Overlay.vue";

const props = withDefaults(
	defineProps<{
		label: string;
		align?: "start" | "end";
		variant?: "split" | "icon" | "labeled";
		sheet?: boolean;
	}>(),
	{ align: "start", variant: "icon" },
);
const emit = defineEmits<{ open: []; close: []; activate: [] }>();
const responsive = useResponsiveLayout(false);
const useSheet = ref(false);
const anchoredOpen = ref(false);
const anchor = ref<HTMLButtonElement>();
const popup = ref<HTMLElement>();
const open = ref(false);
const { style, target } = useAnchoredPopup({
	anchor,
	popup,
	open: anchoredOpen,
	align: props.align,
	onClose: (restore) => close(restore),
});
onUpdated(() =>
	popup.value?.querySelectorAll<HTMLElement>("button, a[href]").forEach((item) => {
		if (!item.hasAttribute("role")) item.setAttribute("role", "menuitem");
	}),
);
function close(restoreFocus = false) {
	if (!open.value) return;
	open.value = false;
	anchoredOpen.value = false;
	emit("close");
	if (restoreFocus) void nextTick(() => anchor.value?.focus({ preventScroll: true }));
}
async function toggle() {
	if (open.value) return close();
	useSheet.value = props.sheet && responsive.isSurface("mobile");
	anchoredOpen.value = !useSheet.value;
	open.value = true;
	emit("open");
	await nextTick();
	if (open.value)
		popup.value
			?.querySelector<HTMLElement>("[role^='menuitem'], button, a[href]")
			?.focus({ preventScroll: true });
}
function keydown(event: KeyboardEvent) {
	if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
	const items = Array.from(
		popup.value?.querySelectorAll<HTMLElement>(
			"[role='menuitem'], button:not(:disabled), a[href]",
		) || [],
	).filter((item) => item.tabIndex >= 0);
	if (!items.length) return;
	event.preventDefault();
	const index = items.indexOf(document.activeElement as HTMLElement);
	const next =
		event.key === "Home"
			? 0
			: event.key === "End"
				? items.length - 1
				: event.key === "ArrowDown"
					? (index + 1) % items.length
					: (index <= 0 ? items.length : index) - 1;
	items[next]?.focus();
}
function activated(event: MouseEvent) {
	if ((event.target as Element | null)?.closest("button, a[href]")) {
		emit("activate");
		close();
	}
}
</script>

<template>
	<span class="popup-menu-host">
		<button
			ref="anchor"
			type="button"
			class="popup-menu-trigger"
			:class="`popup-menu-trigger-${variant}`"
			:aria-label="label"
			:title="label"
			aria-haspopup="menu"
			:aria-expanded="open"
			@click="toggle"
		>
			<slot name="trigger"
				><InventoryIcon :name="variant === 'split' ? 'chevron-down' : 'more'"
			/></slot>
		</button>
		<Overlay
			v-if="useSheet && open"
			:title="label"
			panel-class="popup-menu-sheet-overlay"
			content-class="popup-menu-sheet-content"
			@close="close()"
		>
			<div class="popup-menu-sheet-handle" aria-hidden="true" />
			<h3 class="popup-menu-sheet-title">{{ label }}</h3>
			<div
				ref="popup"
				class="popup-menu-panel popup-menu-panel--sheet browse-action-menu"
				role="menu"
				:aria-label="label"
				@keydown="keydown"
				@click="activated"
			>
				<slot />
			</div>
			<button class="popup-menu-sheet-cancel" type="button" @click="close(true)">
				取消
			</button>
		</Overlay>
		<Teleport v-else :to="target">
			<div
				ref="popup"
				v-show="open && !useSheet"
				class="popup-menu-panel browse-action-menu"
				:class="{ 'popup-menu-panel--sheet': sheet }"
				role="menu"
				:aria-label="label"
				:style="style"
				@keydown="keydown"
				@click="activated"
			>
				<slot />
			</div>
		</Teleport>
	</span>
</template>

<style scoped>
.popup-menu-panel {
	z-index: var(--p-z-menu);
	overflow-y: auto;
	overscroll-behavior: contain;
}
@media (pointer: coarse), (max-width: 1023px) {
	.popup-menu-panel :deep(button),
	.popup-menu-panel :deep(a[href]) {
		min-height: 44px;
	}
	.popup-menu-trigger:not(.popup-menu-trigger-labeled) {
		min-width: 44px;
		min-height: 44px;
	}
}
@media (prefers-reduced-motion: reduce) {
	.popup-menu-panel,
	.popup-menu-trigger {
		scroll-behavior: auto;
		transition: none !important;
		animation: none !important;
	}
}
</style>
