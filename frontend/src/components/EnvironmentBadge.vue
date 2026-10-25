<script setup lang="ts">
import type { EnvironmentDescriptor } from "../lib/environment";

defineProps<{ environment: EnvironmentDescriptor }>();
</script>

<template>
	<span
		v-if="environment.label"
		class="environment-badge"
		:aria-label="`${environment.label}环境`"
		>{{ environment.label }}</span
	>
</template>
