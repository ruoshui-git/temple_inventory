<script setup lang="ts">
import { computed, inject, onBeforeUnmount, onMounted, ref, watch } from "vue";
import DataCell from "./DataCell.vue";
import type { DataColumn } from "../../lib/dataTable";
import { dataColumnKind } from "../../lib/dataTable";
import { browseCardTruncatedKey } from "../../composables/useTextOverflow";

// Muted `label value` pairs for one browse record, wrapping under a card's quantity or on line 2
// of a 列表 row. Callers choose the fields with partitionCardColumns. Codes, dates, statuses and
// chips read on their own, so their labels are kept for assistive technology only. 更多 opens the
// full row whenever a count is hidden or a clamped value is cut off.
const props = withDefaults(
	defineProps<{
		fields: DataColumn[];
		row: Record<string, unknown>;
		variant?: "card" | "row";
		overflow?: number;
		leading?: string;
	}>(),
	{ variant: "card", overflow: 0, leading: "" },
);
const emit = defineEmits<{ more: [] }>();
const truncated = inject(browseCardTruncatedKey, ref(false));
const inlineContainer = ref<HTMLElement | null>(null);
const inlineVisibleCount = ref(props.fields.length);
const inlineHiddenCount = ref(0);
const inlineLastEllipsized = ref(false);
const showMore = computed(() => props.overflow + inlineHiddenCount.value > 0 || truncated.value);
const moreLabel = computed(() => {
	const hidden = props.overflow + inlineHiddenCount.value;
	return hidden > 0 ? `+${hidden} 项` : "更多";
});

let resizeObserver: ResizeObserver | undefined;
let preferenceObserver: MutationObserver | undefined;
let layoutFrame = 0;

function updateInlineLayout() {
	if (!inlineContainer.value || typeof window === "undefined") return;
	const density = document.documentElement.dataset.tiDensity;
	const compactPhone =
		(window.matchMedia?.("(max-width: 1023px)").matches ?? false) &&
		(density === "xcompact" || density === "compact");
	if (!compactPhone || props.variant !== "row") {
		inlineVisibleCount.value = props.fields.length;
		inlineHiddenCount.value = 0;
		inlineLastEllipsized.value = false;
		return;
	}
	const available = inlineContainer.value.clientWidth;
	if (!available) return;
	const canvas = document.createElement("canvas");
	const context = canvas.getContext("2d");
	if (!context) return;
	const style = getComputedStyle(inlineContainer.value);
	context.font = style.font;
	const fontSize = parseFloat(style.fontSize) || 12;
	const gap = parseFloat(style.columnGap) || 0;
	const separator = context.measureText("·").width + fontSize * 0.18;
	const valueWidth = (text: string) => context.measureText(text).width;
	let used = props.leading ? valueWidth(props.leading) + separator : 0;
	let visible = 0;
	let ellipsized = false;
	for (const column of props.fields) {
		const kind = dataColumnKind(column);
		const value = valueOf(column);
		const text = plainText(value) ?? (value == null ? "—" : String(value));
		const bare = bareKinds.has(kind) && !isEmpty(column);
		const label = bare ? 0 : valueWidth(column.label) + fontSize * 0.3;
		const minimum = label + valueWidth("00") + gap + (visible ? separator : 0);
		const natural = label + valueWidth(text) + gap + (visible ? separator : 0);
		const remaining = available - used;
		if (natural <= remaining) {
			used += natural;
			visible++;
			continue;
		}
		if (remaining >= minimum) {
			visible++;
			ellipsized = true;
		}
		break;
	}
	inlineVisibleCount.value = visible;
	inlineHiddenCount.value = Math.max(0, props.fields.length - visible);
	inlineLastEllipsized.value = ellipsized;
}

function scheduleInlineLayout() {
	cancelAnimationFrame(layoutFrame);
	layoutFrame = requestAnimationFrame(updateInlineLayout);
}

watch(
	() => props.fields,
	() => {
		inlineVisibleCount.value = props.fields.length;
		scheduleInlineLayout();
	},
	{ flush: "post" },
);

onMounted(() => {
	scheduleInlineLayout();
	if (inlineContainer.value && typeof ResizeObserver !== "undefined") {
		resizeObserver = new ResizeObserver(scheduleInlineLayout);
		resizeObserver.observe(inlineContainer.value);
	}
	preferenceObserver = new MutationObserver(scheduleInlineLayout);
	preferenceObserver.observe(document.documentElement, {
		attributes: true,
		attributeFilter: ["data-ti-density", "data-ti-text-scale"],
	});
});

onBeforeUnmount(() => {
	resizeObserver?.disconnect();
	preferenceObserver?.disconnect();
	cancelAnimationFrame(layoutFrame);
});

function valueOf(column: DataColumn) {
	return props.row[String(column.id)];
}
function plainText(value: unknown) {
	return typeof value === "string" || typeof value === "number" ? String(value) : undefined;
}
const bareKinds = new Set(["code", "date", "datetime", "time", "status", "chip"]);
/** A field the row carries with no value; cells computed from other row data are never "empty". */
function isEmpty(column: DataColumn) {
	const key = String(column.id);
	const value = props.row[key];
	return key in props.row && (value === null || value === undefined || value === "");
}
function fieldClass(column: DataColumn) {
	const kind = dataColumnKind(column);
	// A lone "—" means nothing, so an empty self-describing field keeps its label.
	return { "is-wide": kind === "chip", "is-bare": bareKinds.has(kind) && !isEmpty(column) };
}
</script>

<template>
	<template v-if="variant === 'card'">
		<dl v-if="fields.length" class="card-fields">
			<div
				v-for="column in fields"
				:key="String(column.id)"
				class="card-field"
				:class="fieldClass(column)"
			>
				<dt>{{ column.label }}</dt>
				<dd :title="plainText(valueOf(column))" data-clamp>
					<slot name="cell" :column="column" :row="row" :value="valueOf(column)">
						<DataCell :column="column" :value="valueOf(column)" empty-text="—" />
					</slot>
				</dd>
			</div>
		</dl>
		<button
			v-if="showMore"
			type="button"
			class="card-fields-more"
			aria-label="查看全部字段"
			@click.stop="emit('more')"
		>
			{{ moreLabel }}
		</button>
	</template>
	<div v-else-if="leading || fields.length || showMore" class="card-fields-inline">
		<p ref="inlineContainer" class="card-fields-inline-text" data-clamp>
			<span v-if="leading" class="card-field-inline-prefix">{{ leading }}</span>
			<span
				v-for="(column, index) in fields.slice(0, inlineVisibleCount)"
				:key="String(column.id)"
				class="card-field-inline"
				:class="[
					fieldClass(column),
					{
						'is-last-visible': index === inlineVisibleCount - 1,
						'is-ellipsized': inlineLastEllipsized && index === inlineVisibleCount - 1,
					},
				]"
			>
				<span class="card-field-label">{{ column.label }}</span>
				<span class="card-field-inline-value">
					<slot name="cell" :column="column" :row="row" :value="valueOf(column)">
						<DataCell :column="column" :value="valueOf(column)" empty-text="—" />
					</slot>
				</span>
			</span>
		</p>
		<button
			v-if="showMore"
			type="button"
			class="card-fields-more"
			aria-label="查看全部字段"
			@click.stop="emit('more')"
		>
			{{ moreLabel }}
		</button>
	</div>
</template>
