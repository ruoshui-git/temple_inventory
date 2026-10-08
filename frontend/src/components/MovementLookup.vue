<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";

defineOptions({ inheritAttrs: false });

type Option = { label: string; value: string };
const props = withDefaults(
	defineProps<{
		modelValue: string;
		query?: string;
		options: Option[];
		loading?: boolean;
		placeholder?: string;
	}>(),
	{ query: "", loading: false, placeholder: "搜索并选择" },
);
const emit = defineEmits<{
	"update:modelValue": [value: string];
	"update:query": [value: string];
}>();
const open = ref(false);
const selectedLabel = computed(
	() => props.options.find((option) => option.value === props.modelValue)?.label || "",
);
const displayValue = computed(() => (open.value ? props.query : selectedLabel.value));
function onInput(event: Event) {
	open.value = true;
	emit("update:query", (event.target as HTMLInputElement).value);
}
function select(option: Option) {
	emit("update:modelValue", option.value);
	emit("update:query", option.label);
	open.value = false;
}
function onFocus() {
	open.value = true;
	emit("update:query", props.query || "");
}
function closeIfOutside(event: PointerEvent) {
	if (event.target instanceof Node && !root.value?.contains(event.target)) open.value = false;
}
const root = ref<HTMLElement | null>(null);
function onKeydown(event: KeyboardEvent) {
	if (!open.value) return;
	if (event.key === "Escape") {
		event.preventDefault();
		open.value = false;
		return;
	}
	if (event.key === "Tab") {
		const next = event.shiftKey
			? (document.activeElement as HTMLElement | null)?.previousElementSibling
			: (document.activeElement as HTMLElement | null)?.nextElementSibling;
		if (next && !root.value?.contains(next)) open.value = false;
	}
}
function onFocusout(event: FocusEvent) {
	if (event.relatedTarget instanceof Node && root.value?.contains(event.relatedTarget)) return;
	open.value = false;
}
onMounted(() => {
	document.addEventListener("pointerdown", closeIfOutside);
	document.addEventListener("keydown", onKeydown);
});
onBeforeUnmount(() => {
	document.removeEventListener("pointerdown", closeIfOutside);
	document.removeEventListener("keydown", onKeydown);
});
</script>
<template>
	<div ref="root" class="movement-lookup" @focusout="onFocusout">
		<input
			v-bind="$attrs"
			:value="displayValue"
			:placeholder="placeholder"
			:aria-expanded="open"
			role="combobox"
			autocomplete="off"
			@focus="onFocus"
			@input="onInput"
			@keydown="onKeydown"
		/>
		<div
			v-if="open"
			class="movement-lookup-options"
			:class="{ 'is-loading': loading }"
			role="listbox"
			:aria-busy="loading"
		>
			<span v-if="loading" class="movement-lookup-status" role="status"
				><span class="loading-spinner loading-spinner-small" aria-hidden="true"></span
				>正在搜索…</span
			>
			<button
				v-for="option in options"
				:key="option.value"
				type="button"
				role="option"
				:disabled="loading"
				:aria-selected="option.value === modelValue"
				@click="select(option)"
			>
				{{ option.label }}
			</button>
			<span v-if="!loading && !options.length" class="movement-lookup-status"
				>没有匹配项</span
			>
		</div>
	</div>
</template>
<style scoped>
.movement-lookup {
	position: relative;
}
.movement-lookup input {
	width: 100%;
}
.movement-lookup-options {
	position: absolute;
	top: calc(100% + 3px);
	left: 0;
	right: 0;
	z-index: 5;
	display: grid;
	max-height: 220px;
	overflow: auto;
	padding: 4px;
	background: #fffaf2;
	border: 1px solid #eadfce;
	box-shadow: 0 8px 20px rgba(65, 44, 22, 0.12);
}
.movement-lookup-options button {
	padding: 7px 8px;
	border: 0;
	background: transparent;
	text-align: left;
}
.movement-lookup-options button:hover,
.movement-lookup-options button[aria-selected="true"] {
	background: #fff0d9;
}
.movement-lookup-options.is-loading button {
	opacity: 0.55;
}
.movement-lookup-status {
	padding: 8px;
	color: #6b6257;
}
</style>
