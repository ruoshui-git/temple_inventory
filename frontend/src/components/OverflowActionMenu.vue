<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import InventoryIcon from "./InventoryIcon.vue";

export type OverflowAction = { kind: string; label: string };

const props = withDefaults(defineProps<{ actions: OverflowAction[]; label?: string }>(), {
	label: "更多操作",
});
const emit = defineEmits<{ select: [kind: string] }>();
const open = ref(false);
const root = ref<HTMLElement>();
const trigger = ref<HTMLButtonElement>();

function close(restoreFocus = false) {
	open.value = false;
	if (restoreFocus) void trigger.value?.focus();
}
function onDocumentPointer(event: PointerEvent) {
	if (!(event.target instanceof Node) || !root.value?.contains(event.target)) close();
}
function menuItems() {
	return root.value
		? Array.from(root.value.querySelectorAll<HTMLButtonElement>("[role=menuitem]"))
		: [];
}
function onKeydown(event: KeyboardEvent) {
	if (!open.value) return;
	if (event.key === "Escape") {
		event.preventDefault();
		close(true);
		return;
	}
	const items = menuItems();
	const current = document.activeElement as HTMLButtonElement;
	const index = items.indexOf(current);
	if (event.key === "ArrowDown" || event.key === "ArrowUp") {
		event.preventDefault();
		const direction = event.key === "ArrowDown" ? 1 : -1;
		items[(index + direction + items.length) % items.length]?.focus();
	} else if (event.key === "Home" || event.key === "End") {
		event.preventDefault();
		items[event.key === "Home" ? 0 : items.length - 1]?.focus();
	}
}
function choose(kind: string) {
	close(true);
	emit("select", kind);
}
watch(open, async (value) => {
	if (value) {
		await nextTick();
		menuItems()[0]?.focus();
	}
});
onMounted(() => {
	document.addEventListener("pointerdown", onDocumentPointer);
	document.addEventListener("keydown", onKeydown);
});
onBeforeUnmount(() => {
	document.removeEventListener("pointerdown", onDocumentPointer);
	document.removeEventListener("keydown", onKeydown);
});
</script>

<template>
	<div ref="root" class="overflow-action-menu">
		<button
			ref="trigger"
			type="button"
			class="overflow-action-trigger"
			:aria-label="props.label"
			:aria-expanded="open"
			aria-haspopup="menu"
			@click="open = !open"
		>
			<span aria-hidden="true">⋯</span>
		</button>
		<div v-if="open" class="overflow-action-popup" role="menu" :aria-label="props.label">
			<button
				v-for="action in props.actions"
				:key="action.kind"
				type="button"
				role="menuitem"
				@click="choose(action.kind)"
			>
				<InventoryIcon v-if="action.kind === 'Export'" name="download" />{{ action.label }}
			</button>
		</div>
	</div>
</template>

<style scoped>
.overflow-action-menu {
	position: relative;
	flex: none;
}
.overflow-action-trigger {
	display: grid;
	box-sizing: border-box;
	flex: 0 0 var(--ti-control-height);
	block-size: var(--ti-control-height);
	max-block-size: var(--ti-control-height);
	max-inline-size: var(--ti-control-height);
	width: var(--ti-control-height);
	min-width: var(--ti-control-height);
	height: var(--ti-control-height);
	min-height: var(--ti-control-height);
	aspect-ratio: 1;
	place-items: center;
	padding: 0;
	border: 1px solid var(--ti-border);
	border-radius: 50%;
	background: var(--ti-surface);
	color: var(--ti-muted);
	font-size: var(--ti-font-heading);
	line-height: 1;
}
.overflow-action-popup {
	position: absolute;
	z-index: var(--ti-layer-popover);
	top: calc(100% + 7px);
	right: 0;
	display: grid;
	min-width: 144px;
	padding: var(--ti-space-1);
	border: 1px solid var(--ti-border);
	border-radius: var(--ti-radius-control);
	background: var(--ti-surface);
	box-shadow: var(--ti-shadow-overlay);
}
.overflow-action-popup button {
	min-height: var(--ti-control-height);
	padding: var(--ti-space-2) var(--ti-space-3);
	border: 0;
	border-radius: var(--ti-radius-control);
	background: transparent;
	color: var(--ti-ink);
	text-align: left;
}
@media (max-width: 1023px) {
	.overflow-action-trigger,
	.overflow-action-popup button {
		min-height: var(--ti-density-control);
	}
	.overflow-action-trigger {
		width: var(--ti-density-control);
		min-width: var(--ti-density-control);
		max-width: var(--ti-density-control);
		flex-basis: var(--ti-density-control);
	}
}
.overflow-action-popup button:hover,
.overflow-action-popup button:focus-visible {
	background: var(--ti-canvas);
}
</style>
