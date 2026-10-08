<script setup lang="ts">
import { useItemDetailController } from "./useItemDetailController";
import ItemDetailView from "./ItemDetailView.vue";

const controller = useItemDetailController();
</script>

<template>
	<ItemDetailView :controller="controller" />
</template>
