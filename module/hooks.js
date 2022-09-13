import { runInQueue } from "./action-queue.js";
import { Activation } from "./activation.js";
import { ConcentrationCard } from "./cards/concentration-card.js";
import { DamageCard } from "./cards/damage-card.js";
import { ItemCard } from "./cards/item-card.js";
import { updateCombatTurnEndConditions, updateCombatTurnStartConditions } from "./conditions/combat-turns.js";
import { applySingleEffect } from "./game/active-effects.js";
import { getDisplayableAttackComponents } from "./game/attack-components.js";
import { getStaticAttackOptions, getWireFlags } from "./game/effect-flags.js";
import { createTemplate } from "./preroll.js";
import { areAllied, areEnemies, fromUuid, i18n, isActorEffect, isAuraEffect, isAuraTargetEffect, isEffectEnabled, tokenSeparation } from "./utils.js";

export function initHooks() {
    Hooks.on("renderChatLog", (app, html, data) => {
         ItemCard.activateListeners(html)
         DamageCard.activateListeners(html);
         ConcentrationCard.activateListeners(html);
    });
    Hooks.on("renderChatPopout", (app, html, data) => ItemCard.activateListeners(html));

    Hooks.on("createChatMessage", async (message, options, user) => {
        await runInQueue(async () => {
            if (game.user.isGM && !message.isAuthor && message.getFlag("wire", "originatorUserId")) {
                const gmMessageData = {
                    content: message.data.content,
                    flags: foundry.utils.mergeObject(message.data.flags, { "wire.isGmView": true }),
                    flavor: message.data.flavor,
                    speaker: message.data.speaker,
                    user: game.user.id,
                    whisper: [game.user.id]
                };
                const gmMessage = await ChatMessage.create(gmMessageData);
    
                if (gmMessage) {
                    const activation = await Activation._initializeGmMessage(gmMessage, message);
                    await activation._updateCard();
                }
            }
        });
    });

    Hooks.on("deleteChatMessage", async (message, options, user) => {
        if (game.user.isGM && message.getFlag("wire", "originatorUserId")) {
            await removeLinkedMessage(message.getFlag("wire", "masterMessageUuid"));
            await removeLinkedMessage(message.getFlag("wire", "gmMessageUuid"));
            await removeLinkedMessage(message.getFlag("wire", "playerMessageUuid"));

            const templateUuid = message.data.flags.wire?.activation?.templateUuid;
            const masterEffectUuid = message.data.flags.wire?.activation?.masterEffectUuid;
            if (!masterEffectUuid && templateUuid) {
                fromUuid(templateUuid)?.delete();
            }
        }
    });

    Hooks.on("renderChatMessage", async (message, html, data) => {
        const shouldHidePlayerOriginated = game.user.isGM && !message.isAuthor && message.getFlag("wire", "originatorUserId");
        const shouldHidePlayerView = game.user.isGM && message.getFlag("wire", "isPlayerView");
        const isExplicitlyHidden = message.getFlag("wire", "isHidden");
        if (shouldHidePlayerOriginated || shouldHidePlayerView || isExplicitlyHidden) {
            html[0].classList.add("wire-gm-hide");
        }
    });

    Hooks.on("deleteActiveEffect", async (effect, options, user) => {
        if (game.user.isGM && isActorEffect(effect)) {
            // Master effect deleted
            if (effect.getFlag("wire", "isMasterEffect")) {
                const templateUuid = effect.getFlag("wire", "templateUuid");
                if (templateUuid) {
                    const template = fromUuid(templateUuid);
                    await template?.delete();
                }
    
                const childEffectUuids = effect.getFlag("wire", "childEffectUuids");
                if (childEffectUuids && childEffectUuids.length) {
                    for (let uuid of childEffectUuids) {
                        await fromUuid(uuid)?.delete();
                    }
                }
            }

            // Turn update linked effect deleted
            const casterUuid = effect.getFlag("wire", "castingActorUuid");
            if (casterUuid) {
                const caster = fromUuid(casterUuid);
                const effectUuids = caster?.data.flags.wire?.turnUpdatedEffectUuids?.filter(uuid => uuid !== effect.uuid);
                caster.setFlag("wire", "turnUpdatedEffectUuids", effectUuids);
            }

            // Aura deleted
            if (isAuraEffect(effect)) {
                updateAuras();
            }
        }
    });

    Hooks.on("updateActiveEffect", async(effect, changes, options, user) => {
        if (game.user.isGM && changes.disabled !== undefined && isAuraEffect(effect)) {
            updateAuras();
        }
    });

    Hooks.on("deleteMeasuredTemplate", (template, options, user) => {
        if (template.author === game.user) {
            const attachedTokenId = template.getFlag("wire", "attachedTokenId");
            if (attachedTokenId) {
                const token = canvas.tokens.get(attachedTokenId);
                token.document.unsetFlag("wire", "attachedTemplateId");
            }
        }
    });

    Hooks.on("updateToken", async (tokenDoc, change, options, userId) => {
        if (change.x || change.y) {
            const templateId = await tokenDoc.getFlag("wire", "attachedTemplateId");
            const template = canvas.templates.get(templateId);
            if (template && template.document.author === game.user) {
                const update = tokenDoc.object.getCenter(tokenDoc.data.x, tokenDoc.data.y);
                await template.document.update(update);
            }

            if (game.user.isGM) {
                updateAuras(tokenDoc.object);
            }
        }
    });

    let lastKnownRound;
    let lastKnownCombatantId;

    Hooks.on("updateCombat", async (combat, change, options, userId) => {
        if (game.user.isGM && combat.started) {
            if (combat.current.combatantId !== lastKnownCombatantId) {
                await updateCombatTurnEndConditions();
            }

            if (change.round && change.round !== lastKnownRound) {
                ChatMessage.create({
                    content: await renderTemplate("modules/wire/templates/round-change-card.hbs", { round: change.round }),
                    whisper: null,
                    emote: true,
                    speaker: { alias: " " }
                })
            }

            if (combat.current.combatantId !== lastKnownCombatantId) {
                const combatant = combat.combatants.get(combat.current.combatantId);

                if (combatant?.isNPC && !combatant.isDefeated) {
                    combatant.token?.object?.control();
                    canvas.animatePan({ x: combatant.token?._object?.x, y: combatant.token?._object?.y })
                }
    
                if (!combatant.isDefeated) {
                    ChatMessage.create({
                        content: await renderTemplate("modules/wire/templates/turn-change-card.hbs", { token: combatant.token }),
                        whisper: combatant.isNPC ? [game.user.id] : null,
                        emote: true,
                        speaker: { alias: " " }
                    })              
                }
    
                await updateCombatTurnStartConditions();
            }

            lastKnownRound = combat.round;
            lastKnownCombatantId = combat.current.combatantId;
        }
    });

    Hooks.on("ready", () => {
        if (game.modules.get("dae")?.active) {
            DAE.addAutoFields(getWireFlags());
        }
    });

    Hooks.on("getChatLogEntryContext", (html, entryOptions) => {
        entryOptions.push(
            {
                name: "wire.ui.declare-roll-as-damage-targeted",
                icon: '<i class="fas fa-tint"></i>',
                condition: li => {
                    const message = game.messages.get(li.data("messageId"));
                    return message.isRoll && game.user.targets.size > 0;
                },
                callback: li => {
                    const message = game.messages.get(li.data("messageId"));
                    const actors = [...game.user.targets];
                    declareDamage(message.roll, actors);
                }
            },
            {
                name: "wire.ui.declare-roll-as-damage-selected",
                icon: '<i class="fas fa-tint"></i>',
                condition: li => {
                    const message = game.messages.get(li.data("messageId"));
                    return message.isRoll && game.user.targets.size === 0 && canvas.tokens.controlled.length > 0;
                },
                callback: li => {
                    const message = game.messages.get(li.data("messageId"));
                    const actors = canvas.tokens.controlled;
                    declareDamage(message.roll, actors);
                }
            },

            {
                name: "wire.ui.recreate-template",
                icon: '<i class="fas fa-ruler-combined"></i>',
                condition: li => {
                    const message = game.messages.get(li.data("messageId"));
                    const masterEffectUuid = message?.data.flags.wire?.activation?.masterEffectUuid;
                    const effect = fromUuid(masterEffectUuid);
                    if (effect) {
                        const item = fromUuid(effect.data.origin);
                        const template = fromUuid(effect.data.flags.wire?.templateUuid);
                        return item.hasAreaTarget && !template;
                    }
                },
                callback: async li => {
                    const message = game.messages.get(li.data("messageId"));
                    const masterEffectUuid = message?.data.flags.wire?.activation?.masterEffectUuid;
                    const effect = fromUuid(masterEffectUuid);
                    if (effect) {
                        const item = fromUuid(effect.data.origin);
                        const template = fromUuid(effect.data.flags.wire?.templateUuid);
                        if (item.hasAreaTarget && !template) {
                            const templateData = await createTemplate(item, true);
                            if (templateData) {
                                const fullData = foundry.utils.mergeObject(templateData, { "flags.wire.masterEffectUuid": effect.uuid });
                                const results = await game.scenes.current.createEmbeddedDocuments("MeasuredTemplate", [templateData]);
                                const template = results[0];
                                await effect.setFlag("wire", "templateUuid", template.uuid);
                            }
                        }
                    }
                }
            }
        );
    });

    Hooks.on("actorItemHoverIn", async (item, html) => {
        const components = getDisplayableAttackComponents(item, true);
        const target = game.user.targets.first()?.actor;
        const options = getStaticAttackOptions(item, target);
        const mode = options.advantage ? "advantage" : (options.disadvantage ? "disadvantage" : "");

        if (components) {
            const chatForm = $('#chat-form');
            const modeHtml = mode ? `
                <div class="attack-bonus-mode ${mode}">
                    ${i18n(`wire.roll-component.${mode}`)}
                </div>
            ` : "";
            const componentHtml = Object.values(components).map(c => {
                return `
                    <div class="attack-bonus-component">
                        <div class="attack-bonus-value">${c.value}</div>
                        <div class="attack-bonus-label">${i18n(c.i18nKey)}</div>
                    </div>
                `;
            })
            const html = `
                <div id="item-attack-bonuses">
                    ${modeHtml}
                    <div class="attack-bonus-components">
                        ${componentHtml.join("")}
                    </div>
                </div>
            `;

            $('#item-attack-bonuses').remove();
            chatForm.append(html);
        }
    });

    Hooks.on("actorItemHoverOut", (item, html) => {
        $('#item-attack-bonuses').remove();
    });
}

async function declareDamage(roll, tokens) {
    const damage = tokens.map(token => {
        return {
            actor: token.actor,
            token,
            points: { damage: roll.total }
        }
    });

    const pcDamage = damage.filter(d => d.actor.hasPlayerOwner);
    const npcDamage = damage.filter(d => !d.actor.hasPlayerOwner);

    if (pcDamage.length) {
        const pcDamageCard = new DamageCard(true, null, pcDamage);
        await pcDamageCard.make();
    }
    if (npcDamage.length) {
        const npcDamageCard = new DamageCard(false, null, npcDamage);
        await npcDamageCard.make();
    }
}

// Jump some hoops to safely clear linked messages even when clearing the chat log
const requestProcessRemovalQueue = debounce(processRemovalQueue, 100);
let removeQueue = [];

async function removeLinkedMessage(uuid) {
    if (!removeQueue.includes(uuid)) {
        removeQueue.push(uuid);
        requestProcessRemovalQueue();
    }
}

async function processRemovalQueue() {
    for (let uuid of removeQueue) {
        if (uuid) {
            const msg = fromUuid(uuid);
            if (msg) {
                await msg.update({ 'flags.wire': {} });
                await msg.delete();
            }
        }
    }
    removeQueue = [];
}

async function updateAuras() {
    const tokens = canvas.tokens.objects.children;
    const auraSources = tokens.flatMap(token => {
        return token.actor.effects
            .filter(effect => isEffectEnabled(effect) && isAuraEffect(effect))
            .map(effect => {
                return {
                    token, effect
                };
            });
    });
    let auraEffects = tokens.flatMap(token => {
        return token.actor.effects.filter(effect => isAuraTargetEffect(effect))
    });

    for (let source of auraSources) {
        const item = fromUuid(source.effect.data.origin);
        const range = item?.data.data.target?.value;
        const auraToken = source.token;
        const sourceUuid = source.effect.uuid;

        auraEffects = auraEffects.filter(e => e.data.flags.wire?.auraSourceUuid !== sourceUuid)
        
        if (range) {
            const disposition = source.effect.data.flags.wire.auraTargets;
            let targets = [];

            for (let token of tokens) {
                const isInRange = tokenSeparation(auraToken, token) <= range;
                const existingEffect = token.actor.effects.find(effect => effect.data.origin === source.effect.data.origin)

                if (!isInRange && existingEffect) {
                    await existingEffect.delete();
                } else if (isInRange && !existingEffect) {
                    let dispositionCheck = false;
                    if (disposition === "ally" && areAllied(auraToken.actor, token.actor)) { dispositionCheck = true; }
                    else if (disposition === "enemy" && areEnemies(auraToken.actor, token.actor)) { dispositionCheck = true; }
                    else if (disposition === "creature") { dispositionCheck = true; }

                    if (dispositionCheck) {
                        targets.push(token.actor);
                    }
                }
            }

            if (targets.length) {
                const masterEffectUuid = source.effect.data.flags.wire?.masterEffectUuid;
                const masterEffect = masterEffectUuid ? fromUuid(masterEffectUuid) : null;
                const extraData = {
                    "flags.wire.auraSourceUuid": source.effect.uuid
                }
                await applySingleEffect(source.effect, targets, masterEffect, {}, extraData);
            }
        }
    }

    for (let effect of auraEffects) {
        await effect.delete();
    }
}
