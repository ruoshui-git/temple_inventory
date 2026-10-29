<script setup lang="ts">
import { computed } from "vue";
import DetailPopover from "../../components/ui/DetailPopover.vue";
import LocationEndpoint from "../../components/ui/LocationEndpoint.vue";

const props = defineProps<{
	locations: string[];
	kind: string;
	borrower?: string;
	role: "来源位置" | "去向位置";
}>();
const locations = computed(() => [...new Set(props.locations)]);
</script>

<template>
	<span v-if="locations.length <= 1" class="multi-location-endpoint">
		<LocationEndpoint
			:warehouse="locations[0] || ''"
			:kind="kind"
			:borrower="borrower"
			:role="role"
		/>
	</span>
	<DetailPopover v-else :label="`${role}，共 ${locations.length} 处`">
		<template #trigger>
			<LocationEndpoint
				:warehouse="locations[0]"
				:kind="kind"
				:borrower="borrower"
				:role="role"
			/>
			<span class="multi-location-more">等 {{ locations.length }} 处</span>
		</template>
		<ul class="multi-location-list">
			<li v-for="location in locations" :key="location">
				<LocationEndpoint
					:warehouse="location"
					:kind="kind"
					:borrower="borrower"
					:role="role"
				/>
			</li>
		</ul>
	</DetailPopover>
</template>

<style scoped>
.multi-location-endpoint,
.multi-location-more {
	display: inline-flex;
	align-items: center;
	gap: 4px;
}

.multi-location-more {
	color: var(--p-muted);
	white-space: nowrap;
}

.multi-location-list {
	display: grid;
	gap: 6px;
	margin: 0;
	padding: 0;
	list-style: none;
}
</style>
