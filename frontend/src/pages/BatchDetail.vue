<script setup lang="ts">
import { computed } from "vue";
import { onBeforeRouteLeave, onBeforeRouteUpdate, useRoute, useRouter } from "vue-router";
import BatchDetailView from "../features/batches/BatchDetailView.vue";
import { useBatchDetailController } from "../features/batches/useBatchDetailController";
const route = useRoute(),
	router = useRouter();
const name = computed(() => String(route.params.name || ""));
const controller = useBatchDetailController({ name });
const back = computed(() => (typeof route.query.back === "string" ? route.query.back : ""));
function confirmDiscard() {
	return (
		!controller.saving.value &&
		(!controller.dirty.value || window.confirm("批次资料有未保存的修改，仍要离开吗？"))
	);
}
onBeforeRouteLeave(confirmDiscard);
onBeforeRouteUpdate(confirmDiscard);
</script>
<template>
	<BatchDetailView
		:controller="controller"
		@back="back ? router.push(back) : router.back()"
		@open-item="
			(code) =>
				router.push({
					path: `/item/${encodeURIComponent(code)}`,
					query: { back: route.fullPath },
				})
		"
		@open-document="
			(destination) => router.push({ path: destination, query: { back: route.fullPath } })
		"
	/>
</template>
