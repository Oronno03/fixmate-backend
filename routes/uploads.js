import express from "express";
import { verifyToken } from "../middleware/auth.js";
import { asyncHandler } from "../middleware/error.js";
import { uploadSchema } from "../config/validator.js";

/**
 * @param {import("mongodb").Db} db
 */
export default function uploadRoutes(db) {
  const router = express.Router();

  router.post(
    "/",
    verifyToken(db),
    asyncHandler(async (req, res) => {
      if (!process.env.IMGBB_API_KEY) {
        return res
          .status(503)
          .json({ message: "Image upload is not configured on the server." });
      }

      const parsed = uploadSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          message: "Invalid image data.",
          issues: parsed.error.issues,
        });
      }

      const base64 = parsed.data.image.replace(
        /^data:image\/[a-zA-Z0-9.+-]+;base64,/,
        "",
      );

      // Base64 is roughly 4/3 the size of the binary image.
      if (base64.length > 7 * 1024 * 1024) {
        return res
          .status(413)
          .json({ message: "Image is too large. Maximum size is 5 MB." });
      }

      const form = new FormData();
      form.append("image", base64);
      if (parsed.data.name) form.append("name", parsed.data.name);

      const response = await fetch(
        `https://api.imgbb.com/1/upload?key=${process.env.IMGBB_API_KEY}`,
        { method: "POST", body: form },
      );

      const result = await response.json();

      if (!response.ok || !result.success) {
        return res.status(502).json({
          message: "Image upload failed.",
          error: result?.error?.message,
        });
      }

      return res.status(200).json({
        data: {
          url: result.data.display_url || result.data.url,
          deleteUrl: result.data.delete_url,
        },
        message: "Image uploaded.",
      });
    }),
  );

  return router;
}
