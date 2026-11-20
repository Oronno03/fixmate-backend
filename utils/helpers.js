import { ObjectId } from "mongodb";

/**
 * @param {unknown} id
 * @returns {ObjectId | null}
 */
export function toObjectId(id) {
  if (typeof id !== "string" || !ObjectId.isValid(id)) return null;
  return new ObjectId(id);
}

/**
 * Removes any credential-like fields before a user document is sent to the
 * client. BetterAuth keeps credentials in the `account` collection, but this
 * keeps the API defensive.
 *
 * @param {Record<string, unknown> | null} user
 */
export function sanitizeUser(user) {
  if (!user) return null;
  const { password, ...safe } = user;
  return safe;
}

/**
 * Escapes a string so it can safely be embedded in a MongoDB `$regex`.
 *
 * @param {string} value
 */
export function escapeRegex(value = "") {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * @param {string | undefined} value
 * @returns {Date | null}
 */
export function parseDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}
