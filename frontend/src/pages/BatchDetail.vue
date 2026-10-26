<script setup lang="ts">
import { computed } from "vue";
import { onBeforeRouteLeave, onBeforeRouteUpdate, useRoute, useRouter } from "vue-router";
import BatchDetailView from "../features/batches/BatchDetailView.vue";
import { useBatchDetailController } from "../features/batches/useBatchDetailController";
import { loanDestination } from "../lib/nativeNavigation";
import { routeTarget } from "../lib/routeRegistry";
import { useConfirm } from "../services/confirm";
const route = useRoute(),
	router = useRouter();
const name = computed(() => String(route.params.name || ""));
const controller = useBatchDetailController({ name });
const back = computed(() => (typeof route.query.back === "string" ? route.query.back : ""));
async function confirmDiscard() {
	if (controller.saving.value || !controller.dirty.value) return !controller.saving.value;
	return useConfirm().confirm({
		title: "离开批次资料？",
		message: "未保存的修改将丢失。",
		confirmLabel: "放弃修改并离开",
		tone: "danger",
	});
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
					...routeTarget('item-detail', { code }),
					query: { back: route.fullPath },
				})
		"
		@open-document="
			(destination) => router.push({ ...destination, query: { back: route.fullPath } })
		"
		@open-loan="(name) => router.push(loanDestination(name, route.fullPath))"
	/>
</template>
