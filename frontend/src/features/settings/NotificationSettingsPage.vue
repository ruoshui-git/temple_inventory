<script setup lang="ts">
import PageHeader from "../../components/ui/PageHeader.vue";
import BackButton from "../../components/ui/BackButton.vue";
import UiButton from "../../components/ui/UiButton.vue";
import SkeletonBlock from "../../components/ui/SkeletonBlock.vue";
import InventoryIcon from "../../components/InventoryIcon.vue";
import { useNotificationSettings } from "./useNotificationSettings";
import { useRouter } from "vue-router";
const c = useNotificationSettings();
const router = useRouter();
const isDev = import.meta.env.DEV;
const states: Record<string, string> = {
	unsupported: "此浏览器不支持",
	install: "需要安装到主屏幕",
	denied: "浏览器已阻止",
	subscribed: "已开启",
	off: "未开启",
};
</script>
<template>
	<section class="preview-utility-page notification-settings-page">
		<PageHeader
			><h1 tabindex="-1">通知设置</h1>
			<template #back><BackButton @click="router.push('/more')" /></template
		></PageHeader>
		<p class="muted">当前账户：{{ c.account }}</p>
		<p class="muted">通知将显示在本设备的通知列表中。</p>
		<SkeletonBlock v-if="c.loading.value && !c.initialized.value" variant="lines" :count="6" />
		<p v-if="c.error.value" role="alert">
			{{ c.error.value }} <UiButton @click="c.load">重新读取</UiButton>
		</p>
		<template v-if="c.preferences.value">
			<section class="surface utility-panel">
				<h2>应用内通知</h2>
				<label class="notification-switch-row"
					><span
						><strong>接收通知</strong><small>关闭后不再接收物资管理通知。</small></span
					><input
						v-model="c.preferences.value.enabled"
						type="checkbox"
						role="switch"
						aria-label="接收通知"
						:class="{ 'is-off': !c.preferences.value.enabled }"
				/></label>
				<label
					v-for="event in c.notificationEvents"
					:key="event.key"
					class="notification-switch-row"
				>
					<span
						><strong>{{ event.label }}</strong
						><small v-if="'defaultOff' in event && event.defaultOff"
							>默认关闭</small
						></span
					>
					<input
						v-model="c.preferences.value[event.key]"
						type="checkbox"
						role="switch"
						:disabled="!c.preferences.value.enabled"
						:aria-label="event.label"
						:class="{ 'is-off': !c.preferences.value[event.key] }"
					/>
				</label>
				<fieldset
					class="notification-kinds"
					:disabled="
						!c.preferences.value.enabled || !c.preferences.value.movement_submitted
					"
				>
					<legend>新货物流动类型</legend>
					<label v-for="kind in c.kinds" :key="kind"
						><input
							v-model="c.preferences.value.movement_kinds[kind]"
							type="checkbox"
						/>{{ c.kindLabels[kind] }}</label
					>
				</fieldset>
				<div class="notification-save-row">
					<p role="status" aria-live="polite">
						{{
							c.saving.value
								? "正在保存…"
								: c.dirty.value
									? "设置尚未保存"
									: "已保存"
						}}
					</p>
					<UiButton
						variant="primary"
						:disabled="!c.dirty.value"
						:loading="c.saving.value"
						@click="c.save"
						>保存设置</UiButton
					>
				</div>
				<p v-if="c.saveError.value" role="alert">
					{{ c.saveError.value }} <UiButton @click="c.save">重试保存</UiButton>
				</p>
			</section>
			<section class="surface utility-panel push-settings">
				<h2>本设备推送</h2>
				<p role="status">
					{{ states[c.pushState.value]
					}}<span v-if="isDev"> · 开发环境未注册 Service Worker，推送不可用</span>
				</p>
				<p v-if="c.pushState.value === 'denied'" class="muted">
					请在浏览器设置中允许此站点发送通知。
				</p>
				<p v-if="c.pushState.value === 'install'" class="muted">
					请先将应用添加到主屏幕，再从主屏幕打开。
				</p>
				<div class="push-actions">
					<UiButton
						v-if="c.pushState.value === 'off'"
						variant="primary"
						:loading="c.pushBusy.value"
						@click="c.enablePush"
						>开启推送</UiButton
					>
					<UiButton
						v-if="c.pushState.value === 'subscribed'"
						:loading="c.pushBusy.value"
						@click="c.testPush"
						>发送测试通知</UiButton
					>
					<UiButton
						v-if="c.pushState.value === 'subscribed'"
						:disabled="c.pushBusy.value"
						@click="c.disablePush"
						>关闭推送</UiButton
					>
				</div>
				<p v-if="c.pushError.value" role="alert">{{ c.pushError.value }}</p>
				<h3>此账户的其他设备</h3>
				<p v-if="!c.devices.value.length" class="muted">暂无其它已开启推送的设备。</p>
				<ul class="push-device-list">
					<li v-for="device in c.devices.value" :key="device.name">
						<span
							><strong>{{ device.user_agent_label || "浏览器设备" }}</strong
							><small>{{
								device.last_success
									? `最近成功：${device.last_success}`
									: device.last_error
										? `最近失败：${device.last_error}`
										: "尚未发送成功"
							}}</small></span
						><UiButton size="compact" @click="c.removeDevice(device)">移除</UiButton>
					</li>
				</ul>
			</section>
		</template>
	</section>
</template>
