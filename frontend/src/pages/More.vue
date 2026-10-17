<script setup lang="ts">
import { useRouter } from "vue-router";
import MorePage from "../features/more/MorePage.vue";
import { useReferenceData } from "../services/contracts";
import { frappePlatform } from "../services/frappePlatform";
const router = useRouter(),
	reference = useReferenceData();
const host = frappePlatform(() => reference.user);
</script>
<template><MorePage :host="host" @navigate="router.push($event)" /></template>
