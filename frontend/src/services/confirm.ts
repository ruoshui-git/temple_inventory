import { reactive } from "vue";
export type ConfirmOptions = {
	title: string;
	message: string;
	confirmLabel?: string;
	cancelLabel?: string;
	tone?: "default" | "danger";
};
type Pending = { options: ConfirmOptions; resolve: (accepted: boolean) => void };
const state = reactive<{ pending?: Pending }>({});
export function confirm(options: ConfirmOptions) {
	if (state.pending) return Promise.resolve(false);
	return new Promise<boolean>((resolve) => {
		state.pending = { options, resolve };
	});
}
export function resolveConfirm(accepted: boolean) {
	const pending = state.pending;
	state.pending = undefined;
	pending?.resolve(accepted);
}
export function useConfirm() {
	return { state, confirm };
}
