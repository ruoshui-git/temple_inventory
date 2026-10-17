<script setup lang="ts">
import { ref, watch } from "vue";
import ConfigurationPage from "../../features/setup/ConfigurationPage.vue";
import { fixtureConfiguration } from "../fixtureConfiguration";
const page = ref<InstanceType<typeof ConfigurationPage>>();
watch(
	() => fixtureConfiguration.scenario,
	() => {
		void page.value?.controller.load();
	},
);
</script>
<template>
	<details class="preview-state-controls">
		<summary>图库配置状态</summary>
		<label class="preview-field"
			>状态<select v-model="fixtureConfiguration.scenario">
				<option value="ready">配置有效</option>
				<option value="new">尚未初始化</option>
				<option value="root">实体根引用失效</option>
				<option value="metadata">物理类型待核对</option>
				<option value="denied">已存在仓库无权读取</option>
				<option value="guest">尚未登录</option>
				<option value="role">非 System Manager</option>
			</select></label
		>
	</details>
	<ConfigurationPage ref="page" />
</template>
