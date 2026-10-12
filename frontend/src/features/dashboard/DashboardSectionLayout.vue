<script setup lang="ts">
defineProps<{ grouped: boolean }>();
</script>

<template>
	<div class="dashboard-sections">
		<template v-if="grouped">
			<div class="dashboard-column dashboard-left-column">
				<slot name="inventory" />
				<slot name="distribution" />
				<slot name="expiry" />
			</div>
			<div class="dashboard-column dashboard-right-column">
				<slot name="movement" />
				<slot name="loans" />
				<slot name="reminders" />
			</div>
		</template>
		<template v-else>
			<slot name="inventory" />
			<slot name="distribution" />
			<slot name="expiry" />
			<slot name="movement" />
			<slot name="loans" />
			<slot name="reminders" />
		</template>
	</div>
</template>

<style scoped>
.dashboard-sections {
	display: grid;
	grid-template-columns: minmax(0, 1fr);
	align-items: start;
	gap: var(--ti-density-gap);
}
.dashboard-sections:has(.dashboard-column) {
	grid-template-columns: repeat(2, minmax(0, 1fr));
}
.dashboard-column {
	display: grid;
	min-width: 0;
	align-content: start;
	gap: var(--ti-density-gap);
}
@media (max-width: 1023px) {
	.dashboard-sections:has(.dashboard-column) {
		grid-template-columns: minmax(0, 1fr);
	}
}
</style>
