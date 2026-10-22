<script setup lang="ts">
import PageHeader from "./components/ui/PageHeader.vue";
import { computed, watch } from "vue";
import { useRoute } from "vue-router";
import ApplicationShell from "./components/ApplicationShell.vue";
import RouteBreadcrumbs from "./components/RouteBreadcrumbs.vue";
import UiButton from "./components/ui/UiButton.vue";
import ToastHost from "./components/ui/ToastHost.vue";
import Overlay from "./components/ui/Overlay.vue";
import ConfigurationPage from "./features/setup/ConfigurationPage.vue";
import { createReferenceData, provideInventoryServices } from "./services/contracts";
import { frappeServices } from "./services/frappeServices";
import { useApplication } from "./features/application/useApplication";
import { updateAvailable } from "./lib/pwa";
import { createBrowseMemory, provideBrowseMemory } from "./lib/browseMemory";
import { routeViewIdentity } from "./lib/routeRegistry";
const route = useRoute(),
	reference = createReferenceData();
const pageIdentity = computed(() => {
	// Query replacement keeps the editor/controller; Back/Forward and a fresh
	// navigation to the same path own separate UI state in browser history.
	void route.fullPath;
	const position = typeof window === "undefined" ? 0 : window.history.state?.position || 0;
	return `${reference.site}:${reference.user}:${routeViewIdentity(
		route.path,
		position,
		typeof route.meta.stateIdentity === "string" ? route.meta.stateIdentity : undefined,
	)}`;
});
const browseMemory = createBrowseMemory(() => pageIdentity.value);
watch(pageIdentity, () => browseMemory.activate(), { immediate: true });
const services = browseMemory.wrap(frappeServices);
provideInventoryServices(services, reference);
provideBrowseMemory(browseMemory);
const c = useApplication(reference, services),
	{ state, resuming, sessionExpired } = c;
const contentKey = computed(() => `${state.version}:${pageIdentity.value}`);
</script>
<template>
	<div class="inventory-app" data-inventory-app>
		<ToastHost />
		<main v-if="state.gate === 'loading'" class="sample-content">
			<RouteBreadcrumbs />
			<p role="status">正在检查登录与库存配置…</p>
		</main>
		<main v-else-if="state.gate === 'login'" class="sample-content">
			<RouteBreadcrumbs />
			<section class="surface form-section">
				<PageHeader title="请登录物资管理" />
				<p>请使用有物资管理权限的账户登录。</p>
				<a href="/login?redirect-to=%2Finventory">打开登录页面</a
				><UiButton :loading="state.loading" @click="c.check">重新检查登录</UiButton>
			</section>
		</main>
		<main
			v-else-if="state.gate === 'forbidden' || state.gate === 'error'"
			class="sample-content"
		>
			<RouteBreadcrumbs />
			<section class="surface form-section">
				<PageHeader
					><h1 tabindex="-1">
						{{
							state.gate === "forbidden"
								? "当前账户无权使用物资管理"
								: "暂时无法读取物资管理"
						}}
					</h1></PageHeader
				>
				<p role="alert">{{ state.error }}</p>
				<UiButton :loading="state.loading" @click="c.check">重新检查</UiButton
				><a href="/login?redirect-to=%2Finventory">切换登录账户</a>
			</section>
		</main>
		<main v-else-if="state.gate === 'setup'" class="sample-content">
			<RouteBreadcrumbs />
			<ConfigurationPage @changed="c.check" />
		</main>
		<template v-else>
			<ApplicationShell>
				<section
					v-if="state.error && !sessionExpired"
					class="notice-bar danger"
					role="alert"
				>
					<p>{{ state.error }}</p>
					<UiButton :loading="state.loading" @click="c.check">重新检查</UiButton>
				</section>
				<section
					v-if="state.status?.setup_required"
					class="notice-bar warning"
					role="alert"
				>
					<p>库存配置已变化，当前输入保留。请先检查库存设置。</p>
					<p v-for="issue in state.status.blockers" :key="issue.code">
						{{ issue.message }}
					</p>
					<a href="/app/temple-inventory-settings" target="_blank" rel="noopener"
						>打开库存设置</a
					>
				</section>
				<section
					v-if="state.status?.warnings.length"
					class="notice-bar warning"
					role="status"
				>
					<p>{{ state.status.warnings.map((issue) => issue.message).join("；") }}</p>
					<a href="/app/temple-inventory-settings" target="_blank" rel="noopener"
						>检查库存设置</a
					><UiButton :loading="state.loading" @click="c.check">重新检查</UiButton>
				</section>
				<RouterView :key="contentKey" />
				<section v-if="updateAvailable" class="notice-bar" role="status">
					<p>
						{{
							c.updateBlocked.value
								? "发现新版本，请先保存或完成当前输入后更新。"
								: "发现新版本，可以更新。"
						}}
					</p>
					<UiButton :disabled="c.updateBlocked.value" @click="c.update"
						>更新并重新加载</UiButton
					>
				</section>
			</ApplicationShell>
			<Overlay
				v-if="sessionExpired || resuming || state.accessBlocked"
				:title="state.accessBlocked ? '当前账户无法继续访问' : '请重新登录'"
				:dismissible="false"
			>
				<p>未保存的输入仍保留在此窗口。请在新窗口登录后返回继续保存。</p>
				<p v-if="state.accessBlocked">
					请先核对账户与库存权限，再重新验证。当前窗口保留输入与待上传文件。
				</p>
				<a
					href="/login?redirect-to=%2Finventory%2Fauth-complete"
					target="_blank"
					rel="noopener"
					>打开登录页面</a
				>
				<UiButton :loading="resuming" @click="c.resume">继续保存</UiButton>
				<p v-if="state.error" role="alert">{{ state.error }}</p>
			</Overlay>
		</template>
	</div>
</template>
