// Display helpers for trusted contacts.
//
// The dashboard must show contacts exactly as /api/contacts returned them.
// These helpers only ever *neutralise a missing value* — they never substitute
// an invented identity, phone number, relation, verification state or
// notification/delivery status.
//
// Kept free of React and Mongoose so tests can exercise malformed input
// directly (the same pattern as services/locationFix.js).

// Used only when the API returned a contact with no usable name.
export const UNNAMED_CONTACT = 'Unnamed contact';

// Avatar glyph when there is no name to take an initial from.
export const NEUTRAL_INITIAL = '?';

/** Trim a value only if it really is a string; anything else becomes ''. */
function cleanString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

/** True only when the API supplied a non-blank name. */
export function hasRealName(contact) {
  return cleanString(contact && contact.name).length > 0;
}

/**
 * The contact's real name, or the neutral fallback when (and only when) the
 * name is genuinely missing/blank/non-string. Never derived from the index,
 * phone number or relation.
 */
export function contactDisplayName(contact) {
  return cleanString(contact && contact.name) || UNNAMED_CONTACT;
}

/** First letter of the real name, or a neutral glyph. Never index-derived. */
export function contactInitial(contact) {
  const name = cleanString(contact && contact.name);
  return name ? name.charAt(0).toUpperCase() : NEUTRAL_INITIAL;
}

/**
 * Status line built purely from real fields.
 *
 *   relation  — the label the user saved (e.g. "Mother"); omitted if absent
 *   "Active"  — guaranteed true because /api/contacts filters isActive: true
 *
 * No delivery, notification or verification claim is ever produced here: KAVACH
 * has no configured notification provider, so it must not say a contact will be
 * alerted.
 */
export function contactStatusLine(contact) {
  const relation = cleanString(contact && contact.relation);
  return relation ? `${relation} • Active` : 'Active';
}
