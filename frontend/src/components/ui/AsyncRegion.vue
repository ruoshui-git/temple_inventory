<script setup lang="ts">
withDefaults(
	defineProps<{
		loading: boolean;
		initialized: boolean;
		stale?: boolean;
		error?: string;
		label?: string;
	}>(),
	{ stale: false, error: "", label: "正在更新结果" },
);
</script>

<template>
	<div v-if="!initialized" class="async-region-initial">
		<slot v-if="error && !loading" name="error" :error="error" />
		<slot v-else-if="loading || !error" name="skeleton" />
	</div>
	<div
		v-else
		class="async-result-region"
		:class="{ 'is-refreshing': loading && stale }"
		:inert="loading && stale ? true : undefined"
		:aria-busy="loading && stale ? 'true' : undefined"
	>
		<span v-if="loading && stale" class="sr-only" role="status">{{ label }}</span>
		<slot />
	</div>
</template>
