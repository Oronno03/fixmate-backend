import express from "express";
import { verifyToken } from "../middleware/auth.js";
import { asyncHandler } from "../middleware/error.js";
import { profileUpdateSchema } from "../config/validator.js";
import { sanitizeUser } from "../utils/helpers.js";

/**
 * @param {import("mongodb").Db} db
 */
export default function userRoutes(db) {
  const router = express.Router();
  const users = db.collection("user");

  router.get(
    "/me",
    verifyToken(db),
    asyncHandler(async (req, res) => {
      return res.status(200).json({ data: sanitizeUser(req.user) });
    }),
  );

  router.patch(
    "/profile",
    verifyToken(db),
    asyncHandler(async (req, res) => {
      const parsed = profileUpdateSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          message: "Invalid profile data.",
          issues: parsed.error.issues,
        });
      }

      const updated = await users.findOneAndUpdate(
        { _id: req.user._id },
        { $set: { ...parsed.data, updatedAt: new Date() } },
        { returnDocument: "after" },
      );

      if (!updated) {
        return res.status(404).json({ message: "User not found." });
      }

      return res.status(200).json({
        data: sanitizeUser(updated),
        message: "Profile updated.",
      });
    }),
  );

  return router;
}
