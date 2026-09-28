<script setup lang="ts">
import { computed, onMounted, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import History from "./History.vue";
import MovementOverview from "./MovementOverview.vue";

const route = useRoute();
const router = useRouter();
const kinds = ["Receive", "Issue", "Transfer"];
const kind = computed(() => {
	const value = String(route.query.kind || "");
	return kinds.includes(value) ? value : "";
});

function normalizeKind() {
	const requested = String(route.query.kind || route.query.movement_kind || "");
	if (!requested) return;
	const query = { ...route.query };
	delete query.movement_kind;
	if (kinds.includes(requested)) query.kind = requested;
	else delete query.kind;
	void router.replace({ query });
}

watch(() => [route.query.kind, route.query.movement_kind], normalizeKind);
onMounted(normalizeKind);
</script>

<template>
	<History v-if="kind" :key="`history-${kind}`" destination="movements" />
	<MovementOverview v-else key="overview" />
</template>
