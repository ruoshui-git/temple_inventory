<script setup lang="ts">
import { useRoute } from "vue-router";
import NativeOperation from "./NativeOperation.vue";
import Reconciliation from "./Reconciliation.vue";
import NativeVoucherLink from "../components/NativeVoucherLink.vue";
const route = useRoute();
</script>
<template>
	<NativeOperation v-if="route.params.doctype === 'Stock Entry'" /><Reconciliation
		v-else-if="route.params.doctype === 'Stock Reconciliation'"
	/>
	<NativeVoucherLink
		v-else
		:doctype="String(route.params.doctype)"
		:name="String(route.params.name)"
	/>
</template>
