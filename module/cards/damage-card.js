import { wireSocket } from "../socket.js";
import { fromUuid, fudgeToActor, getActorToken, getSpeaker } from "../utils.js";

export class DamageCard {

    static templateName = "modules/wire/templates/damage-card.hbs";

    static activateListeners(html) {
        html.on("click", ".damage-card a", this._onDamageCardAction.bind(this));
    }

    static async _onDamageCardAction(event) {
        event.preventDefault();

        // Extract card data
        const button = event.currentTarget;
        button.disabled = true;
        const card = button.closest(".chat-card");
        const messageId = card.closest(".message").dataset.messageId;
        const message = game.messages.get(messageId);
        const action = button.dataset.action;
        const targets = message.getFlag("wire", "targets");
        const targetUuid = button.closest('.damage-card-target').dataset.actorUuid;
        const damage = targets.find(t => t.actorUuid === targetUuid);
        const actor = fudgeToActor(fromUuid(damage.actorUuid));

        switch (action) {
            case "apply-damage":
                if (game.user.isGM || actor.isOwner) {
                    await actor.update({
                        'data.attributes.hp.value': damage.info.newHp,
                        'data.attributes.hp.temp': damage.info.newTempHp
                    }, { 
                        dhp: (damage.info.hpDmg + damage.info.tempHpDmg > 0) ? -(damage.info.hpDmg + damage.info.tempHpDmg) : damage.info.hpHeal + damage.info.tempHpRaise
                    });
                }
                break;
            case "undo-damage":
                if (game.user.isGM || actor.isOwner) {
                    await actor.update({
                        'data.attributes.hp.value': damage.info.hp,
                        'data.attributes.hp.temp': damage.info.tempHp
                    }, {
                        dhp: (damage.info.hpDmg + damage.info.tempHpDmg > 0) ? (damage.info.hpDmg + damage.info.tempHpDmg) : -(damage.info.hpHeal + damage.info.tempHpRaise)
                    });
                }
                break;
            }

        button.disabled = false;
    }

    static async makeForActor(causingActor, targetActor, damageAmount) {
        const damage = {
            actor: targetActor,
            token: getActorToken(targetActor),
            points: { damage: damageAmount }
        };
        const card = new DamageCard(targetActor.hasPlayerOwner, causingActor, [damage]);
        await card.make();
    }

    constructor(isPlayer, actor, targetDamage) {
        this.isPlayer = isPlayer;
        this.actor = actor;
        this.targetDamage = targetDamage;
    }

    async make() {
        if (!this.isPlayer && !game.user.isGM) {
            await wireSocket.executeAsGM("createDamageCard", this.isPlayer, this.actor?.uuid, this.targetDamage.map(td => {
                return {
                    actorUuid: td.actor.uuid,
                    tokenUuid: td.token.document.uuid,
                    points: td.points
                }
            }));
            return;
        }

        const flagData = await this._getFlagData();
        const content = await this._renderContent();
        const speaker = getSpeaker(this.actor)

        const messageData = foundry.utils.mergeObject(
            {
                content,
                speaker,
                'flags.wire': flagData
            },
            this.isPlayer ? {} : {
                user: game.user.id,
                whisper: [game.user.id]
            }
        );
        const message = await ChatMessage.create(messageData);
    }

    async _getFlagData() {
        return {
            targets: this.targetDamage.map(t => {
                return {
                    actorUuid: t.actor.uuid,
                    tokenUuid: t.token.uuid,
                    info: this._getActorInfo(t.actor, t.points)
                }
            })
        };
    }

    async _renderContent() {
        const templateData = {
            isGM: !this.isPlayer,
            targets: this.targetDamage.map(t => {
                return {
                    actor: t.actor,
                    token: t.token,
                    info: this._getActorInfo(t.actor, t.points)
                }
            })
        };
        return await renderTemplate(DamageCard.templateName, templateData);
    }

    _getActorInfo(actor, points) {
        const dmg = points.damage || 0;
        const healing = points.healing || 0;
        const tempHpReceived = points.temphp || 0;
        const di = points.di || 0;
        const dr = points.dr || 0;
        const dv = points.dv || 0;

        const hp = actor.data.data.attributes.hp.value;
        const effectiveMaxHp = actor.data.data.attributes.hp.max + actor.data.data.attributes.hp.tempmax;
        const tempHp = actor.data.data.attributes.hp.temp || 0;
        const newTempHp = Math.max(0, tempHp - dmg, tempHpReceived);
        const newHp = Math.min(Math.max(0, Math.min(hp + tempHp - dmg, hp)) + healing, effectiveMaxHp);
        const hpDmg = Math.max(hp - newHp, 0);
        const tempHpDmg = Math.max(tempHp - newTempHp, 0);
        const hpHeal = Math.max(newHp - hp, 0);
        const tempHpRaise = Math.max(newTempHp - tempHp, 0);

        return { hpDmg, tempHpDmg, hpHeal, tempHpRaise, hp, tempHp, newHp, newTempHp, di, dr, dv };
    }

}