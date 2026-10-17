<script setup lang="ts">
defineProps<{ doctype: string; name: string }>();
const deskType = (type: string) => type.toLowerCase().replaceAll(" ", "-");
</script>
<template>
	<section class="preview-long-text">
		<h1>{{ doctype }} · {{ name }}</h1>
		<p>此原生凭证请在 ERPNext 中查看。</p>
		<a
			:href="`/app/${encodeURIComponent(deskType(doctype))}/${encodeURIComponent(name)}`"
			target="_blank"
			rel="noopener"
			>在 ERPNext 查看原始记录</a
		>
	</section>
</template>
