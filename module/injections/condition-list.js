import { i18n } from "../utils.js";

const conditionList = [
    ["creature-enters-area", "all"],
    ["creature-starts-turn-inside-area", "all"],
    ["creature-ends-turn-inside-area", "all"],
    ["ally-enters-area", "all"],
    ["ally-starts-turn-inside-area", "all"],
    ["ally-ends-turn-inside-area", "all"],
    ["enemy-enters-area", "all"],
    ["enemy-starts-turn-inside-area", "all"],
    ["enemy-ends-turn-inside-area", "all"],
    ["area-envelops-creature", "all"],
    ["area-envelops-ally", "all"],
    ["area-envelops-enemy", "all"],
    ["area-reveals-creature", "all"],
    ["area-reveals-ally", "all"],
    ["area-reveals-enemy", "all"],
    ["start-of-turn-caster", "all"],
    ["end-of-turn-caster", "all"],
    ["start-of-turn-target", "effect"],
    ["end-of-turn-target", "effect"],
    ["target-attacks.all", "all"],
    ["target-attacks.mwak", "all"],
    ["target-attacks.rwak", "all"],
    ["target-attacks.msak", "all"],
    ["target-attacks.rsak", "all"],
    ["target-hits.all", "all"],
    ["target-hits.mwak", "all"],
    ["target-hits.rwak", "all"],
    ["target-hits.msak", "all"],
    ["target-hits.rsak", "all"],
    ["target-is-attacked.all", "all"],
    ["target-is-attacked.mwak", "all"],
    ["target-is-attacked.rwak", "all"],
    ["target-is-attacked.msak", "all"],
    ["target-is-attacked.rsak", "all"],
    ["target-is-hit.all", "all"],
    ["target-is-hit.mwak", "all"],
    ["target-is-hit.rwak", "all"],
    ["target-is-hit.msak", "all"],
    ["target-is-hit.rsak", "all"],
    ["take-an-action", "all"]
];

const updateList = [
    ["apply-delayed", ["all"]],
    ["apply-overtime", ["all"]],
    ["apply-effects-immediate", ["all"]],
    ["apply-effects-delayed", ["all"]],
    ["apply-effects-overtime", ["all"]],
    ["end", ["all"]],
    ["end-on-save", ["all"]],
    ["splash-delayed", ["all"]]
]

export async function injectConditionList(object, html, containerSelector, conditionType) {
    const selected = (value, fieldValue) => { return value === fieldValue ? "selected" : "" };

    let conditions = object.getFlag("wire", "conditions") || [];
    if (!Array.isArray(conditions)) {
        conditions = [];
        object.setFlag("wire", "conditions", []);
    }
    const conditionsHtml = conditions?.map((condition, i) => {
        const bits = [];
        bits.push(`
            <li class="flexrow condition-part condition" data-condition="${i}">
                <select name="flags.wire.conditions.${i}.condition">
                    <option value=""></option>
        `);
        bits.push(conditionList.filter(c => ["all", conditionType].includes(c[1])).map(c => `
                    <option value="${c[0]}" ${selected(condition.condition, c[0])}>${i18n("wire.item.condition-" + c[0])}</option>`).join(""));
        bits.push(`
                </select>
                <select name="flags.wire.conditions.${i}.update">
                    <option value=""></option>
        `);
        bits.push(updateList.map(u => `
                    <option value="${u[0]}" ${selected(condition.update, u[0])}>${i18n("wire.item.update-" + u[0])}</option>`).join(""));
        bits.push(`
                </select>
                <input type="text" />
                <a class="condition-control delete-condition"><i class="fas fa-minus"></i></a>
            </li>
        `);

        return bits.join("");
    }).join("");

    const fields = `
        <h3 class="form-header">${i18n("wire.item.activation-header")}</h3>
        <h4 class="condition-header">
            ${i18n("wire.item.conditions-and-effects")}
            <a class="condition-control add-condition"><i class="fas fa-plus"></i></a>
        </h4>
        <ol class="condition-parts form-group">
            ${conditionsHtml}
        </ol>
    `;
    html.find(containerSelector).append(fields);

    html.find('.add-condition').click(async (event) => {
        const conditions = object.getFlag("wire", "conditions") || [];
        conditions.push({});
        await object.setFlag("wire", "conditions", conditions);
    });
    html.find('.delete-condition').click(async (event) => {
        const i = event.target.closest('.condition').dataset.condition;
        const conditions = object.getFlag("wire", "conditions") || [];
        conditions.splice(i, 1);
        await object.setFlag("wire", "conditions", conditions);
    });
}
