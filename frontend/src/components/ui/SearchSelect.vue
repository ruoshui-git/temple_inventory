<script setup lang="ts">
import { computed, ref, useId, watch, onMounted, onBeforeUnmount, nextTick } from "vue";
import VirtualList from "./VirtualList.vue";
import UiButton from "./UiButton.vue";
import { useAnchoredPopup } from "../../composables/useAnchoredPopup";
const virtualList = ref<InstanceType<typeof VirtualList>>();
export type SearchOption = {
	value: string;
	label: string;
	detail?: string;
	keywords?: string;
	title?: string;
	disabled?: boolean;
};
const props = withDefaults(
	defineProps<{
		modelValue?: string;
		options: (string | SearchOption)[];
		label: string;
		disabled?: boolean;
		placeholder?: string;
		pageSize?: number;
		clearable?: boolean;
		remote?: boolean;
		loading?: boolean;
		error?: string;
		total?: number;
		hasMore?: boolean;
		selectedLabel?: string;
		invalid?: boolean;
		id?: string;
		ariaDescribedBy?: string;
		ariaInvalid?: boolean | "true" | "false";
		externalLabel?: boolean;
	}>(),
	{ pageSize: 20, clearable: true },
);
const emit = defineEmits<{
	"update:modelValue": [value: string];
	search: [value: string];
	loadMore: [];
	retry: [];
}>();
const generatedId = useId();
const id = computed(() => props.id || generatedId);
const root = ref<HTMLElement>();
const input = ref<HTMLInputElement>();
const popup = ref<HTMLElement>();
const anchor = ref<HTMLElement>();
function setInput(element: unknown) {
	input.value = (element as HTMLInputElement | null) || undefined;
	anchor.value = input.value;
}
function close() {
	open.value = false;
	query.value = "";
	typed.value = false;
}
function preserveInputFocus(event: MouseEvent) {
	const menu = popup.value;
	const scrollbarWidth = menu ? menu.offsetWidth - menu.clientWidth : 0;
	if (
		menu &&
		event.target === menu &&
		scrollbarWidth > 0 &&
		event.clientX >= menu.getBoundingClientRect().right - scrollbarWidth
	)
		return;
	event.preventDefault();
}
function outside(event: PointerEvent) {
	if (
		event.target instanceof Node &&
		!root.value?.contains(event.target) &&
		!popup.value?.contains(event.target)
	)
		close();
}
onMounted(() => document.addEventListener("pointerdown", outside));
onBeforeUnmount(() => document.removeEventListener("pointerdown", outside));
watch(
	() => props.disabled,
	(disabled) => {
		if (disabled) close();
	},
);
const open = ref(false),
	query = ref(""),
	typed = ref(false),
	active = ref(0),
	limit = ref(props.pageSize);
const { style: popupStyle, target: popupTarget } = useAnchoredPopup({
	anchor,
	popup,
	open,
	align: "start",
	gap: 4,
	margin: 8,
	maxWidth: 360,
	maxHeight: 360,
	preferredMinHeight: 240,
	onClose: () => close(),
});
const state = ref<"ready" | "loading" | "error">("ready");
const options = computed(() =>
	props.options.map((o) => (typeof o === "string" ? { value: o, label: o } : o)),
);
const selectedOption = computed(() =>
	options.value.find((option) => option.value === props.modelValue),
);
const selected = computed(
	() => props.selectedLabel || selectedOption.value?.label || props.modelValue || "",
);
const matches = computed(() =>
	props.remote
		? options.value
		: !typed.value
			? options.value
			: options.value.filter((o) =>
					`${o.label} ${o.value} ${o.detail || ""} ${o.keywords || ""}`
						.toLocaleLowerCase()
						.includes(query.value.trim().toLocaleLowerCase()),
				),
);
const virtual = computed(() => matches.value.length > 100);
const visible = computed(() =>
	virtual.value ? matches.value : matches.value.slice(0, limit.value),
);
watch(query, () => {
	limit.value = props.pageSize;
	active.value = 0;
	if (props.remote && open.value) emit("search", query.value);
});
watch(open, (value) => {
	if (!value) return;
	active.value = Math.max(
		0,
		matches.value.findIndex((option) => option.value === props.modelValue),
	);
	if (!props.remote && active.value >= limit.value) limit.value = active.value + props.pageSize;
	if (props.remote) emit("search", query.value);
	void nextTick(() => {
		if (virtual.value && active.value >= 0) virtualList.value?.scrollToIndex(active.value);
		else
			root.value
				?.querySelector("[role=option][aria-selected=true]")
				?.scrollIntoView?.({ block: "nearest" });
	});
});
watch(
	() => [props.loading, props.error],
	() => {
		if (props.remote)
			state.value = props.loading ? "loading" : props.error ? "error" : "ready";
	},
	{ immediate: true },
);
function choose(value: string) {
	emit("update:modelValue", value);
	open.value = false;
	query.value = "";
}
function key(event: KeyboardEvent) {
	if (event.key === "Escape" && open.value) {
		event.preventDefault();
		event.stopPropagation();
		close();
	}
	if (event.key === "Tab") close();
	if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
		if (["Home", "End"].includes(event.key) && !open.value) return;
		event.preventDefault();
		const enabled = visible.value
			.map((option, index) => (option.disabled ? -1 : index))
			.filter((index) => index >= 0);
		const opening = !open.value;
		open.value = true;
		const position = enabled.indexOf(active.value);
		if (opening || event.key === "Home") active.value = enabled[0] ?? -1;
		else if (event.key === "End") active.value = enabled.at(-1) ?? -1;
		else
			active.value =
				enabled[
					Math.max(
						0,
						Math.min(
							enabled.length - 1,
							position + (event.key === "ArrowDown" ? 1 : -1),
						),
					)
				] ?? -1;
		if (virtual.value) virtualList.value?.scrollToIndex(active.value);
		nextTick(() =>
			root.value
				?.querySelector("[role=option].active")
				?.scrollIntoView?.({ block: "nearest" }),
		);
	}
	if (event.key === "Enter" && open.value) {
		event.preventDefault();
		const option = visible.value[active.value];
		if (state.value === "ready" && option && !option.disabled) choose(option.value);
	}
}
defineExpose({ state });
</script>
<template>
	<div
		ref="root"
		class="preview-search-select preview-field"
		@focusout="
			(event) => {
				if (!(event.currentTarget as HTMLElement).contains(event.relatedTarget as Node)) {
					if (popup?.contains(event.relatedTarget as Node)) return;
					open = false;
					query = '';
					typed = false;
				}
			}
		"
	>
		<label v-if="!externalLabel" :for="id">{{ label }}</label>
		<div class="search-select-input">
			<input
				:ref="setInput"
				:id="id"
				:aria-describedby="ariaDescribedBy"
				role="combobox"
				autocomplete="off"
				:aria-expanded="open"
				:aria-controls="id + '-options'"
				aria-autocomplete="list"
				:aria-activedescendant="
					open && state === 'ready' && visible[active] ? id + '-' + active : undefined
				"
				:disabled="disabled"
				:title="selectedOption?.title || selected"
				:aria-invalid="invalid || ariaInvalid || undefined"
				:placeholder="placeholder || '搜索并选择'"
				:value="open && typed ? query : selected"
				@focus="
					open = true;
					typed = false;
					query = '';
					nextTick(() => input?.select());
				"
				@click="!open && (open = true)"
				@input="
					query = ($event.target as HTMLInputElement).value;
					typed = true;
					open = true;
				"
				@keydown="key"
			/><button
				v-if="clearable && modelValue && !disabled"
				class="search-select-clear"
				type="button"
				:aria-label="'清除' + label"
				@click="
					choose('');
					input?.focus();
				"
			>
				×
			</button>
		</div>
		<Teleport :to="popupTarget">
			<div
				v-if="open && !disabled"
				ref="popup"
				class="search-select-menu"
				:class="{ 'has-virtual-list': virtual }"
				:style="popupStyle"
				@mousedown="preserveInputFocus"
			>
				<p v-if="state === 'loading'" role="status">正在查找…</p>
				<div v-if="state === 'error'" role="alert">
					{{ error || "选项加载失败" }}
					<button type="button" @click="remote ? emit('retry') : (state = 'ready')">
						重试
					</button>
				</div>
				<template v-if="matches.length || state === 'ready'"
					><VirtualList
						v-if="virtual"
						ref="virtualList"
						:id="id + '-options'"
						role="listbox"
						:aria-label="label"
						:keys="matches.map((option) => option.value)"
						:estimate="64"
						><template #default="{ index }"
							><div
								:id="id + '-' + index"
								role="option"
								:aria-selected="matches[index]?.value === modelValue"
								:aria-disabled="matches[index]?.disabled"
								:class="{ active: index === active }"
								class="virtual-option"
								@mousedown.prevent
								@click="
									matches[index] &&
									!matches[index]!.disabled &&
									choose(matches[index]!.value)
								"
							>
								{{ matches[index]?.label
								}}<small v-if="matches[index]?.detail">{{
									matches[index]?.detail
								}}</small>
							</div></template
						></VirtualList
					>
					<ul v-else :id="id + '-options'" role="listbox" :aria-label="label">
						<li
							v-for="(option, index) in visible"
							:id="id + '-' + index"
							:key="option.value"
							role="option"
							:aria-selected="option.value === modelValue"
							:aria-disabled="option.disabled"
							:class="{ active: index === active }"
							@mousedown.prevent
							@click="!option.disabled && choose(option.value)"
						>
							{{ option.label
							}}<small v-if="option.detail">{{ option.detail }}</small>
						</li>
					</ul>
					<p v-if="state === 'ready' && !matches.length" role="status">没有匹配的选项</p>
					<button
						v-if="!remote && !virtual && matches.length > limit"
						type="button"
						@click="limit += pageSize"
					>
						显示更多（共 {{ matches.length }} 项）</button
					><UiButton
						v-if="remote && hasMore"
						size="compact"
						:loading="loading"
						loading-label="正在加载更多选项…"
						@click="emit('loadMore')"
					>
						加载更多 · 已加载 {{ matches.length }} / {{ total }}
					</UiButton>
					<span class="sr-only" role="status"
						>{{ total ?? matches.length }} 个匹配选项</span
					></template
				>
			</div>
		</Teleport>
	</div>
</template>
<style scoped>
.preview-search-select {
	position: relative;
	min-width: 0;
	display: grid;
	gap: var(--p-field-gap);
}
.search-select-input {
	position: relative;
}
.search-select-input input {
	min-width: 0;
	width: 100%;
	padding-inline-end: 44px;
}
.search-select-clear {
	position: absolute;
	right: 4px;
	top: 50%;
	transform: translateY(-50%);
	width: 36px;
	min-width: 36px;
	min-height: 36px;
	padding: 0;
}
@media (pointer: coarse) {
	.search-select-clear {
		width: 44px;
		min-width: 44px;
		min-height: 44px;
	}
}
.search-select-menu {
	position: fixed;
	z-index: var(--p-z-menu);
	min-width: min(280px, calc(100vw - 16px));
	max-width: min(360px, calc(100vw - 16px));
	max-height: var(--popup-max-height, calc(100dvh - 16px));
	overflow: auto;
	padding: 8px;
	background: var(--p-surface);
	border: 1px solid var(--p-border);
	border-radius: 10px;
	box-shadow: var(--p-shadow-raised);
}
.search-select-menu.has-virtual-list {
	overflow: hidden;
	display: flex;
	flex-direction: column;
}
.search-select-menu.has-virtual-list :deep(.preview-virtual-list) {
	min-height: 0;
	flex: 1 1 auto;
	overflow: auto;
}
ul {
	list-style: none;
	margin: 0;
	padding: 0;
}
li,
.virtual-option {
	min-height: 44px;
	display: flex;
	flex-direction: column;
	justify-content: center;
	padding: 10px;
	cursor: pointer;
	border-radius: 6px;
}
li.active,
.virtual-option.active {
	background: var(--p-soft);
}
@media (hover: hover) {
	li:hover {
		background: var(--p-soft);
	}
}
li[aria-disabled="true"] {
	opacity: 0.5;
	cursor: default;
}
small {
	display: block;
}
.sr-only {
	position: absolute;
	width: 1px;
	height: 1px;
	overflow: hidden;
	clip-path: inset(50%);
}
</style>
