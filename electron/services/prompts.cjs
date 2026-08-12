function commonEnvelope(id) {
  return `All output must be one JSON object with these exact common fields:\n` +
    `"schema_version":"1.0", "id":"${id}", "version":1, "status":"generated", "source":{}.\n` +
    `Do not wrap JSON in markdown and do not add commentary outside JSON. ` +
    `Keep JSON keys in English, but write every human-readable value in Simplified Chinese.`;
}

function canvasInstruction(project) {
  const spec = project.canvas_spec || { width: 1920, height: 1080, orientation: 'landscape', aspect_ratio: '16:9', generation_size: '1536x864' };
  return `Target canvas is ${spec.width}x${spec.height}, ${spec.orientation}, aspect ratio ${spec.aspect_ratio}. ` +
    `This canvas orientation and aspect ratio are hard constraints. Never rotate, crop into another ratio, or replace it with a desktop/landscape layout.`;
}

function screenContractPrompt(project) {
  return `${commonEnvelope(`${project.screen_id}-screen-contract`)}\n\n` +
    `You are a senior game UX designer. Interpret planning requirements and the attached UE wireframe. ` +
    `The wireframe is the functional source of truth, not the visual source of truth. Do not treat its positions, proportions or sizes as final visual constraints.\n\n` +
    `Project name: ${project.name}\nProject type: ${project.project_type}\nArt direction: ${project.art_direction || 'not decided'}\n` +
    `${canvasInstruction(project)}\n` +
    `Planning requirement:\n${project.requirement}\n\n` +
    `Return exactly these additional fields: ` +
    `"screen_id", "screen_name", "purpose", "primary_action", ` +
    `"secondary_actions" string[], "required_information" string[], "required_controls" string[], ` +
    `"states" string[], "edge_cases" string[], "data_dependencies" string[], ` +
    `"design_constraints":{"function_positions_fixed":false,"element_scale_fixed":false,"ue_proportion_fixed":false,"functionality_fixed":true}, ` +
    `"source_inventory":{"requirement_functions" string[],"wireframe_controls" string[],"wireframe_information" string[]}, ` +
    `"coverage":{"covered_items" string[],"uncovered_items":[]}, "designer_summary" string. ` +
    `First inventory every function, control and information item from both sources. Then make required_controls and required_information supersets of that inventory. ` +
    `Do not omit utility actions such as back, save, clear, filter, batch actions or global navigation. uncovered_items must be empty only after every source item is represented.`;
}

function intentDraftPrompt(project) {
  return `You are a senior game UX designer. Read the attached UE wireframe before the user writes a planning brief.\n` +
    `Infer only what the screen visibly supports. Do not invent numerical rules, economy values or hidden business logic.\n` +
    `Project name: ${project.name}\nProject type: ${project.project_type}\nArt direction: ${project.art_direction || 'not decided'}\n` +
    `${canvasInstruction(project)}\n` +
    `Return one JSON object with exactly these fields: ` +
    `"requirement_draft" string, "inferred_page_type" string, "inferred_rules" string[], "uncertainties" string[]. ` +
    `Write requirement_draft in concise Simplified Chinese as an editable design-intent brief. It should cover the page purpose, player task, core flow, visible controls/information and important visible states. ` +
    `Mark genuinely unknown hidden rules as needing designer confirmation instead of guessing. Do not add markdown or commentary outside JSON.`;
}

function layoutPrompt(project, screenContract) {
  return `${commonEnvelope(`${project.screen_id}-layout-proposals`)}\n\n` +
    `You are a principal game UI/UX layout designer. Produce three meaningfully different layout proposals while preserving the functional contract. ` +
    `One should prioritize information efficiency, one visual impact, and one balance.\n\n` +
    `${canvasInstruction(project)} The region structure must be feasible inside this exact canvas.\n` +
    `Screen contract:\n${JSON.stringify(screenContract)}\n\n` +
    `Return "screen_id", "canvas_spec":${JSON.stringify(project.canvas_spec || {})} and "proposals" with exactly three objects. Each proposal needs: ` +
    `id, name, strategy, designer_fit, visual_hierarchy string[], regions object whose values have label and recommended_ratio number, ` +
    `interaction_flow string[], tradeoffs string[], and rationale array of {change,reason,impact}. ` +
    `Recommended ratios are directional and should total approximately 1.0. Include "designer_summary". ` +
    `Every option must use a genuinely different region structure and interaction flow, not merely different wording.`;
}

function stylePrompt(project, approvedLayout) {
  const branch = project.project_type === 'existing'
    ? `Reconstruct the existing project's stable visual language from the attached approved reference pages. Do not invent a different art direction.`
    : `Resolve a production-ready visual direction for a new project from the broad art direction and attached inspiration references.`;
  return `${commonEnvelope(`${project.id}-style-contract`)}\n\n` +
    `You are a game UI art director. ${branch}\n` +
    `Project art direction: ${project.art_direction || 'derive from requirements and references'}\n` +
    `${canvasInstruction(project)}\n` +
    `Reference roles in attachment order:\n${JSON.stringify((project.reference_assets || []).map(({ name, role }) => ({ name, role })))}\n` +
    `Approved layout:\n${JSON.stringify(approvedLayout)}\n\n` +
    `Return: "style_id", "visual_identity":{"theme","mood" string[],"keywords" string[]}, ` +
    `"colors" object with semantic color roles, "typography" object, "materials" string[], "lighting" object, ` +
    `"geometry" object, "components" object covering button/icon/card/panel/modal/navigation and selected/disabled/reward/warning states, ` +
    `"composition" object with information_density/main_visual_priority/decoration_density/spacing, ` +
    `"reference_ids" string[], "negative_style_constraints" string[], "designer_summary" string. ` +
    `Descriptions must be concrete enough to reproduce across multiple screens.`;
}

function visualTask(project, approvedLayout, styleContract, variation, feedback = '') {
  const strategies = {
    conservative: 'Conservative inheritance: strict grid, restrained decoration, familiar component shapes, highest readability and production feasibility.',
    expressive: 'Expressive enhancement: dramatically stronger character focal area, layered depth, bolder hierarchy, motion-ready accents and presentation impact while staying inside the style lock.',
    innovative: 'Controlled local innovation: introduce one unmistakable new local interaction or information treatment, asymmetric rhythm and a clearly different silhouette without changing the approved functional regions.',
    balanced: 'Balanced production direction: clarity, appeal and feasibility in equal measure.'
  };
  const prompt = [
    `Create a polished game UI visual exploration for ${project.name}.`,
    `Variation strategy: ${strategies[variation] || strategies.balanced}`,
    `Approved layout: ${JSON.stringify(approvedLayout)}`,
    `Approved style contract: ${JSON.stringify(styleContract)}`,
    canvasInstruction(project),
    `Render at the provider target size ${project.canvas_spec?.generation_size || '1536x864'} while preserving aspect ratio ${project.canvas_spec?.aspect_ratio || '16:9'}.`,
    approvedLayout.manual_adjustments?.length ? `Mandatory designer adjustments, higher priority than the proposal text: ${approvedLayout.manual_adjustments.join('；')}` : '',
    feedback ? `Designer feedback from the previous round: ${feedback}` : '',
    `Must preserve every required control and the primary action hierarchy.`,
    `Render one complete production-quality interface screen filling the exact target canvas. All visible UI copy must be Simplified Chinese, with legible typography, coherent spacing and consistent reusable components.`,
    `Make this variation visually distinguishable from the other strategies through composition, hierarchy and component treatment, not only color.`,
    `Do not add unrelated navigation, do not remove required information, do not change the screen's core interaction, and do not drift outside the locked visual language.`
  ].filter(Boolean).join('\n');
  return {
    schema_version: '1.0',
    id: `${project.screen_id}-${variation}-visual-task`,
    version: 1,
    status: 'approved',
    source: {
      approved_layout: approvedLayout.id,
      style_contract: styleContract.id
    },
    task_id: `${project.screen_id}-${variation}-v1`,
    screen_id: project.screen_id,
    variation_strategy: variation,
    must_include: approvedLayout.required_controls || [],
    must_preserve: ['primary action hierarchy', 'approved layout regions', 'project component language'],
    negative_constraints: styleContract.negative_style_constraints || [],
    canvas_spec: project.canvas_spec,
    manual_adjustments: approvedLayout.manual_adjustments || [],
    prompt
  };
}

module.exports = { intentDraftPrompt, layoutPrompt, screenContractPrompt, stylePrompt, visualTask };
