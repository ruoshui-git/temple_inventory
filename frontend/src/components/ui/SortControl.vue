<script setup lang="ts" generic="TField extends string">
import { computed } from "vue";
import PopupMenu from "./PopupMenu.vue";

type SortField = {
	value: TField;
	label: string;
	kind?: "text" | "date" | "number" | "expiry";
};
const props = withDefaults(
	defineProps<{
		field: TField;
		direction: "asc" | "desc";
		fields: ReadonlyArray<SortField>;
		label?: string;
	}>(),
	{ label: "排序字段" },
);
const emit = defineEmits<{
	"update:field": [value: TField];
	"update:direction": [value: "asc" | "desc"];
}>();
const selected = computed(() => props.fields.find((option) => option.value === props.field));
const compactFieldLabel = computed(() => {
	const value = selected.value?.label || props.label;
	if (value.includes("物品名称")) return "名称";
	if (value.includes("物品编号")) return "编号";
	if (value.includes("库存数量")) return "数量";
	if (value.includes("剩余时间")) return "剩余";
	if (value.includes("到期日")) return "到期";
	return value;
});
function kindOf(option: SortField) {
	if (option.kind) return option.kind;
	const value = `${option.value} ${option.label}`;
	if (/expiry|到期/.test(value)) return "expiry";
	if (/date|日期|月份|时间/.test(value)) return "date";
	if (/qty|quantity|available|loaned|damaged|outstanding|数量/.test(value)) return "number";
	return "text";
}
function directions(kind: string) {
	if (kind === "date")
		return [
			{ value: "desc", label: "最新优先" },
			{ value: "asc", label: "最早优先" },
		];
	if (kind === "number")
		return [
			{ value: "desc", label: "从多到少" },
			{ value: "asc", label: "从少到多" },
		];
	if (kind === "expiry")
		return [
			{ value: "asc", label: "最早到期" },
			{ value: "desc", label: "最晚到期" },
		];
	return [
		{ value: "asc", label: "A→Z" },
		{ value: "desc", label: "Z→A" },
	];
}
const directionLabel = computed(
	() =>
		directions(
			kindOf(selected.value || { value: props.field, label: String(props.field) }),
		).find((entry) => entry.value === props.direction)?.label || "A→Z",
);
</script>

<template>
	<div class="browse-sort-control">
		<PopupMenu
			:label="`排序：${selected?.label || label}，${directionLabel}`"
			variant="labeled"
			sheet
		>
			<template #trigger>
				<span aria-hidden="true">⇅</span>
				<span class="browse-sort-full-label">{{ selected?.label || label }}</span>
				<span class="browse-sort-compact-label">{{ compactFieldLabel }}</span>
				· {{ directionLabel }}
			</template>
			<div
				v-for="option in fields"
				:key="option.value"
				class="sort-menu-group"
				role="group"
				:aria-label="option.label"
			>
				<strong>{{ option.label }}</strong>
				<button
					v-for="directionOption in directions(kindOf(option))"
					:key="directionOption.value"
					type="button"
					role="menuitemradio"
					:aria-checked="field === option.value && direction === directionOption.value"
					@click="
						emit('update:field', option.value);
						emit('update:direction', directionOption.value as 'asc' | 'desc');
					"
				>
					<span>{{ directionOption.label }}</span>
					<span
						v-if="field === option.value && direction === directionOption.value"
						aria-hidden="true"
						>✓</span
					>
				</button>
			</div>
		</PopupMenu>
	</div>
</template>
