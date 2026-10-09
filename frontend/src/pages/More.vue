<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { api, request } from "../lib/api";
import { detectInstallPlatform, installInstructions, installPwa, isStandalone } from "../lib/pwa";
import UiButton from "../components/UiButton.vue";
const boot = ref<any>(),
	installHelp = ref(""),
	showInstall = ref(false);
const platform = computed(() =>
	typeof navigator === "undefined"
		? "other"
		: detectInstallPlatform(navigator.userAgent, navigator.platform, navigator.maxTouchPoints),
);
onMounted(async () => (boot.value = await api("bootstrap")));
async function logout() {
	await request("logout");
	location.href = "/login?redirect-to=%2Finventory";
}
async function install() {
	if (!(await installPwa())) {
		installHelp.value = installInstructions(platform.value);
		showInstall.value = true;
	}
}
</script>
<template>
	<section class="app-shell">
		<RouterLink class="selection-row" to="/reports">报表与导出</RouterLink>
		<RouterLink class="selection-row" to="/drafts"
			>草稿 <b v-if="boot?.unfinished_count">{{ boot.unfinished_count }}</b></RouterLink
		><RouterLink class="selection-row" to="/pending"
			>待处理（{{ boot?.pending_count || 0 }}）</RouterLink
		><UiButton
			v-if="!isStandalone"
			variant="secondary"
			class="selection-row more-install-action"
			@click="install"
		>
			安装到手机 / 电脑
		</UiButton>
		<p class="selection-row">当前账户：{{ boot?.user }}</p>
		<UiButton variant="danger" @click="logout">退出登录</UiButton>
		<div v-if="showInstall" class="modal" role="dialog" aria-modal="true">
			<section>
				<h2>安装物资管理</h2>
				<p>{{ installHelp }}</p>
				<UiButton variant="primary" @click="showInstall = false">知道了</UiButton>
			</section>
		</div>
	</section>
</template>
<style scoped>
.more-install-action {
	display: block;
	width: 100%;
	justify-content: flex-start;
	text-align: left;
}
</style>
