// Versioned semantic policy mapping Screen Control roles to Component Family
// categories, required component states, and allowed font roles (REM-01).
// The backend is the source of truth; the frontend keeps a UX-only mirror.
const BINDING_POLICY_VERSION = 'binding-policy-v1';

const CONTROL_ROLE_POLICIES = Object.freeze({
  'primary-action': Object.freeze({
    allowed_categories: Object.freeze(['button']),
    required_states: Object.freeze(['default', 'pressed', 'disabled']),
    allowed_font_roles: Object.freeze(['button-label'])
  }),
  'secondary-action': Object.freeze({
    allowed_categories: Object.freeze(['button']),
    required_states: Object.freeze(['default', 'disabled']),
    allowed_font_roles: Object.freeze(['button-label'])
  }),
  // Legacy default role emitted by normalizeControls for controls without an
  // explicit role; kept broad so existing projects are not fail-closed, but
  // category compatibility is still enforced.
  action: Object.freeze({
    allowed_categories: Object.freeze(['button', 'navigation', 'tab', 'icon']),
    required_states: Object.freeze(['default']),
    allowed_font_roles: Object.freeze(['button-label', 'navigation-label', 'tab-label', 'body', 'caption', 'numeric'])
  }),
  navigation: Object.freeze({
    allowed_categories: Object.freeze(['navigation']),
    required_states: Object.freeze(['default', 'selected', 'disabled']),
    allowed_font_roles: Object.freeze(['navigation-label'])
  }),
  tab: Object.freeze({
    allowed_categories: Object.freeze(['tab']),
    required_states: Object.freeze(['default', 'selected', 'disabled']),
    allowed_font_roles: Object.freeze(['tab-label'])
  }),
  resource: Object.freeze({
    allowed_categories: Object.freeze(['resource-bar']),
    required_states: Object.freeze(['default']),
    allowed_font_roles: Object.freeze(['numeric', 'body'])
  }),
  'icon-action': Object.freeze({
    allowed_categories: Object.freeze(['icon']),
    required_states: Object.freeze(['default']),
    allowed_font_roles: Object.freeze([])
  }),
  'status-badge': Object.freeze({
    allowed_categories: Object.freeze(['status-badge', 'page-specific']),
    required_states: Object.freeze(['default']),
    allowed_font_roles: Object.freeze(['caption', 'numeric'])
  }),
  'list-row': Object.freeze({
    allowed_categories: Object.freeze(['list-row', 'page-specific']),
    required_states: Object.freeze(['default']),
    allowed_font_roles: Object.freeze(['body'])
  }),
  'content-panel': Object.freeze({
    allowed_categories: Object.freeze(['content-panel', 'page-specific']),
    required_states: Object.freeze(['default']),
    allowed_font_roles: Object.freeze([])
  })
});

function rolePolicy(role) {
  return CONTROL_ROLE_POLICIES[String(role || '')] || null;
}

module.exports = { BINDING_POLICY_VERSION, CONTROL_ROLE_POLICIES, rolePolicy };
