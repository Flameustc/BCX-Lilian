import cloneDeep from "lodash-es/cloneDeep";
import { BCXLoadedBeforeLogin, BCXLoginTimedata, BCX_setTimeout } from "../BCXContext";
import { ConditionsLimit, ModuleCategory } from "../constants";
import { AccessLevel, getCharacterAccessLevel } from "../modules/authority";
import { registerWhisperCommand } from "../modules/commands";
import { registerRule, RuleState, RuleType } from "../modules/rules";
import { hookFunction } from "patching";
import { formatTimeInterval, isObject } from "../utils";
import { ChatRoomSendLocal } from "../utilsClub";
import { ReplaceTrackData, TrackData } from "../track";

export type TimerData = {
	asset_name: string;
	group_name: string;
	remove_timer: number;
};

export function initRules_other() {
	let lastAction = Date.now();
	let afkDidTrigger = false;
	function afk_reset() {
		lastAction = Date.now();
		afkDidTrigger = false;
	}

	registerRule("other_forbid_afk", {
		name: "Forbid going afk",
		type: RuleType.Other,
		enforceable: false,
		shortDescription: "logs whenever PLAYER_NAME is inactive",
		longDescription: "This rule forbids PLAYER_NAME to go afk and logs when the allowed inactivity threshold is overstepped.",
		triggerTexts: {
			log: "PLAYER_NAME became inactive, which was forbidden",
			announce: ""
		},
		defaultLimit: ConditionsLimit.blocked,
		dataDefinition: {
			minutesBeforeAfk: {
				type: "number",
				default: 10,
				description: "Amount of minutes, before being considered inactive:"
			}
		},
		load() {
			AfkTimerEventsList.forEach(e => document.addEventListener(e, afk_reset, true));
		},
		tick(state) {
			if (!afkDidTrigger && state.inEffect && state.customData &&
				Date.now() > lastAction + state.customData.minutesBeforeAfk * 60 * 1000
			) {
				afkDidTrigger = true;
				state.trigger();
				ChatRoomSendLocal("You broke a BCX rule by being inactive for too long. The transgression was logged.");
				return true;
			}
			return false;
		},
		unload() {
			AfkTimerEventsList.forEach(e => document.removeEventListener(e, afk_reset, true));
		}
	});

	let lastUpdate: number = 0;
	registerRule("other_track_time", {
		name: "Track rule effect time",
		type: RuleType.Other,
		enforceable: false,
		loggable: false,
		shortDescription: "counts the time this rule's trigger conditions were fulfilled",
		longDescription: "This rule shows the amount of time that PLAYER_NAME spent (online) in the club, since the rule was added, while all of the rule's trigger conditions were fulfilled. So it can for instance log the time spent in public rooms / in the club in general, or in a specific room or with some person as part of a roleplayed task or order. The currently tracked time can be inquired by whispering '!ruletime' to PLAYER_NAME. To reset the counter, remove and add the rule again.",
		internalDataValidate: (v) => typeof v === "number",
		internalDataDefault: () => 0,
		defaultLimit: ConditionsLimit.blocked,
		dataDefinition: {
			minimumPermittedRole: {
				type: "roleSelector",
				default: AccessLevel.lover,
				description: "Minimum role able to request counted time:"
			}
		},
		init(state) {
			registerWhisperCommand("hidden", "ruletime", null, (argv, sender, respond) => {
				if (state.condition && state.customData && state.internalData !== undefined && getCharacterAccessLevel(sender) <= state.customData.minimumPermittedRole) {
					const fixup = state.inEffect ? (Date.now() - lastUpdate) : 0;
					const msg = `Since the time tracking rule was added, ${formatTimeInterval(state.internalData + fixup)} were counted, where all trigger conditions were true.`;
					respond(msg);
					return true;
				}
				return false;
			}, null, false);
		},
		load() {
			lastUpdate = Date.now();
		},
		tick(state) {
			if (state.inEffect && state.internalData !== undefined) {
				const change = Math.floor(Date.now() - lastUpdate);
				if (change >= 60_000) {
					state.internalData += change;
					lastUpdate = Date.now();
				}
			}
			return false;
		},
		stateChange(state, newState) {
			if (newState) {
				lastUpdate = Date.now();
			} else if (state.internalData !== undefined) {
				const change = Math.floor(Date.now() - lastUpdate);
				state.internalData += change;
				lastUpdate = Date.now();
			}
		}
	});

	let lastReminder = 0;
	registerRule("other_constant_reminder", {
		name: "Listen to my voice",
		type: RuleType.Other,
		loggable: false,
		enforceable: false,
		shortDescription: "regularily show configurable sentences to PLAYER_NAME",
		longDescription: "This rule reminds or tells PLAYER_NAME one of the recorded sentences at random in a settable interval. Only PLAYER_NAME can see the set message and it is only shown if in a chat room.",
		defaultLimit: ConditionsLimit.limited,
		dataDefinition: {
			reminderText: {
				type: "stringList",
				default: [],
				description: "The sentences that will be shown at random:",
				Y: 296
			},
			reminderFrequency: {
				type: "number",
				default: 15,
				description: "Frequency of a sentence being shown (in minutes):",
				Y: 715
			}
		},
		tick(state) {
			if (state.inEffect && state.customData && state.customData.reminderText !== [] &&
				ServerPlayerIsInChatRoom() &&
				Date.now() > lastReminder + state.customData.reminderFrequency * 60 * 1000
			) {
				lastReminder = Date.now();
				ChatRoomSendLocal("[Voice] " + state.customData.reminderText[Math.floor(Math.random() * state.customData.reminderText.length)]);
				return true;
			}
			return false;
		}
	});

	registerRule("other_log_money", {
		name: "Log money changes",
		type: RuleType.Other,
		enforceable: false,
		shortDescription: "spending and/or getting money",
		longDescription: "This rule logs whenever money is used to buy something. It also shows how much money PLAYER_NAME currently has in the log entry. Optionally, earning money can also be logged. Note: Please be aware that this last option can potentially fill the whole behaviour log rapidly.",
		triggerTexts: {
			infoBeep: "A BCX rule has logged this financial transaction!",
			log: "PLAYER_NAME TYPE money: AMOUNT $ | new balance: BALANCE $",
			announce: ""
		},
		defaultLimit: ConditionsLimit.normal,
		dataDefinition: {
			logEarnings: {
				type: "toggle",
				default: false,
				description: "Also log getting money"
			}
		},
		internalDataValidate: (data) => typeof data === "number",
		internalDataDefault: () => -1,
		stateChange(state, newState) {
			if (!newState) {
				state.internalData = -1;
			}
		},
		tick(state) {
			if (!state.internalData || !Number.isFinite(Player.Money))
				return false;
			let returnValue = false;
			if (state.inEffect) {
				if (state.internalData < 0) {
					state.internalData = Player.Money;
				}
				if (state.internalData > Player.Money) {
					state.trigger({ TYPE: "spent", AMOUNT: `${state.internalData - Player.Money}`, BALANCE: `${Player.Money}` });
					returnValue = true;
				} else if (state.internalData < Player.Money && state.customData && state.customData.logEarnings) {
					state.trigger({ TYPE: "earned", AMOUNT: `${Player.Money - state.internalData}`, BALANCE: `${Player.Money}` });
					returnValue = true;
				}
				if (state.internalData !== Player.Money) {
					state.internalData = Player.Money;
				}
			}
			return returnValue;
		}
	});

	/* TODO: Idea stage
	registerRule("other_restrict_console_usage", {
		name: "Restrict console usage",
		type: RuleType.Other,
		loggable: false,
		shortDescription: "to not allow freeing oneself",
		longDescription: "Makes the player unable to use the browser console to change their own appearance in the club, such as removing restraints.",
		defaultLimit: ConditionsLimit.blocked
	});
	*/

	const removeTrackingEntry = (hiddenItems: any[]) => {
		for (; ;) {
			const index = hiddenItems.findIndex(a => isObject(a) && typeof a.Name === "string" && a.Name.startsWith("GoodGirl") && a.Group === "BCX");
			if (index < 0)
				break;
			hiddenItems.splice(index, 1);
			ServerPlayerBlockItemsSync();
		}
	};

	const hasTrackingEntry = (hiddenItems: any[], token: number) => {
		return hiddenItems.some(a => isObject(a) && a.Name === `GoodGirl${token}` && a.Group === "BCX");
	};

	const addTrackingEntry = (hiddenItems: any[], token: number) => {
		removeTrackingEntry(hiddenItems);
		hiddenItems.push({ Name: `GoodGirl${token}`, Group: "BCX" });
	};

	registerRule("other_track_BCX_activation", {
		name: "Track BCX activation",
		type: RuleType.Other,
		enforceable: false,
		shortDescription: "logs if PLAYER_NAME enters the club without BCX",
		longDescription: "This rule observes PLAYER_NAME, logging it as a rule violation if the club was previously entered at least once without BCX active.",
		triggerTexts: {
			infoBeep: "You logged in without starting BCX beforehand!",
			log: "PLAYER_NAME logged in without starting BCX beforehand at least once",
			announce: ""
		},
		internalDataValidate: (v) => typeof v === "number",
		internalDataDefault: () => Math.floor(Math.random() * 1_000_000),
		defaultLimit: ConditionsLimit.blocked,
		load(state) {
			if (state.inEffect && state.internalData !== undefined) {
				if (
					!BCXLoadedBeforeLogin ||
					!Array.isArray(BCXLoginTimedata.HiddenItems) ||
					!hasTrackingEntry(BCXLoginTimedata.HiddenItems, state.internalData)
				) {
					BCX_setTimeout(() => {
						state.trigger();
						state.internalData = Math.floor(Math.random() * 1_000_000);
						addTrackingEntry(Player.HiddenItems, state.internalData);
						ServerPlayerBlockItemsSync();
					}, 3_500);
				} else {
					state.internalData = Math.floor(Math.random() * 1_000_000);
					addTrackingEntry(Player.HiddenItems, state.internalData);
					ServerPlayerBlockItemsSync();
				}
			}
		},
		stateChange(state, newState) {
			if (newState) {
				state.internalData = Math.floor(Math.random() * 1_000_000);
				addTrackingEntry(Player.HiddenItems, state.internalData);
				ServerPlayerBlockItemsSync();
			} else {
				removeTrackingEntry(Player.HiddenItems);
				ServerPlayerBlockItemsSync();
			}
		},
		tick(state) {
			if (state.inEffect && state.internalData !== undefined) {
				if (!hasTrackingEntry(Player.HiddenItems, state.internalData) || Math.random() < 0.01) {
					state.internalData = Math.floor(Math.random() * 1_000_000);
					addTrackingEntry(Player.HiddenItems, state.internalData);
					ServerPlayerBlockItemsSync();
				}
			}
			return false;
		}
	});

	const diffData: TrackData = {
		active_time: 0,
		edged_time: 0,
		orgasm_count: 0,
		ruined_count: 0,
		no_active_time: 0,
		no_edged_time: 0,
		no_ruined_count: 0,
		last_arousal: -1
	};

	const needUpdate = () => {
		return (
			diffData.active_time >= 60_000 ||
			diffData.edged_time >= 60_000 ||
			diffData.orgasm_count > 0 ||
			diffData.ruined_count > 0
		);
	};

	const clearDiffData = () => {
		diffData.active_time = 0;
		diffData.edged_time = 0;
		diffData.orgasm_count = 0;
		diffData.ruined_count = 0;
		diffData.no_active_time = 0;
		diffData.no_edged_time = 0;
		diffData.no_ruined_count = 0;
	};

	const addDiffData = (data: TrackData) => {
		data.active_time += diffData.active_time;
		data.edged_time += diffData.edged_time;
		data.orgasm_count += diffData.orgasm_count;
		data.ruined_count += diffData.ruined_count;
		if (diffData.orgasm_count > 0) {
			data.no_active_time = diffData.no_active_time;
			data.no_edged_time = diffData.no_edged_time;
			data.no_ruined_count = diffData.no_ruined_count;
		} else {
			data.no_active_time += diffData.no_active_time;
			data.no_edged_time += diffData.no_edged_time;
			data.no_ruined_count += diffData.no_ruined_count;
		}
		data.last_arousal = diffData.last_arousal;
		return data;
	};

	let lastTrackTime: number = 0;
	const updateTrackData = (state: RuleState<"other_track_status">, force: boolean) => {
		if (state.internalData !== undefined) {
			const change = Math.floor(Date.now() - lastTrackTime);
			lastTrackTime = Date.now();
			diffData.active_time += change;
			diffData.no_active_time += change;
			if (Player.ArousalSettings) {
				if (diffData.last_arousal >= 90 && Player.ArousalSettings.Progress >= 90) {
					diffData.edged_time += change;
				}
				diffData.last_arousal = Player.ArousalSettings.Progress;
			}
			if (force || needUpdate()) {
				const newData = cloneDeep(state.internalData);
				state.internalData = addDiffData(newData);
				clearDiffData();
			}
		}
	};

	registerRule("other_track_status", {
		name: "Track status",
		type: RuleType.Other,
		enforceable: false,
		loggable: false,
		longDescription: "This rule tracks specified status of PLAYER_NAME, since the rule was added, while all of the rule's trigger conditions were fulfilled. The currently tracked data can be inquired by whispering '!track' to PLAYER_NAME. To reset the counter, remove and add the rule again.",
		internalDataValidate: (v) => v !== undefined,
		internalDataDefault: () => {
			return {
				active_time: 0,
				edged_time: 0,
				orgasm_count: 0,
				ruined_count: 0,
				no_active_time: 0,
				no_edged_time: 0,
				no_ruined_count: 0,
				last_arousal: -1
			};
		},
		defaultLimit: ConditionsLimit.blocked,
		dataDefinition: {
			minimumPermittedRole: {
				type: "roleSelector",
				default: AccessLevel.owner,
				description: "Minimum role able to request tracking data:"
			}
		},
		init(state) {
			registerWhisperCommand("hidden", "track", null, (argv, sender, respond) => {
				const subcommand = (argv[0] || "").toLocaleLowerCase();
				if (state.inEffect && state.customData && state.internalData !== undefined && getCharacterAccessLevel(sender) <= state.customData.minimumPermittedRole) {
					updateTrackData(state, true);
					let msg = "";
					if (Player.IsOwnedByMemberNumber(sender.MemberNumber)) {
						msg = `报告主人，小奴隶已经连续{no_active_time}没有获得高潮了。在过去的{active_time}中，小奴隶一共高潮了{orgasm_count}次，被拒绝高潮{ruined_count}次，有{edged_time}处于高潮边缘状态。`;
					} else {
						msg = `报告姐姐，${Player.Nickname ?? Player.Name}已经连续{no_active_time}没有获得高潮了。在过去的{active_time}中，${Player.Nickname ?? Player.Name}一共高潮了{orgasm_count}次，被拒绝高潮{ruined_count}次，有{edged_time}处于高潮边缘状态。`;
					}
					msg = ReplaceTrackData(msg);
					if (subcommand === "chat") {
						ServerSend("ChatRoomChat", { Content: msg, Type: "Chat" });
					} else {
						respond(msg);
					}
					return true;
				}
				return false;
			}, null, false);
		},
		load(state) {
			hookFunction("ActivityOrgasmStart", 0, (args, next) => {
				const C = args[0] as Character;
				if (state.inEffect && C.ID === 0 && (typeof ActivityOrgasmRuined === "undefined" || !ActivityOrgasmRuined)) {
					const change = Math.floor(Date.now() - lastUpdate);
					lastTrackTime = Date.now();
					diffData.active_time += change;
					if (Player.ArousalSettings) {
						if (diffData.last_arousal >= 90 && Player.ArousalSettings.Progress >= 90) {
							diffData.edged_time += change;
						}
						diffData.last_arousal = Player.ArousalSettings.Progress;
					}
					diffData.orgasm_count += 1;
					diffData.no_active_time = 0;
					diffData.no_edged_time = 0;
					diffData.no_ruined_count = 0;
				}
				return next(args);
			}, ModuleCategory.Rules);
			hookFunction("ActivityOrgasmStop", 0, (args, next) => {
				const C = args[0] as Character;
				if (state.inEffect && C.ID === 0 && ActivityOrgasmRuined) {
					diffData.ruined_count += 1;
					diffData.no_ruined_count += 1;
				}
				return next(args);
			}, ModuleCategory.Rules);
			if (state.inEffect && state.internalData !== undefined && Player.ArousalSettings) {
				Player.ArousalSettings.OrgasmCount = state.internalData.orgasm_count;
				Player.ArousalSettings.Progress = state.internalData.last_arousal;
				ActivityChatRoomArousalSync(Player);
			}
			lastTrackTime = Date.now();
		},
		tick(state) {
			if (state.inEffect) {
				updateTrackData(state, false);
			}
			return false;
		},
		stateChange(state, newState) {
			if (newState) {
				lastTrackTime = Date.now();
			} else {
				updateTrackData(state, true);
			}
		}
	});

	let lastTimerUpdate: number = 0;
	registerRule("other_timer_lock", {
		name: "Advanced timer lock",
		type: RuleType.Other,
		enforceable: false,
		loggable: false,
		longDescription: "This rule changes default behavior of all timer locks on PLAYER_NAME.",
		internalDataValidate: (v) => v !== undefined,
		internalDataDefault: () => [],
		defaultLimit: ConditionsLimit.blocked,
		dataDefinition: {
			minimumPermittedRole: {
				type: "roleSelector",
				default: AccessLevel.public,
				description: "Minimum role able to modify remaining time:"
			}
		},
		load(state) {
			hookFunction("TimerInventoryRemove", 5, (args, next) => {
				if (state.condition && state.condition.active && state.internalData !== undefined) {
					const internalData = state.internalData;
					let changed = false;
					for (let i = internalData.length - 1; i >= 0; i--) {
						const item = InventoryGet(Player, internalData[i].group_name);
						if (item && item.Asset.Name === internalData[i].asset_name && item.Property && typeof item.Property.RemoveTimer === "number") {
							let timer = internalData[i].remove_timer;
							const lock = InventoryGetLock(item);
							if (lock) {
								timer = Math.min(timer, lock.Asset.MaxTimer * 1000);
							}
							item.Property.RemoveTimer = Math.round(CurrentTime + timer);
						} else {
							internalData.splice(i, 1);
							changed = true;
						}
					}
					for (const item of Player.Appearance) {
						if (item.Property && typeof item.Property.RemoveTimer === "number" && !internalData.some((x) => x.group_name === item.Asset.Group.Name)) {
							internalData.push({
								asset_name: item.Asset.Name,
								group_name: item.Asset.Group.Name,
								remove_timer: item.Property.RemoveTimer - CurrentTime
							});
							changed = true;
						}
					}
					if (changed) {
						state.internalData = internalData;
					}
				}
				return next(args);
			}, ModuleCategory.Rules);
			hookFunction("ValidationResolveLockModification", 1, (args, next) => {
				const previousItem = args[0] as Item;
				const newItem = args[1] as Item;
				const params = args[2] as AppearanceUpdateParameters;
				const previousProperty = previousItem.Property || {};
				const newProperty = newItem.Property = newItem.Property || {};
				if (state.condition && state.condition.active && state.customData && state.internalData !== undefined && typeof newProperty.RemoveTimer === "number" && previousProperty.RemoveTimer !== newProperty.RemoveTimer) {
					if (getCharacterAccessLevel(params.sourceMemberNumber) > state.customData.minimumPermittedRole) {
						ValidationCopyProperty(previousProperty, newProperty, "RemoveTimer");
						next(args);
						return false;
					}
					const internalData = state.internalData;
					const idx = internalData.findIndex((x) => x.group_name === newItem.Asset.Group.Name);
					if (idx >= 0) {
						internalData[idx].remove_timer = newProperty.RemoveTimer - CurrentTime;
					} else {
						internalData.push({
							asset_name: newItem.Asset.Name,
							group_name: newItem.Asset.Group.Name,
							remove_timer: newProperty.RemoveTimer - CurrentTime
						});
					}
					state.internalData = internalData;
				}
				return next(args);
			}, ModuleCategory.Rules);
			lastTimerUpdate = Date.now();
		},
		tick(state) {
			if (state.inEffect && state.internalData !== undefined) {
				const change = Math.floor(Date.now() - lastTimerUpdate);
				const internalData = state.internalData;
				internalData.forEach((x) => x.remove_timer -= change);
				state.internalData = internalData;
				lastTimerUpdate = Date.now();
			}
			return false;
		},
		stateChange(state, newState) {
			if (newState) {
				lastTimerUpdate = Date.now();
			} else if (state.internalData !== undefined) {
				const change = Math.floor(Date.now() - lastTimerUpdate);
				const internalData = state.internalData;
				internalData.forEach((x) => x.remove_timer -= change);
				state.internalData = internalData;
				lastTimerUpdate = Date.now();
			}
		}
	});
}
