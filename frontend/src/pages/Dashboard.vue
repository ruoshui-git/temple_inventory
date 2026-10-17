<script setup lang="ts">
import { useRouter } from "vue-router";
import DashboardPage from "../features/dashboard/DashboardPage.vue";
import {
	browseDestination,
	documentDestination,
	exportDestination,
} from "../lib/nativeNavigation";
const router = useRouter();
</script>
<template>
	<DashboardPage
		@browse="router.push(browseDestination($event))"
		@open-document="(doctype, name) => router.push(documentDestination(doctype, name))"
		@open-export="router.push(exportDestination($event))"
	/>
</template>
