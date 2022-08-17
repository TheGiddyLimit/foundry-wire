import { setupActionQueue } from "./action-queue.js";
import { SelectVariantDialog } from "./apps/select-variant.js";
import { initAreaConditionHooks } from "./conditions/area-effects.js";
import { initCombatTurnConditionHooks } from "./conditions/combat-turns.js";
import { DamageParts } from "./game/damage-parts.js";
import { initEffectFlagHooks, setupRollFlagWrappers } from "./game/effect-flags.js";
import { registerHandlebarsHelpers } from "./handlebars.js";
import { initHooks } from "./hooks.js";
import { initActiveEffectSheetHooks, setupActiveEffectSheetWrappers } from "./injections/active-effect-sheet.js";
import { readyCharacterSheetWrappers } from "./injections/character-sheet.js";
import { initItemSheetHooks, setupItemSheetWrappers } from "./injections/item-sheet.js";
import { setupSocket } from "./socket.js";
import { setupWrappers } from "./wrappers.js";

Hooks.once("init", () => {
    initHooks();
    registerHandlebarsHelpers();

    initItemSheetHooks();
    initActiveEffectSheetHooks();

    initCombatTurnConditionHooks();
    initAreaConditionHooks();

    initEffectFlagHooks();

    game.wire = {
        DamageParts,
        SelectVariantDialog
    }
});

Hooks.once("setup", () => {
    setupWrappers();
    setupItemSheetWrappers();
    setupActiveEffectSheetWrappers();
    setupRollFlagWrappers();
    setupSocket();
    setupActionQueue();
});

Hooks.once("ready", () => {
    readyCharacterSheetWrappers();
});
