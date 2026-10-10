<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import type { PageAction } from "./pageActions";

const props = withDefaults(
	defineProps<{ actions: PageAction[]; label?: string; disabled?: boolean }>(),
	{ label: "新建操作" },
);
const emit = defineEmits<{ select: [kind: string] }>();
const open = ref(false);
const trigger = ref<HTMLButtonElement>();
const root = ref<HTMLElement>();
const triggerDisabled = computed(
	() =>
		Boolean(props.disabled) ||
		!props.actions.length ||
		props.actions.every((action) => action.disabled || action.loading),
);
function enabledButtons(menu: Element | null) {
	return menu
		? Array.from(menu.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')).filter(
				(button) => !button.disabled,
			)
		: [];
}
function close() {
	open.value = false;
}
function onKeydown(event: KeyboardEvent) {
	if (event.key === "Escape") {
		close();
		void trigger.value?.focus();
	}
}
function onPointerdown(event: PointerEvent) {
	if (!(event.target instanceof Node) || !root.value?.contains(event.target)) close();
}
function move(event: KeyboardEvent, direction: number) {
	const menu = (event.currentTarget as HTMLElement).closest('[role="menu"]');
	const buttons = enabledButtons(menu);
	if (!buttons.length) return;
	const index = buttons.indexOf(event.currentTarget as HTMLButtonElement);
	buttons[(index + direction + buttons.length) % buttons.length]?.focus();
}
function edge(event: KeyboardEvent, last = false) {
	const menu = (event.currentTarget as HTMLElement).closest('[role="menu"]');
	const buttons = enabledButtons(menu);
	if (!buttons.length) return;
	buttons[last ? buttons.length - 1 : 0]?.focus();
}
function choose(kind: string) {
	const action = props.actions.find((item) => item.kind === kind);
	if (action?.disabled || action?.loading || props.disabled) return;
	close();
	void trigger.value?.focus();
	emit("select", kind);
}
watch(open, async (value) => {
	if (value) {
		await nextTick();
		root.value?.querySelector<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')?.focus();
	}
});
onMounted(() => {
	document.addEventListener("keydown", onKeydown);
	document.addEventListener("pointerdown", onPointerdown);
});
onBeforeUnmount(() => {
	document.removeEventListener("keydown", onKeydown);
	document.removeEventListener("pointerdown", onPointerdown);
});
</script>

<template>
	<div ref="root" class="floating-action-menu">
		<div v-if="open" class="floating-actions" role="menu" :aria-label="label">
			<button
				v-for="action in props.actions"
				:key="action.kind"
				type="button"
				role="menuitem"
				@keydown.down.prevent="move($event, 1)"
				@keydown.up.prevent="move($event, -1)"
				@keydown.home.prevent="edge($event)"
				@keydown.end.prevent="edge($event, true)"
				@click="choose(action.kind)"
				:disabled="action.disabled || action.loading || props.disabled"
			>
				{{ action.loading ? "正在加载…" : action.mobileLabel || action.label }}
			</button>
		</div>
		<button
			ref="trigger"
			type="button"
			class="action-fab"
			:class="{ 'overflow-action-trigger': true }"
			:aria-expanded="open"
			:disabled="triggerDisabled"
			:aria-label="label"
			@click="open = !open"
		>
			＋
		</button>
	</div>
</template>
