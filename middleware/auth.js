import { ObjectId } from "mongodb";
import { createRemoteJWKSet, jwtVerify } from "jose";

const clientUrl = (process.env.CLIENT_URL || "http://localhost:3000").split(",")[0].trim();
const jwksUrl =
  process.env.JWT_JWKS_URL || `${clientUrl}/api/auth/jwks`;

let jwks = null;

function getJwks() {
  if (!jwks) {
    jwks = createRemoteJWKSet(new URL(jwksUrl));
  }
  return jwks;
}

/**
 * Resolves a bearer token to a user. Supports both:
 *  - BetterAuth JWTs (the preferred path)
 *  - BetterAuth opaque session tokens (kept as a fallback for local scripts)
 *
 * @param {import("mongodb").Db} db
 * @param {string} token
 */
async function resolveUser(db, token) {
  if (token.split(".").length === 3) {
    try {
      const { payload } = await jwtVerify(token, getJwks());
      if (!payload.sub || !ObjectId.isValid(payload.sub)) return null;
      return await db
        .collection("user")
        .findOne({ _id: new ObjectId(payload.sub) });
    } catch {
      return null;
    }
  }

  const session = await db.collection("session").findOne({ token });
  if (!session) return null;

  const expiresAt = session.expiresAt ? new Date(session.expiresAt) : null;
  if (expiresAt && expiresAt.getTime() <= Date.now()) return null;

  if (!session.userId || !ObjectId.isValid(session.userId)) return null;
  return await db
    .collection("user")
    .findOne({ _id: new ObjectId(session.userId) });
}

/**
 * @param {import("mongodb").Db} db
 */
export const verifyToken =
  (db) =>
  /**
   * @param {import("express").Request} req
   * @param {import("express").Response} res
   * @param {import("express").NextFunction} next
   */
  async (req, res, next) => {
    const authorization = req.headers.authorization || "";
    const bearer = authorization.startsWith("Bearer ")
      ? authorization.slice("Bearer ".length).trim()
      : "";
    const legacyToken = req.headers.token;
    const token = bearer || (typeof legacyToken === "string" ? legacyToken : "");

    if (!token) {
      return res.status(401).json({ message: "Authentication required." });
    }

    try {
      const user = await resolveUser(db, token);
      if (!user) {
        return res.status(401).json({ message: "Invalid or expired token." });
      }
      req.user = user;
      return next();
    } catch (error) {
      return next(error);
    }
  };

/**
 * @param {"customer" | "technician" | "admin"} role
 */
export const verifyRole = (role) => (req, res, next) => {
  if (req.user?.role !== role) {
    return res.status(403).json({
      message: `${role.charAt(0).toUpperCase() + role.slice(1)} access required.`,
    });
  }
  next();
};

export const verifyCustomer = verifyRole("customer");
export const verifyTechnician = verifyRole("technician");
export const verifyAdmin = verifyRole("admin");

// Backwards-compatible alias for older imports.
export const verifySession = verifyToken;
