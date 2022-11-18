import cloneDeep from "lodash-es/cloneDeep";
import { BCXLoadedBeforeLogin, BCXLoginTimedata, BCX_setTimeout } from "../BCXContext";
import { ConditionsLimit, ModuleCategory } from "../constants";
import { AccessLevel, getCharacterAccessLevel } from "../modules/authority";
import { registerWhisperCommand } from "../modules/commands";
import { registerRule, RuleState, RuleType } from "../modules/rules";
import { hookFunction, patchFunction } from "patching";
import { getChatroomCharacter } from "../characters";
import { formatTimeInterval, isObject } from "../utils";
import { ChatRoomSendLocal } from "../utilsClub";
import { ReplaceTrackData, TrackData } from "../track";

export type TimerData = {
	asset_name: string;
	group_name: string;
	remove_timer: number;
};

export type ArousalData = {
	source?: Character;
	target?: Character;
	activity?: Activity | string;
	zone?: string;
	item?: string;
};
export const lastArousalData: ArousalData = {};

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
		keywords: ["inactivity", "detect", "record"],
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
		keywords: ["record", "stopwatch", "timer", "online"],
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
		shortDescription: "regularly show configurable sentences to PLAYER_NAME",
		longDescription: "This rule reminds or tells PLAYER_NAME one of the recorded sentences at random in a settable interval. Only PLAYER_NAME can see the set message and it is only shown if in a chat room.",
		keywords: ["hear", "voices", "in", "head", "messages", "periodic"],
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
		keywords: ["record", "balance", "earnings", "using", "tracking", "logging", "entry", "financial", "findom"],
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
					state.trigger(null, { TYPE: "spent", AMOUNT: `${state.internalData - Player.Money}`, BALANCE: `${Player.Money}` });
					returnValue = true;
				} else if (state.internalData < Player.Money && state.customData && state.customData.logEarnings) {
					state.trigger(null, { TYPE: "earned", AMOUNT: `${Player.Money - state.internalData}`, BALANCE: `${Player.Money}` });
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
		keywords: ["record", "online", "force", "useage", "using", "login"],
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
		last_orgasm_data: {},
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
		diffData.last_orgasm_data = {};
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
			data.last_orgasm_data = cloneDeep(diffData.last_orgasm_data);
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

	const convertGroupToZone = (groupName: string) => {
		const sourceGroup = AssetGroupGet(Player.AssetFamily, groupName)?.MirrorActivitiesFrom;
		return sourceGroup || groupName;
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
				last_orgasm_data: {},
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
					const playerName = Player.IsOwnedByMemberNumber(sender.MemberNumber) ? "小奴隶" : `${Player.Nickname ?? Player.Name}`;
					const targetName = Player.IsOwnedByMemberNumber(sender.MemberNumber) ? "主人" : `${sender.Character.Nickname ?? sender.Character.Name}姐姐`;
					let msg = "";
					msg += `报告${targetName}，${playerName}在过去的{active_time}中，一共高潮了{orgasm_count}次，被拒绝高潮{ruined_count}次，有{edged_time}处于高潮边缘状态。`;
					const orgasmData = state.internalData.last_orgasm_data;
					if (state.internalData.orgasm_count > 0) {
						if (!orgasmData.source_number || !orgasmData.target_number) {
							msg = `${playerName}上一次高潮是在{no_active_time}之前，但是细节已经记不清楚了。`;
						} else {
							msg += `${playerName}上一次是在{no_active_time}之前，`;
							if (orgasmData.activity && orgasmData.activity.startsWith("CustomData:")) {
								let customData = orgasmData.activity.substring("CustomData:".length);
								if (Player.IsOwnedByMemberNumber(orgasmData.source_number) || Player.IsOwnedByMemberNumber(orgasmData.target_number)) {
									customData = customData.replaceAll("{honorific}", "主人");
								} else {
									customData = customData.replaceAll("{honorific}", "姐姐");
								}
								msg += customData;
							} else {
								if (orgasmData.source_number !== Player.MemberNumber && orgasmData.target_number === Player.MemberNumber) {
									if (Player.IsOwnedByMemberNumber(orgasmData.source_number)) {
										msg += `被{last_orgasm_data.source_name}主人`;
									} else {
										msg += `被{last_orgasm_data.source_name}姐姐`;
									}
								}
								if (orgasmData.item) {
									msg += `用{last_orgasm_data.item}`;
								}
								if (orgasmData.activity) {
									msg += `{last_orgasm_data.activity}`;
								} else {
									msg += `玩弄`;
								}
								if (orgasmData.target_number === Player.MemberNumber) {
									if (orgasmData.source_number === Player.MemberNumber) {
										msg += `自己的`;
									}
									if (orgasmData.zone) {
										msg += `{last_orgasm_data.zone}`;
									}
									msg += `到达高潮的。`;
								} else {
									if (Player.IsOwnedByMemberNumber(orgasmData.target_number)) {
										msg += `{last_orgasm_data.target_name}主人，自己也到达了高潮。`;
									} else {
										msg += `{last_orgasm_data.target_name}姐姐，自己也到达了高潮。`;
									}
								}
							}
						}
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
			// Force show activities to avoid ActivityEffectFlat get skipped
			hookFunction("ChatRoomStimulationMessage", 0, (args, next) => {
				if (Player.ChatSettings) {
					Player.ChatSettings.ShowActivities = true;
				}
				return next(args);
			}, ModuleCategory.Rules);
			// Record event name as activity name for ActivityEffectFlat
			hookFunction("CommonRandomItemFromList", 0, (args, next) => {
				const result = next(args);
				if (typeof result.event === "string") {
					const dice = Math.random();
					if (dice <= result.chance) {
						result.chance = 1.0;
						lastArousalData.activity = result.event;
					} else {
						result.chance = 0.0;
					}
				}
				return result;
			}, ModuleCategory.Rules);
			// Track stimulation events, activity is already recorded in CommonRandomItemFromList
			hookFunction("ActivityEffectFlat", 11, (args, next) => {
				const source = args[0] as Character;
				const target = args[1] as Character;
				const group = args[3] as string;
				if (target.ID === 0) {
					lastArousalData.source = source;
					lastArousalData.target = Player;
					lastArousalData.zone = convertGroupToZone(group);
					lastArousalData.item = InventoryGet(Player, group)?.Asset.Name;
				}
				return next(args);
			}, ModuleCategory.Rules);
			// Record used item and targeted zone when activity is from other characters
			hookFunction("ChatRoomMessage", 11, (args, next) => {
				const data = args[0] as IChatRoomMessage;
				if (data && data.Type && data.Dictionary && Array.isArray(data.Dictionary)) {
					const sourceCharacter = data.Dictionary.find((x) => x.Tag === "SourceCharacter");
					const source = (sourceCharacter && sourceCharacter.MemberNumber) ? getChatroomCharacter(sourceCharacter.MemberNumber) : null;
					const targetCharacter = data.Dictionary.find((x) => x.Tag && ["TargetCharacter", "TargetCharacterName", "DestinationCharacter", "DestinationCharacterName"].includes(x.Tag));
					const target = (targetCharacter && targetCharacter.MemberNumber) ? getChatroomCharacter(targetCharacter.MemberNumber) : null;
					if (source && source.Character.ID !== 0 && target && target.Character.ID === 0) {
						if (data.Type === "Action") {
							const group = data.Dictionary.find((x) => x.AssetGroupName);
							if (group) {
								lastArousalData.zone = convertGroupToZone(group.AssetGroupName as string);
							} else {
								lastArousalData.zone = undefined;
							}
							const assetName = data.Dictionary.find((x) => x.AssetName);
							const asset = assetName ? Asset.find((x) => x.Name === assetName.AssetName) : undefined;
							if (asset) {
								lastArousalData.item = asset.DynamicName(source.Character) || asset.Name;
							} else {
								lastArousalData.item = undefined;
							}
						} else if (data.Type === "Activity") {
							const group = data.Dictionary.find((x) => x.Tag === "ActivityGroup");
							if (group && group.Text) {
								lastArousalData.zone = convertGroupToZone(group.Text);
							} else {
								lastArousalData.zone = undefined;
							}
							lastArousalData.item = undefined;
						}
					}
					if (source && source.Character.ID === 0 && target && target.Character.ID !== 0 && data.Sender !== Player.MemberNumber) {
						if (data.Type === "Activity") {
							const activityName = data.Dictionary.find((x) => x.Tag === "ActivityName")!;
							const activity = AssetGetActivity(Player.AssetFamily, activityName.Text!)!;
							ActivityRunSelf(source.Character, target.Character, activity);				
						}
					}
				}
				return next(args);
			}, ModuleCategory.Rules);
			// Record used item and targeted zone when activity is to other characters or by self. Target zone will be used for zone-to-zone activities
			hookFunction("ActivityRun", 11, (args, next) => {
				const C = args[0] as Character;
				const activity = (args[1] as ItemActivity).Activity;
				if (C.ID === 0) {
					if (C.FocusGroup) {
						lastArousalData.zone = convertGroupToZone(C.FocusGroup.Name);
					} else {
						lastArousalData.zone = undefined;
					}
				} else {
					if (C.FocusGroup) {
						lastArousalData.zone = convertGroupToZone(C.FocusGroup.Name);
					} else {
						lastArousalData.zone = undefined;
					}
					if (activity.Prerequisite.includes("UseMouth")) {
						lastArousalData.zone = "ItemMouth";
					} else if (activity.Prerequisite.includes("UseTongue")) {
						lastArousalData.zone = "ItemMouth";
					} else if (activity.Prerequisite.includes("UseHands")) {
						lastArousalData.zone = "ItemHands";
					} else if (activity.Prerequisite.includes("UseArms")) {
						lastArousalData.zone = "ItemHands";
					} else if (activity.Prerequisite.includes("UseFeet")) {
						lastArousalData.zone = "ItemFeet";
					} else if (activity.Prerequisite.some(x => x.startsWith("Needs-"))) {
						const idx = activity.Prerequisite.findIndex(x => x.startsWith("Needs-"));
						const activityItem = Player.Appearance.find(item =>
							(item.Asset && Array.isArray(item.Asset.AllowActivity) && item.Asset.AllowActivity.includes(activity.Prerequisite[idx].substring(6)))
							|| (item.Property && Array.isArray(item.Property.AllowActivity) && item.Property.AllowActivity.includes(activity.Prerequisite[idx].substring(6)))
						);
						if (activityItem !== undefined) {
							lastArousalData.zone = activityItem.Asset.ArousalZone;
						}
					} else {
						// No associated arousal zone
					}
				}
				lastArousalData.item = undefined;
				return next(args);
			}, ModuleCategory.Rules);
			// Fix ActivityArousalItem doesn't get triggered if there is a locked item on focus group
			patchFunction("DialogItemClick", {
				"else if (!ClickItem.Asset.Wear)\n\t\t\tDialogPublishAction(C, ClickItem);": `
				else if (!ClickItem.Asset.Wear) {
					DialogPublishAction(C, ClickItem);
					ActivityArousalItem(Player, C, ClickItem.Asset);
				}
				`
			});
			patchFunction("ChatRoomMessage", {
				"else if (dictionary[D].ActivityCounter) ActivityCounter = dictionary[D].ActivityCounter;": `
				else if (dictionary[D].Tag == "ActivityName") ActivityName = dictionary[D].Text;
				else if (dictionary[D].Tag == "ActivityGroup") GroupName = dictionary[D].Text;
				else if (dictionary[D].ActivityCounter) ActivityCounter = dictionary[D].ActivityCounter;
				`
			});
			// Track everything for custom actions on other characters, since it will not call ActivityRunSelf
			hookFunction("ChatRoomPublishCustomAction", 11, (args, next) => {
				const dictionary = args[2] as ChatMessageDictionary;
				if (Array.isArray(dictionary)) {
					const source = dictionary.find((x) => x.Tag === "SourceCharacter");
					const target = dictionary.find((x) => x.Tag === "DestinationCharacter");
					const activity = dictionary.find((x) => x.Tag === "ActivityName");
					const group = dictionary.find((x) => x.Tag === "ActivityGroup");
					const item = dictionary.find((x => x.Tag === "AssetName"));
					lastArousalData.source = (source && source.MemberNumber) ? getChatroomCharacter(source.MemberNumber)?.Character : undefined;
					lastArousalData.target = (target && target.MemberNumber) ? getChatroomCharacter(target.MemberNumber)?.Character : undefined;
					lastArousalData.activity = (activity && activity.Text) ? AssetGetActivity(Player.AssetFamily, activity.Text) : undefined;
					lastArousalData.zone = (group && group.Text && lastArousalData.target && lastArousalData.target.ID === 0) ? convertGroupToZone(group.Text) : undefined;
					lastArousalData.item = (item && item.AssetName) ? item.AssetName as string : undefined;
				}
				return next(args);
			}, ModuleCategory.Rules);
			// Record used item, associated acitivity, and targeted zone when items are used to other characters
			hookFunction("ActivityArousalItem", 11, (args, next) => {
				const source = args[0] as Character;
				const target = args[1] as Character;
				const asset = args[2] as Asset;
				const assetActivity = asset.DynamicActivity(source);
				const activity = assetActivity ? AssetGetActivity(Player.AssetFamily, assetActivity) : undefined;
				if (activity) {
					lastArousalData.activity = activity;
				}
				if (target.ID === 0) {
					lastArousalData.zone = asset.ArousalZone;
				} else {
					lastArousalData.zone = undefined;
				}
				if (asset.Wear) {
					lastArousalData.item = asset.DynamicName(target) || asset.Name;
				} else {
					lastArousalData.item = asset.DynamicName(source) || asset.Name;
				}
				return next(args);
			}, ModuleCategory.Rules);
			// Override vanilla function to support DynamicActivity
			hookFunction("ActivityArousalItem", 0, (args, next) => {
				const source = args[0] as Character;
				const target = args[1] as Character;
				// Re-implement original logic
				if (typeof lastArousalData.activity === "object") {
					if (source.ID === 0 && target.ID !== 0) ActivityRunSelf(source, target, lastArousalData.activity);
					if (PreferenceArousalAtLeast(target, "Hybrid") && (target.ID === 0 || target.IsNpc()))
						ActivityEffect(source, target, lastArousalData.activity, lastArousalData.zone);
				}
			}, ModuleCategory.Rules);
			// Track activities from other characters or by self, zone and item are already recorded in ChatRoomMessage or ActivityRun or ActivityArousalItem
			hookFunction("ActivityEffect", 11, (args, next) => {
				const source = args[0] as Character;
				const target = args[1] as Character;
				const activity = args[2] as Activity | string;
				lastArousalData.source = source;
				lastArousalData.target = target;
				lastArousalData.activity = (typeof activity === "string") ? AssetGetActivity(Player.AssetFamily, activity) : activity;
				return next(args);
			}, ModuleCategory.Rules);
			// Track activities on other characters, zone and item are already recorded in ActivityRun or ActivityArousalItem
			hookFunction("ActivityRunSelf", 11, (args, next) => {
				const source = args[0] as Character;
				const target = args[1] as Character;
				const activity = args[2] as Activity;
				if (target.ID !== 0) {
					lastArousalData.source = source;
					lastArousalData.target = target;
					lastArousalData.activity = activity;
				}
				return next(args);
			}, ModuleCategory.Rules);
			// Override vanilla function to use new arousal zone
			hookFunction("ActivityRunSelf", 0, (args, next) => {
				const source = args[0] as Character;
				const target = args[1] as Character;
				const activity = args[2] as Activity;
				// console.log(`ActivityRunSelf Source:${lastArousalData.source?.MemberNumber} Target:${lastArousalData.target?.MemberNumber} Activity:${typeof lastArousalData.activity === "string" ? lastArousalData.activity : lastArousalData.activity?.Name}, Zone:${lastArousalData.zone}, Item:${lastArousalData.item}`);
				if (((Player.ArousalSettings?.Active === "Hybrid") || (Player.ArousalSettings?.Active === "Automatic")) && (source.ID === 0) && (target.ID !== 0)) {
					let factor = (PreferenceGetActivityFactor(Player, activity.Name, false) * 5) - 10;
					factor += Math.floor((Math.random() * 8));
					if (target.IsLoverOfPlayer()) factor += Math.floor((Math.random() * 8));
					ActivitySetArousalTimer(Player, activity, lastArousalData.zone || "undefined", factor);
				}
			}, ModuleCategory.Rules);
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
					diffData.last_orgasm_data = {};
					diffData.last_orgasm_data.source_name = lastArousalData.source?.Nickname || lastArousalData.source?.Name;
					diffData.last_orgasm_data.source_number = lastArousalData.source?.MemberNumber;
					diffData.last_orgasm_data.target_name = lastArousalData.target?.Nickname || lastArousalData.target?.Name;
					diffData.last_orgasm_data.target_number = lastArousalData.target?.MemberNumber;
					const activity = (typeof lastArousalData.activity === "string") ? lastArousalData.activity : lastArousalData.activity?.Name;
					if (activity) {
						if (typeof lastArousalData.activity === "object" && lastArousalData.activity.CustomData) {
							diffData.last_orgasm_data.activity = "CustomData:" + lastArousalData.activity.CustomData;
						} else {
							const entry = ActivityDictionary.find((x) => x[0] === "Activity" + activity);
							if (entry) {
								diffData.last_orgasm_data.activity = (Array.isArray(entry) && entry.length >= 2) ? entry[1] : undefined;
								if (activity.endsWith("Item")) {
									diffData.last_orgasm_data.activity = diffData.last_orgasm_data.activity?.replace("用物品", "");
								}
							} else {
								diffData.last_orgasm_data.activity = undefined;
							}
						}
					}
					diffData.last_orgasm_data.zone = AssetGroup.find((x) => x.Name === lastArousalData.zone)?.Description;
					diffData.last_orgasm_data.item = Asset.find((x) => x.Name === lastArousalData.item)?.Description;
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
