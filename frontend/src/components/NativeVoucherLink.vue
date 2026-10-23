<script setup lang="ts">
import PageHeader from "./ui/PageHeader.vue";
defineProps<{ doctype: string; name: string }>();
const deskType = (type: string) => type.toLowerCase().replaceAll(" ", "-");
</script>
<template>
	<section class="preview-long-text">
		<PageHeader :title="`${doctype} · ${name}`"
			><template #actions>
				<a
					:href="`/app/${encodeURIComponent(deskType(doctype))}/${encodeURIComponent(name)}`"
					target="_blank"
					rel="noopener"
					>在 ERPNext 查看原始记录</a
				></template
			></PageHeader
		>
		<p>此凭证请在 ERPNext 中查看。</p>
	</section>
</template>
