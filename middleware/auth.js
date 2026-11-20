import { Collection, ObjectId } from "mongodb";

export const verifySession =
  (db) =>
  /**
   *
   * @param {import("express").Request} req
   * @param {import("express").Response} res
   * @param {*} next
   */
  async (req, res, next) => {
    const headers = req.headers;
    if (!headers) {
      res.status(401).json({ message: "Invalid Session" });
      return;
    }

    const token = headers.token;
    if (!token) {
      res.status(401).json({ message: "Invalid Session" });
      return;
    }

    /**
     * @type {Collection}
     */
    const session = db.collection("session");
    const data = await session.findOne({ token: token });
    if (!data) {
      res.status(401).json({ message: "Invalid Session" });
      return;
    }

    const userId = data.userId;
    /**
     * @type {Collection}
     */
    const users = db.collection("user");
    const user = await users.findOne({ _id: new ObjectId(userId) });
    if (!user) {
      res.status(401).json({ message: "Invalid Session" });
      return;
    }

    req.user = user;
    next();
  };

export const verifyCustomer = (req, res, next) => {
  if (req.user.role !== "customer") {
    return res.status(403).json({
      message: "Customer access required.",
    });
  }

  next();
};

export const verifyTechnician = (req, res, next) => {
  if (req.user.role !== "technician") {
    return res.status(403).json({
      message: "Technician access required.",
    });
  }

  next();
};

export const verifyAdmin = (req, res, next) => {
  if (req.user.role !== "admin") {
    return res.status(403).json({
      message: "Admin access required.",
    });
  }

  next();
};
