<script setup lang="ts">
import { provide, ref } from "vue";
import { browseCardTruncatedKey, useTextOverflow } from "../../composables/useTextOverflow";

const props = withDefaults(
	defineProps<{
		rowKey: string;
		selecting: boolean;
		selected: boolean;
		selectLabel: string;
		variant: "card" | "row";
		stale?: boolean;
	}>(),
	{ stale: false },
);
const emit = defineEmits<{ open: []; toggle: [] }>();
const root = ref<HTMLElement>();
provide(browseCardTruncatedKey, useTextOverflow(root));
function activate(event: MouseEvent) {
	const target = event.target;
	if (
		target instanceof Element &&
		target.closest("input, select, textarea, [contenteditable='true']")
	)
		return;
	if (props.selecting) {
		emit("toggle");
		return;
	}
	if (target instanceof Element && target.closest("button, a")) return;
	emit("open");
}
function activateFromTitle(event: MouseEvent) {
	event.stopPropagation();
	if (props.selecting) emit("toggle");
	else emit("open");
}
function onKeydown(event: KeyboardEvent) {
	if (!props.selecting || !["Enter", " "].includes(event.key)) return;
	if (event.target !== event.currentTarget) return;
	event.preventDefault();
	emit("toggle");
}
function updateSelection(event: Event) {
	emit("toggle");
}
</script>

<template>
	<article
		ref="root"
		:data-browse-row="rowKey"
		:tabindex="selecting ? 0 : -1"
		:role="selecting ? 'checkbox' : undefined"
		:aria-checked="selecting ? selected : undefined"
		:class="[
			'browse-card-item',
			`browse-card-item--${variant}`,
			{ selected, 'is-stale': stale },
		]"
		@click="activate"
		@keydown="onKeydown"
	>
		<slot name="media" />
		<label
			v-if="selecting"
			:class="variant === 'card' ? 'card-checkbox' : 'stock-list-checkbox'"
			@click.stop
		>
			<input
				type="checkbox"
				:checked="selected"
				:aria-label="selectLabel"
				@change="updateSelection"
			/>
		</label>
		<slot name="badges" />
		<slot :activate="activateFromTitle" />
	</article>
</template>
