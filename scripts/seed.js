import dotenv from "dotenv";
dotenv.config();

import { MongoClient, ObjectId } from "mongodb";
import { randomBytes, scrypt } from "node:crypto";

const uri = process.env.MONGODB_URI;
if (!uri) throw new Error("MONGODB_URI is not set.");

const client = new MongoClient(uri);

function generateKey(password, salt) {
  return new Promise((resolve, reject) => {
    scrypt(
      password.normalize("NFKC"),
      salt,
      64,
      { N: 16384, r: 16, p: 1, maxmem: 128 * 16384 * 16 * 2 },
      (error, key) => (error ? reject(error) : resolve(key)),
    );
  });
}

async function hashPassword(password) {
  const salt = randomBytes(16).toString("hex");
  const key = await generateKey(password, salt);
  return `${salt}:${key.toString("hex")}`;
}

function daysAgo(days) {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date;
}

function hoursAfter(date, hours) {
  return new Date(date.getTime() + hours * 60 * 60 * 1000);
}

function buildStatusHistory(status, createdAt) {
  if (status === "requested") {
    return [{ status: "requested", changedAt: createdAt }];
  }

  if (status === "cancelled" || status === "rejected") {
    return [
      { status: "requested", changedAt: createdAt },
      { status, changedAt: hoursAfter(createdAt, 3) },
    ];
  }

  const steps = ["requested", "accepted", "in-progress", "completed"];
  const lastIndex = steps.indexOf(status);
  return steps.slice(0, lastIndex + 1).map((step, index) => ({
    status: step,
    changedAt: hoursAfter(createdAt, index * 4),
  }));
}

async function upsertUser(db, user, password) {
  const users = db.collection("user");
  const accounts = db.collection("account");
  const now = new Date();

  const existing = await users.findOne({ email: user.email });
  let userId;

  if (existing) {
    userId = existing._id;
    await users.updateOne(
      { _id: userId },
      { $set: { ...user, emailVerified: true, updatedAt: now } },
    );
  } else {
    const result = await users.insertOne({
      ...user,
      emailVerified: true,
      createdAt: now,
      updatedAt: now,
    });
    userId = result.insertedId;
  }

  const passwordHash = await hashPassword(password);
  await accounts.updateOne(
    { providerId: "credential", accountId: userId.toString() },
    {
      $set: {
        userId,
        providerId: "credential",
        accountId: userId.toString(),
        password: passwordHash,
        updatedAt: now,
      },
      $setOnInsert: { createdAt: now },
    },
    { upsert: true },
  );

  return userId;
}

const technicians = {
  rahim: {
    name: "Rahim Uddin",
    email: "rahim@fixmate.com",
    role: "technician",
    plan: "pro",
    phone: "01711000001",
    area: "Mirpur, Dhaka",
    bio: "Senior appliance technician with 8 years of experience in AC, refrigerator and washing machine repair.",
    image: "https://i.pravatar.cc/300?img=12",
  },
  karim: {
    name: "Karim Hasan",
    email: "karim@fixmate.com",
    role: "technician",
    plan: "free",
    phone: "01711000002",
    area: "Dhanmondi, Dhaka",
    bio: "Smartphone and laptop repair specialist. Certified in board-level diagnostics and screen replacement.",
    image: "https://i.pravatar.cc/300?img=15",
  },
};

const serviceTemplates = [
  {
    title: "iPhone Screen Replacement",
    category: "Smartphone",
    description:
      "Original-quality screen replacement for iPhone models with a 30-day workmanship warranty. Includes diagnostics and calibration.",
    image:
      "https://images.unsplash.com/photo-1591337676887-a217a6970a8a?auto=format&fit=crop&w=1200&q=80",
    basePrice: 89,
    estimatedDuration: "1-2 hours",
    serviceMode: "Shop Drop-off",
    serviceArea: "Dhanmondi, Dhaka",
    technician: "karim",
    days: 1,
  },
  {
    title: "Laptop Motherboard Diagnostics",
    category: "Laptop & PC",
    description:
      "Complete board-level diagnostics for laptops that will not power on, overheat, or randomly shut down. Repair quote after inspection.",
    image:
      "https://images.unsplash.com/photo-1517336714731-489689fd1ca8?auto=format&fit=crop&w=1200&q=80",
    basePrice: 45,
    estimatedDuration: "1 day",
    serviceMode: "Shop Drop-off",
    serviceArea: "Dhanmondi, Dhaka",
    technician: "karim",
    days: 2,
  },
  {
    title: "Split AC Deep Cleaning",
    category: "AC",
    description:
      "Full split AC servicing including coil cleaning, filter wash, drain line clearing, and gas pressure check.",
    image:
      "https://images.unsplash.com/photo-1581092921461-eab62e97a780?auto=format&fit=crop&w=1200&q=80",
    basePrice: 35,
    estimatedDuration: "2-3 hours",
    serviceMode: "Home Visit",
    serviceArea: "Mirpur, Dhaka",
    technician: "rahim",
    days: 3,
  },
  {
    title: "Refrigerator Cooling Repair",
    category: "Refrigerator",
    description:
      "Diagnosis and repair for refrigerators that are not cooling, leaking water, or making unusual compressor noises.",
    image:
      "https://images.unsplash.com/photo-1584568694244-14fbdf83bd30?auto=format&fit=crop&w=1200&q=80",
    basePrice: 55,
    estimatedDuration: "2-4 hours",
    serviceMode: "Home Visit",
    serviceArea: "Mirpur, Dhaka",
    technician: "rahim",
    days: 4,
  },
  {
    title: "LED TV Panel Repair",
    category: "TV",
    description:
      "Expert diagnosis and repair for LED/LCD televisions with backlight, panel, or power board issues.",
    image:
      "https://images.unsplash.com/photo-1593359677879-a4bb92f829d1?auto=format&fit=crop&w=1200&q=80",
    basePrice: 65,
    estimatedDuration: "1 day",
    serviceMode: "Shop Drop-off",
    serviceArea: "Dhanmondi, Dhaka",
    technician: "karim",
    days: 5,
  },
  {
    title: "Washing Machine Drum Service",
    category: "Washing Machine",
    description:
      "Drum cleaning, belt replacement, and drainage repair for front-load and top-load washing machines.",
    image:
      "https://images.unsplash.com/photo-1626806787461-102c1bfaaea1?auto=format&fit=crop&w=1200&q=80",
    basePrice: 40,
    estimatedDuration: "2-3 hours",
    serviceMode: "Home Visit",
    serviceArea: "Mirpur, Dhaka",
    technician: "rahim",
    days: 6,
  },
  {
    title: "Home Electrical Wiring Check",
    category: "Electrical",
    description:
      "Safety inspection of home wiring, circuit breakers, and grounding. Includes a written fault report and repair estimate.",
    image:
      "https://images.unsplash.com/photo-1621905252507-b35492cc74b4?auto=format&fit=crop&w=1200&q=80",
    basePrice: 30,
    estimatedDuration: "1-2 hours",
    serviceMode: "Home Visit",
    serviceArea: "Dhanmondi, Dhaka",
    technician: "karim",
    days: 7,
  },
  {
    title: "Android Battery Replacement",
    category: "Smartphone",
    description:
      "Battery replacement for popular Android models using tested cells. Includes charge-cycle and health verification.",
    image:
      "https://images.unsplash.com/photo-1580910051074-3eb694886505?auto=format&fit=crop&w=1200&q=80",
    basePrice: 35,
    estimatedDuration: "45 minutes",
    serviceMode: "Shop Drop-off",
    serviceArea: "Dhanmondi, Dhaka",
    technician: "karim",
    days: 8,
  },
  {
    title: "Desktop PC Tune-Up",
    category: "Laptop & PC",
    description:
      "Deep cleaning, thermal paste replacement, cable management, and performance tuning for desktop computers.",
    image:
      "https://images.unsplash.com/photo-1587202372775-e229f172b9d7?auto=format&fit=crop&w=1200&q=80",
    basePrice: 25,
    estimatedDuration: "2 hours",
    serviceMode: "Home Visit",
    serviceArea: "Mirpur, Dhaka",
    technician: "rahim",
    days: 9,
  },
  {
    title: "AC Gas Refill",
    category: "AC",
    description:
      "Refrigerant top-up with leak detection and pressure testing for split and window air conditioners.",
    image:
      "https://images.unsplash.com/photo-1631545806609-25a4e5f0b1c0?auto=format&fit=crop&w=1200&q=80",
    basePrice: 50,
    estimatedDuration: "2-3 hours",
    serviceMode: "Home Visit",
    serviceArea: "Mirpur, Dhaka",
    technician: "rahim",
    days: 10,
  },
  {
    title: "Refrigerator Door Seal Replacement",
    category: "Refrigerator",
    description:
      "Replacement of worn magnetic door seals to restore cooling efficiency and stop condensation.",
    image:
      "https://images.unsplash.com/photo-1571175443880-49e1d25b2bc5?auto=format&fit=crop&w=1200&q=80",
    basePrice: 28,
    estimatedDuration: "1-2 hours",
    serviceMode: "Home Visit",
    serviceArea: "Mirpur, Dhaka",
    technician: "rahim",
    days: 11,
  },
  {
    title: "Smart TV Setup & Wall Mount",
    category: "TV",
    description:
      "Professional TV wall mounting, cable routing, and smart TV setup including Wi-Fi and streaming apps.",
    image:
      "https://images.unsplash.com/photo-1461151304267-38535e780c79?auto=format&fit=crop&w=1200&q=80",
    basePrice: 22,
    estimatedDuration: "1 hour",
    serviceMode: "Home Visit",
    serviceArea: "Dhanmondi, Dhaka",
    technician: "karim",
    days: 12,
  },
  {
    title: "Washing Machine Installation",
    category: "Washing Machine",
    description:
      "Unboxing, leveling, inlet/drain connection, and a test wash for new washing machines.",
    image:
      "https://images.unsplash.com/photo-1610557892470-55d9e80c0bce?auto=format&fit=crop&w=1200&q=80",
    basePrice: 18,
    estimatedDuration: "1 hour",
    serviceMode: "Home Visit",
    serviceArea: "Mirpur, Dhaka",
    technician: "rahim",
    days: 13,
  },
  {
    title: "Ceiling Fan & Light Installation",
    category: "Electrical",
    description:
      "Safe installation of ceiling fans, lights, and switches with proper anchoring and wiring checks.",
    image:
      "https://images.unsplash.com/photo-1558618666-fcd25c85cd64?auto=format&fit=crop&w=1200&q=80",
    basePrice: 15,
    estimatedDuration: "1-2 hours",
    serviceMode: "Home Visit",
    serviceArea: "Dhanmondi, Dhaka",
    technician: "karim",
    days: 14,
  },
];

async function main() {
  await client.connect();
  const db = client.db(process.env.MONGODB_DB || "fixmate");
  console.log("Connected to MongoDB. Seeding FixMate data...");

  const adminId = await upsertUser(
    db,
    {
      name: "FixMate Admin",
      email: "admin@fixmate.com",
      role: "admin",
      plan: "free",
      phone: "01711000000",
      area: "Dhaka, Bangladesh",
      bio: "Platform administrator for FixMate.",
      image: "https://i.pravatar.cc/300?img=68",
    },
    "Admin@123",
  );

  const customerId = await upsertUser(
    db,
    {
      name: "Nusrat Jahan",
      email: "customer@fixmate.com",
      role: "customer",
      plan: "free",
      phone: "01711000003",
      area: "Uttara, Dhaka",
      bio: "Homeowner who loves keeping her appliances in top shape.",
      image: "https://i.pravatar.cc/300?img=32",
    },
    "Customer@123",
  );

  const technicianIds = {};
  for (const [key, technician] of Object.entries(technicians)) {
    technicianIds[key] = await upsertUser(db, technician, "Tech@123");
  }

  console.log(
    `Seeded users: admin=${adminId}, customer=${customerId}, technicians=${Object.keys(technicianIds).length}`,
  );

  const services = db.collection("services");
  const serviceIds = [];

  for (const template of serviceTemplates) {
    const technician = technicians[template.technician];
    const doc = {
      title: template.title,
      category: template.category,
      description: template.description,
      image: template.image,
      basePrice: template.basePrice,
      estimatedDuration: template.estimatedDuration,
      serviceMode: template.serviceMode,
      serviceArea: template.serviceArea,
      technicianName: technician.name,
      technicianEmail: technician.email,
      approvalStatus: "approved",
      isAvailable: true,
      ratingAverage: 0,
      ratingCount: 0,
      createdAt: daysAgo(template.days),
      updatedAt: daysAgo(template.days),
    };

    const existing = await services.findOne({
      title: template.title,
      technicianEmail: technician.email,
    });

    let serviceId;
    if (existing) {
      serviceId = existing._id;
      await services.updateOne({ _id: serviceId }, { $set: doc });
    } else {
      const result = await services.insertOne(doc);
      serviceId = result.insertedId;
    }
    serviceIds.push({ ...doc, _id: serviceId });
  }

  console.log(`Seeded ${serviceIds.length} services.`);

  const bookings = db.collection("bookings");
  const payments = db.collection("payments");
  const customer = {
    name: "Nusrat Jahan",
    email: "customer@fixmate.com",
    phone: "01711000003",
    address: "House 12, Road 7, Uttara, Dhaka",
  };

  const bookingPlan = [
    { service: serviceIds[0], status: "requested", paymentStatus: "unpaid", days: 1 },
    { service: serviceIds[1], status: "accepted", paymentStatus: "unpaid", days: 2 },
    { service: serviceIds[2], status: "in-progress", paymentStatus: "unpaid", days: 3 },
    { service: serviceIds[3], status: "completed", paymentStatus: "unpaid", days: 4 },
    {
      service: serviceIds[4],
      status: "completed",
      paymentStatus: "paid",
      days: 5,
      rating: 5,
      review:
        "Karim diagnosed the panel fault quickly and had the TV working the same day. Clear pricing and very tidy work.",
    },
    { service: serviceIds[5], status: "rejected", paymentStatus: "unpaid", days: 6 },
    { service: serviceIds[6], status: "cancelled", paymentStatus: "unpaid", days: 7 },
  ];

  for (const plan of bookingPlan) {
    const service = plan.service;
    const createdAt = daysAgo(plan.days);
    const doc = {
      serviceId: service._id.toString(),
      serviceTitle: service.title,
      serviceImage: service.image,
      category: service.category,
      basePrice: service.basePrice,
      technicianName: service.technicianName,
      technicianEmail: service.technicianEmail,
      customerName: customer.name,
      customerEmail: customer.email,
      customerPhone: customer.phone,
      address: customer.address,
      preferredDate: daysAgo(plan.days - 1),
      problemDescription:
        "The appliance has been having this problem for a few days and needs a professional inspection.",
      status: plan.status,
      statusHistory: buildStatusHistory(plan.status, createdAt),
      finalAmount: plan.status === "completed" ? service.basePrice + 10 : service.basePrice,
      paymentStatus: plan.paymentStatus,
      rating: plan.rating ?? null,
      review: plan.review ?? null,
      reviewedAt: plan.rating ? daysAgo(plan.days - 1) : null,
      paidAt:
        plan.paymentStatus === "paid" ? daysAgo(plan.days - 1) : null,
      createdAt,
      updatedAt: createdAt,
    };

    const existing = await bookings.findOne({
      customerEmail: customer.email,
      serviceId: service._id.toString(),
    });

    let bookingId;
    if (existing) {
      bookingId = existing._id;
      await bookings.updateOne({ _id: bookingId }, { $set: doc });
    } else {
      const result = await bookings.insertOne(doc);
      bookingId = result.insertedId;
    }

    if (plan.paymentStatus === "paid") {
      await payments.updateOne(
        { bookingId: bookingId.toString() },
        {
          $set: {
            bookingId: bookingId.toString(),
            serviceTitle: service.title,
            customerName: customer.name,
            customerEmail: customer.email,
            technicianName: service.technicianName,
            technicianEmail: service.technicianEmail,
            amount: doc.finalAmount,
            currency: "usd",
            transactionId: `pi_seed_${bookingId.toString()}`,
            stripeSessionId: `cs_seed_${bookingId.toString()}`,
            paymentStatus: "paid",
            paidAt: daysAgo(plan.days - 1),
          },
        },
        { upsert: true },
      );
    }
  }

  const ratings = await bookings
    .aggregate([
      { $match: { rating: { $type: "number" } } },
      {
        $group: {
          _id: "$serviceId",
          average: { $avg: "$rating" },
          count: { $sum: 1 },
        },
      },
    ])
    .toArray();

  for (const rating of ratings) {
    await services.updateOne(
      { _id: new ObjectId(rating._id) },
      {
        $set: {
          ratingAverage: Math.round(rating.average * 10) / 10,
          ratingCount: rating.count,
        },
      },
    );
  }

  console.log(`Seeded ${bookingPlan.length} bookings and payment records.`);
  console.log(`Updated ratings for ${ratings.length} services.`);
  console.log("Seed complete.");
  console.log("Admin: admin@fixmate.com / Admin@123");
  console.log("Technician: rahim@fixmate.com / Tech@123");
  console.log("Technician: karim@fixmate.com / Tech@123");
  console.log("Customer: customer@fixmate.com / Customer@123");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await client.close();
  });
