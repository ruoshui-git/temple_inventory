<script setup lang="ts">
import { routeTarget } from "../lib/routeRegistry";
</script>

<template>
	<main class="app-shell">
		<h1>页面不存在</h1>
		<p>此库存页面地址无效或已停用。</p>
		<RouterLink :to="routeTarget('home')">返回首页</RouterLink>
	</main>
</template>
