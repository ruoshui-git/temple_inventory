<script setup lang="ts">
defineProps<{ title?: string; compact?: boolean }>();
</script>
<template>
	<header class="app-page-header" :class="{ 'is-compact': compact }">
		<div class="app-page-identity">
			<slot name="back" />
			<div class="app-page-heading">
				<div class="app-page-title-row">
					<h1 v-if="title" tabindex="-1">{{ title }}</h1>
					<slot name="title-tools" />
				</div>
				<slot />
			</div>
		</div>
		<div v-if="$slots.actions" class="app-page-actions"><slot name="actions" /></div>
		<div v-if="$slots.trailing" class="app-page-trailing"><slot name="trailing" /></div>
		<div v-if="$slots.subtitle" class="app-page-subtitle"><slot name="subtitle" /></div>
	</header>
</template>
