import express from "express";
import { servicesSchema } from "../config/validator.js";
import z from "zod";
import { Db, ObjectId } from "mongodb";
import { verifySession } from "../middleware/auth.js";

/**
 *
 * @param {Db} db
 * @returns
 */
export default function serviceRoutes(db) {
  const router = express.Router();
  const services = db.collection("services");

  router.get("/", async (req, res) => {
    try {
      const result = await services
        .find({ approvalStatus: "approved" })
        .toArray();
      return res.status(200).send(result);
    } catch (error) {
      console.error(error);
      return res.status(500).send({
        message: "Failed to fetch services.",
      });
    }
  });

  router.post("/", verifySession(db), async (req, res) => {
    const body = await req.body;

    try {
      const serviceData = servicesSchema.parse(body);
      const response = await services.insertOne({
        ...serviceData,
        technicianName: req.user.name,
        technicianEmail: req.user.email,
        technicianId: req.user._id,
        approvalStatus: "pending",
        isAvailable: true,
        createdAt: new Date(),
      });
      res.status(200).json(response);
    } catch (error) {
      if (error instanceof z.ZodError) {
        console.dir("Invalid data", error);
        res.status(400).json("Invalid Data");
      } else {
        console.dir("Unexpected error", error);
      }
    }
  });

  router.get("/:id", async (req, res) => {
    const id = req.params.id;

    try {
      const found = await services.findOne({
        _id: new ObjectId(id),
      });

      if (!found) {
        return res.status(404).json({
          message: "Invalid ID. No service found.",
        });
      }

      return res.status(200).json(found);
    } catch (err) {
      console.error(err);

      return res.status(400).json({
        message: "Invalid service ID.",
      });
    }
  });

  router.patch("/:id", async (req, res) => {
    const id = req.params.id;
    const body = req.body;

    try {
      const data = servicesSchema.parse(body);

      const updated = await services.findOneAndUpdate(
        {
          _id: new ObjectId(id),
        },
        {
          $set: {
            ...data,
          },
        },
        {
          returnDocument: "after",
        },
      );

      if (!updated) {
        return res.status(404).json({
          message: "Invalid ID. No service found.",
        });
      }

      return res.status(200).json({
        message: "Service updated successfully.",
        service: updated,
      });
    } catch (err) {
      if (err instanceof z.ZodError) {
        console.dir(err);

        return res.status(400).json({
          message: "Invalid data.",
        });
      }

      console.error(err);

      return res.status(500).json({
        message: "Failed to update service.",
      });
    }
  });

  router.delete("/:id", async (req, res) => {
    const id = req.params.id;

    try {
      const deleted = await services.findOneAndDelete({
        _id: new ObjectId(id),
      });
      if (!deleted) {
        return res.status(400).json({message: "Invalid ID"});
      }
      return res
        .status(200)
        .json({ message: "Successfully deleted the service." });
    } catch (err) {
      return res.status(400).json({message: "Invalid ID"});
    }
  });

  return router;
}
