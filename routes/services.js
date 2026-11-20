import express from "express";
import { approvalStatusSchema, servicesSchema } from "../config/validator.js";
import z from "zod";
import { Db, ObjectId } from "mongodb";
import {
  verifyAdmin,
  verifySession,
  verifyTechnician,
} from "../middleware/auth.js";

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
      const { title, category, minPrice, maxPrice, sort } = req.query;
      const query = { approvalStatus: "approved" };

      if (title) {
        query.title = {
          $regex: title,
          $options: "i",
        };
      }

      if (category) {
        query.category = category;
      }

      if (minPrice || maxPrice) {
        query.basePrice = {};

        if (minPrice) {
          query.basePrice.$gte = Number(minPrice);
        }
        if (maxPrice) {
          query.basePrice.$lte = Number(maxPrice);
        }
      }

      // Sorting
      let sortOption = {};

      if (sort === "price_asc") {
        sortOption.basePrice = 1;
      } else if (sort === "price_desc") {
        sortOption.basePrice = -1;
      } else if (sort === "name_asc") {
        sortOption.title = 1;
      } else if (sort === "name_desc") {
        sortOption.title = -1;
      } else {
        sortOption.createdAt = -1;
      }

      const result = await services.find(query).sort(sortOption).toArray();
      return res.status(200).send(result);
    } catch (error) {
      console.error(error);
      return res.status(500).send({
        message: "Failed to fetch services.",
      });
    }
  });

  router.get("/admin", verifySession(db), verifyAdmin, async (req, res) => {
    try {
      const result = await services.find().toArray();
      return res.status(200).send(result);
    } catch (error) {
      console.error(error);
      return res.status(500).send({
        message: "Failed to fetch services.",
      });
    }
  });

  router.post("/", verifySession(db), verifyTechnician, async (req, res) => {
    const body = await req.body;

    try {
      const serviceData = servicesSchema.parse(body);
      const response = await services.insertOne({
        ...serviceData,
        technicianName: req.user.name,
        technicianEmail: req.user.email,
        approvalStatus: "pending",
        isAvailable: true,
        createdAt: new Date(),
      });
      res.status(200).json(response);
    } catch (error) {
      if (error instanceof z.ZodError) {
        console.dir("Invalid data", error);
        res.status(400).json({ message: "Invalid Data", error: error });
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

  router.patch(
    "/:id",
    verifySession(db),
    verifyTechnician,
    async (req, res) => {
      const id = req.params.id;
      const body = req.body;

      try {
        const data = servicesSchema.safeParse(body);

        const service = await services.findOne({ _id: new ObjectId(id) });

        if (!service) {
          return res.status(404).json({
            message: "No service found with that id.",
          });
        }

        if (service.technicianEmail !== req.user.email) {
          return res
            .status(403)
            .json({ message: "You don't own this service." });
        }

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
            error: err,
          });
        }

        console.error(err);

        return res.status(500).json({
          message: "Failed to update service.",
          error: err,
        });
      }
    },
  );

  router.delete(
    "/:id",
    verifySession(db),
    verifyTechnician,
    async (req, res) => {
      const id = req.params.id;

      try {
        const service = await services.findOne({ _id: new ObjectId(id) });

        if (!service) {
          return res.status(404).json({
            message: "No service found with that id.",
          });
        }

        if (service.technicianEmail !== req.user.email) {
          return res
            .status(403)
            .json({ message: "You don't own this service." });
        }

        const deleted = await services.findOneAndDelete({
          _id: new ObjectId(id),
        });
        if (!deleted) {
          return res.status(400).json({ message: "Invalid ID" });
        }
        return res
          .status(200)
          .json({ message: "Successfully deleted the service." });
      } catch (err) {
        return res
          .status(500)
          .json({ message: "An error occurred", error: err });
      }
    },
  );

  router.patch(
    "/:id/status",
    verifySession(db),
    verifyAdmin,
    async (req, res) => {
      const id = req.params.id;
      const body = req.body;
      try {
        if (!body.approvalStatus) {
          return res
            .status(400)
            .json({ message: "Approval status not provided" });
        }

        const result = approvalStatusSchema.parse(body.approvalStatus);

        const updated = await services.findOneAndUpdate(
          { _id: new ObjectId(id) },
          {
            $set: {
              approvalStatus: result,
            },
          },
          {
            returnDocument: "after",
          },
        );

        if (!updated) {
          throw Error("Could not update the service status");
        }

        return res.status(200).json({
          message: "Successfully updated the service status",
          service: updated,
        });
      } catch (err) {
        return res
          .status(500)
          .json({ message: "An error occurred.", error: err });
      }
    },
  );

  return router;
}
