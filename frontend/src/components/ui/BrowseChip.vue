<script setup lang="ts">
import { vTip } from "../../directives/tip";
import type { TooltipValue } from "../../lib/tooltip";
import InventoryIcon from "../InventoryIcon.vue";
withDefaults(
	defineProps<{ label: string; removable?: boolean; icon?: string; tip?: TooltipValue }>(),
	{
		removable: true,
	},
);
const emit = defineEmits<{ edit: []; remove: [] }>();
</script>

<template>
	<span class="browse-active-chip" v-tip.overflow="tip ? undefined : label">
		<button type="button" class="browse-active-chip-label" v-tip="tip" @click="emit('edit')">
			<InventoryIcon v-if="icon" :name="icon" />
			{{ label }}
		</button>
		<button
			v-if="removable !== false"
			type="button"
			class="browse-active-chip-remove"
			:aria-label="`移除${label}`"
			@click.stop="emit('remove')"
		>
			<span aria-hidden="true">×</span>
		</button>
	</span>
</template>
