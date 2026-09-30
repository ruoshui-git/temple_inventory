<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";

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
				{{ action.label }}
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
	flex: 0 0 38px;
	block-size: 38px;
	max-block-size: 38px;
	max-inline-size: 38px;
	width: 38px;
	min-width: 38px;
	height: 38px;
	min-height: 38px;
	aspect-ratio: 1;
	place-items: center;
	padding: 0;
	border: 1px solid #e6e1d9;
	border-radius: 50%;
	background: #fff;
	color: #6c6259;
	font-size: 23px;
	line-height: 1;
}
.overflow-action-popup {
	position: absolute;
	z-index: 60;
	top: calc(100% + 7px);
	right: 0;
	display: grid;
	min-width: 144px;
	padding: 5px;
	border: 1px solid #e4ddd4;
	border-radius: 9px;
	background: #fff;
	box-shadow: 0 10px 28px rgb(45 35 24 / 18%);
}
.overflow-action-popup button {
	min-height: 42px;
	padding: 8px 11px;
	border: 0;
	border-radius: 6px;
	background: transparent;
	color: #343c46;
	text-align: left;
}
.overflow-action-popup button:hover,
.overflow-action-popup button:focus-visible {
	background: #f4efe8;
}
</style>
