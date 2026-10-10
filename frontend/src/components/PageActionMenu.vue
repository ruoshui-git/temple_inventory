<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import InventoryIcon from "./InventoryIcon.vue";
import type { PageAction } from "./pageActions";

const props = withDefaults(
	defineProps<{ actions: PageAction[]; label?: string; disabled?: boolean }>(),
	{ label: "新建操作", disabled: false },
);
const emit = defineEmits<{ select: [kind: string] }>();
const root = ref<HTMLElement>();
const trigger = ref<HTMLButtonElement>();
const open = ref(false);
const triggerDisabled = () =>
	props.disabled ||
	!props.actions.length ||
	props.actions.every((action) => action.disabled || action.loading);

function enabledItems() {
	return root.value
		? Array.from(root.value.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')).filter(
				(item) => !item.disabled,
			)
		: [];
}
function close(restoreFocus = false) {
	open.value = false;
	if (restoreFocus) void trigger.value?.focus();
}
function toggle() {
	if (triggerDisabled()) return;
	open.value = !open.value;
}
function select(kind: string) {
	const action = props.actions.find((item) => item.kind === kind);
	if (!action || action.disabled || action.loading || props.disabled) return;
	close(true);
	emit("select", kind);
}
function move(event: KeyboardEvent, direction: number) {
	const items = enabledItems();
	if (!items.length) return;
	const index = items.indexOf(document.activeElement as HTMLButtonElement);
	items[(index + direction + items.length) % items.length]?.focus();
}
function moveToEdge(last = false) {
	const items = enabledItems();
	if (items.length) items[last ? items.length - 1 : 0]?.focus();
}
function onKeydown(event: KeyboardEvent) {
	if (!open.value) return;
	if (event.key === "Escape") {
		event.preventDefault();
		close(true);
	}
}
function onPointerdown(event: PointerEvent) {
	if (!(event.target instanceof Node) || !root.value?.contains(event.target)) close();
}
function onFocusout(event: FocusEvent) {
	const next = event.relatedTarget as Node | null;
	if (!next || !root.value?.contains(next)) close();
}
watch(open, async (value) => {
	if (value) {
		await nextTick();
		enabledItems()[0]?.focus();
	}
});
onMounted(() => {
	document.addEventListener("keydown", onKeydown);
	document.addEventListener("pointerdown", onPointerdown);
});
onBeforeUnmount(() => {
	document.removeEventListener("keydown", onKeydown);
	document.removeEventListener("pointerdown", onPointerdown);
	open.value = false;
});
</script>

<template>
	<div ref="root" class="page-action-menu" @focusout="onFocusout">
		<button
			ref="trigger"
			type="button"
			class="page-action-menu__trigger"
			:disabled="triggerDisabled()"
			:aria-label="label"
			:aria-expanded="open"
			aria-haspopup="menu"
			@click="toggle"
		>
			<span aria-hidden="true">＋</span>{{ label }}
		</button>
		<div v-if="open" class="page-action-menu__popup" role="menu" :aria-label="label">
			<button
				v-for="action in actions"
				:key="action.kind"
				type="button"
				role="menuitem"
				:disabled="action.disabled || action.loading || disabled"
				:aria-busy="action.loading || undefined"
				@keydown.down.prevent="move($event, 1)"
				@keydown.up.prevent="move($event, -1)"
				@keydown.home.prevent="moveToEdge()"
				@keydown.end.prevent="moveToEdge(true)"
				@click="select(action.kind)"
			>
				<InventoryIcon v-if="action.icon" :name="action.icon" />
				{{ action.loading ? "正在加载…" : action.label }}
			</button>
		</div>
	</div>
</template>

<style scoped>
.page-action-menu {
	position: relative;
	display: inline-flex;
}
.page-action-menu__trigger {
	display: inline-flex;
	align-items: center;
	justify-content: center;
	gap: 5px;
	min-height: 40px;
	padding: 8px 13px;
	border: 1px solid #9b571d;
	border-radius: 9px;
	background: #9b571d;
	color: #fff;
	font-weight: 700;
}
.page-action-menu__trigger:hover:not(:disabled),
.page-action-menu__trigger:focus-visible:not(:disabled) {
	border-color: #704326;
	background: #704326;
}
.page-action-menu__popup {
	position: absolute;
	z-index: 60;
	top: calc(100% + 7px);
	right: 0;
	display: grid;
	min-width: 176px;
	gap: 2px;
	padding: 5px;
	border: 1px solid #e4ddd4;
	border-radius: 9px;
	background: #fff;
	box-shadow: 0 10px 28px rgb(45 35 24 / 18%);
}
.page-action-menu__popup button {
	display: flex;
	align-items: center;
	gap: 7px;
	min-height: 42px;
	padding: 8px 11px;
	border: 0;
	border-radius: 6px;
	background: transparent;
	color: #343c46;
	text-align: left;
}
.page-action-menu__popup button:hover:not(:disabled),
.page-action-menu__popup button:focus-visible:not(:disabled) {
	background: #f4efe8;
}
</style>
