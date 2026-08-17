const DEFAULT_PROVIDER_CAPABILITIES = Object.freeze({
  max_reference_images: 6,
  supports_mask: false,
  supports_control_image: false,
  supports_region_prompts: false,
  supports_inpaint: false,
  supports_multiple_image_roles: false
});

function providerCapabilities(input = {}) {
  const limit = Number(input.max_reference_images);
  return {
    ...DEFAULT_PROVIDER_CAPABILITIES,
    ...input,
    max_reference_images: Number.isInteger(limit) && limit > 0 ? limit : DEFAULT_PROVIDER_CAPABILITIES.max_reference_images
  };
}

module.exports = { DEFAULT_PROVIDER_CAPABILITIES, providerCapabilities };

