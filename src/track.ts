import { RulesGetRuleState } from "modules/rules";
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { formatTimeIntervalCN } from "utils";

export type TrackData = {
	orgasm_count: number;
	ruined_count: number;
	edged_time: number;
	active_time: number;
	last_arousal: number;
};

export function ReplaceTrackData(str: string): string {
	let expr = str;
	const state = RulesGetRuleState("other_track_status");
	if (state.inEffect && state.internalData !== undefined) {
		expr = expr.replace(/\{(\w*?_time)\}/gu, "$${formatTimeIntervalCN(state.internalData.$1)}");
		expr = expr.replace(/\{(\w*?)\}/gu, "$${state.internalData.$1}");
		expr = "`" + expr + "`";
	}
	// eslint-disable-next-line no-eval
	return eval(expr) as string;
}
