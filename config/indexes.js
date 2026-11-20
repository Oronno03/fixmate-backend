/**
 * Creates the indexes FixMate needs for its query patterns and payment
 * idempotency guarantees. Safe to call on every boot.
 *
 * @param {import("mongodb").Db} db
 */
export async function ensureIndexes(db) {
  const definitions = [
    ["services", { approvalStatus: 1, isAvailable: 1, createdAt: -1 }],
    ["services", { technicianEmail: 1 }],
    ["services", { category: 1 }],
    ["bookings", { customerEmail: 1, status: 1 }],
    ["bookings", { technicianEmail: 1, status: 1 }],
    ["bookings", { customerEmail: 1, serviceId: 1, status: 1 }],
    ["bookings", { createdAt: -1 }],
    ["payments", { stripeSessionId: 1 }, { unique: true }],
    ["payments", { bookingId: 1 }, { unique: true }],
    ["payments", { customerEmail: 1 }],
    ["payments", { paidAt: -1 }],
  ];

  for (const [collection, keys, options] of definitions) {
    try {
      await db.collection(collection).createIndex(keys, options);
    } catch (error) {
      console.error(
        `Failed to create index on ${collection} ${JSON.stringify(keys)}:`,
        error.message,
      );
    }
  }
}
