<script setup lang="ts">
import { useLoanDetailController } from "./useLoanDetailController";
import LoanDetailView from "./LoanDetailView.vue";

const controller = useLoanDetailController();
</script>

<template>
	<LoanDetailView :controller="controller" />
</template>
