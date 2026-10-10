<script setup lang="ts">
import { onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import IconButton from "../components/IconButton.vue";
import ItemCreateForm from "../components/ItemCreateForm.vue";
import { api } from "../lib/api";
import { returnToOpener } from "../lib/navigation";

const router = useRouter();
const boot = ref<any>();
const error = ref("");
const barcode = ref("");

async function close() {
	await returnToOpener(router, "/stock");
}

async function created(itemCode: string) {
	await router.replace(`/item/${encodeURIComponent(itemCode)}`);
}

onMounted(async () => {
	barcode.value = sessionStorage.getItem("ti-unknown-barcode") || "";
	sessionStorage.removeItem("ti-unknown-barcode");
	try {
		boot.value = await api("bootstrap");
	} catch (cause: any) {
		error.value = cause.message || "无法加载物品资料";
	}
});
</script>

<template>
	<section class="app-shell item-create-page">
		<header class="item-create-page-header">
			<IconButton label="返回" @click="close">
				<svg aria-hidden="true" viewBox="0 0 24 24">
					<path d="m14 5-7 7 7 7M7 12h11" />
				</svg>
			</IconButton>
			<div>
				<h1>新建物品</h1>
				<p>创建可立即用于库存操作的 ERPNext 物品。</p>
			</div>
		</header>
		<p v-if="!boot && !error">正在加载新物品表单…</p>
		<div v-else-if="error">
			<p class="error">{{ error }}</p>
			<button type="button" @click="close">返回</button>
		</div>
		<ItemCreateForm
			v-else
			:boot="boot"
			:barcode="barcode"
			@created="created"
			@cancel="close"
		/>
	</section>
</template>

<style scoped>
.item-create-page {
	width: min(100%, 48rem);
	margin-inline: auto;
}

.item-create-page-header {
	display: flex;
	align-items: flex-start;
	gap: 0.75rem;
	margin-bottom: 1rem;
}

.item-create-page-header h1,
.item-create-page-header p {
	margin: 0;
}

.item-create-page-header p {
	margin-top: 0.25rem;
	color: var(--text-muted, #65645f);
}
</style>
