<script setup lang="ts">
import { computed } from "vue";
import DisclosureIcon from "./DisclosureIcon.vue";

const props = withDefaults(
	defineProps<{
		title: string;
		count?: number | string;
		summary?: string;
		level?: "h2" | "h3" | "h4" | "h5" | "h6";
		open?: boolean;
	}>(),
	{ level: "h2", open: undefined },
);
const emit = defineEmits<{ "update:open": [value: boolean] }>();
const headingTag = computed(() => props.level);

// Controls inside <summary> already suppress the toggle through HTML activation rules; only blank
// action-area clicks need it, and preventing every click would cancel link and checkbox defaults.
function guardActions(event: MouseEvent) {
	const target = event.target as Element | null;
	if (!target?.closest("a, button, input, select, textarea, label")) event.preventDefault();
}
</script>

<template>
	<details
		class="ti-disclosure-section"
		:open="open"
		@toggle="emit('update:open', ($event.currentTarget as HTMLDetailsElement).open)"
	>
		<summary>
			<DisclosureIcon variant="inline" />
			<component :is="headingTag" class="ti-disclosure-section-title">{{ title }}</component>
			<span v-if="count !== undefined" class="ti-disclosure-section-count">{{ count }}</span>
			<span v-if="summary" class="ti-disclosure-section-summary">{{ summary }}</span>
			<span
				v-if="$slots.actions"
				class="ti-disclosure-section-actions"
				@click="guardActions"
			>
				<slot name="actions" />
			</span>
		</summary>
		<div class="ti-disclosure-section-body"><slot /></div>
	</details>
</template>
