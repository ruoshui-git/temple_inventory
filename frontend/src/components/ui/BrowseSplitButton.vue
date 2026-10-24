<script setup lang="ts">
import UiButton from "./UiButton.vue";
import InventoryIcon from "../InventoryIcon.vue";
import PopupMenu from "./PopupMenu.vue";
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { useResponsiveLayout } from "../../composables/useResponsiveLayout";

export type BrowseAction = { label: string; kind: string; icon?: string };
const props = defineProps<{
	label: string;
	kind: string;
	icon: string;
	options: BrowseAction[];
}>();
const emit = defineEmits<{ select: [kind: string] }>();
const { isMobile } = useResponsiveLayout();
const menuOpen = ref(false);
const transientOpen = ref(false);
const keyboardOpen = ref(false);
const hidden = computed(
	() => isMobile.value && (menuOpen.value || transientOpen.value || keyboardOpen.value),
);
let observer: MutationObserver | undefined;
function updateOverlayState() {
	transientOpen.value = Boolean(
		document.querySelector(
			".preview-overlay, .preview-filter-popover, .popup-menu-panel--sheet[style*='display: block']",
		),
	);
}
function updateViewport() {
	const viewport = window.visualViewport;
	const target = document.activeElement;
	keyboardOpen.value = Boolean(
		viewport &&
		window.innerHeight - viewport.height > 150 &&
		target instanceof HTMLElement &&
		/^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName),
	);
}
onMounted(() => {
	observer = new MutationObserver(() => {
		updateOverlayState();
		updateViewport();
	});
	observer.observe(document.body, { childList: true, subtree: true });
	window.visualViewport?.addEventListener("resize", updateViewport);
	document.addEventListener("focusin", updateViewport);
	document.addEventListener("focusout", updateViewport);
});
onBeforeUnmount(() => {
	observer?.disconnect();
	window.visualViewport?.removeEventListener("resize", updateViewport);
	document.removeEventListener("focusin", updateViewport);
	document.removeEventListener("focusout", updateViewport);
});
function choose(kind: string) {
	emit("select", kind);
}
</script>

<template>
	<Teleport to="body" :disabled="!isMobile">
		<div class="browse-split-button" :class="{ 'is-hidden': hidden }">
			<UiButton variant="primary" :icon="icon" @click="choose(kind)">{{ label }}</UiButton>
			<PopupMenu
				label="选择新建类型"
				variant="split"
				align="end"
				sheet
				@open="menuOpen = true"
				@close="menuOpen = false"
			>
				<button
					v-for="option in props.options"
					:key="option.kind"
					type="button"
					role="menuitem"
					@click="choose(option.kind)"
				>
					<InventoryIcon v-if="option.icon" :name="option.icon" />{{ option.label }}
				</button>
			</PopupMenu>
		</div>
	</Teleport>
</template>
