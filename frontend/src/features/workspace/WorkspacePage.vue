<script setup lang="ts">
import { useWorkspaceController } from "./useWorkspaceController";
import WorkspaceView from "./WorkspaceView.vue";

const controller = useWorkspaceController();
</script>

<template>
	<WorkspaceView :controller="controller" />
</template>
