# FixMate — Backend API

FixMate is an on-demand device and home appliance repair platform. Customers browse verified technician services, send repair requests, track the job status, and pay online only after the work is completed. Technicians manage services and jobs, and admins moderate services, users, bookings, and revenue.

This repository contains the Express + MongoDB API server.

## Tech Stack

- Node.js (ES modules)
- Express 5
- MongoDB native driver
- Zod validation
- BetterAuth JWT verification (`jose` + remote JWKS)
- Stripe Checkout (test mode) and webhooks
- ImgBB image uploads

## Getting Started

```bash
npm install
cp .env.example .env
npm run dev
```

The API runs on `http://localhost:5000` by default.

### Environment Variables

| Variable | Description |
| --- | --- |
| `MONGODB_URI` | MongoDB Atlas connection string |
| `MONGODB_DB` | Database name (defaults to `fixmate`) |
| `PORT` | API port (defaults to `5000`) |
| `CLIENT_URL` | Allowed frontend origin(s), comma separated |
| `JWT_JWKS_URL` | Optional override; defaults to `CLIENT_URL/api/auth/jwks` |
| `STRIPE_SECRET_KEY` | Stripe test secret key |
| `STRIPE_WEBHOOK_SECRET` | Stripe webhook signing secret |
| `IMGBB_API_KEY` | ImgBB API key |

## Scripts

```bash
npm run dev    # nodemon
npm start      # production start
npm run seed   # seed demo users, services, bookings and payments
```

## Seed Accounts

| Role | Email | Password |
| --- | --- | --- |
| Admin | `admin@fixmate.com` | `Admin@123` |
| Technician | `rahim@fixmate.com` | `Tech@123` |
| Technician | `karim@fixmate.com` | `Tech@123` |
| Customer | `customer@fixmate.com` | `Customer@123` |

## Authentication

BetterAuth runs in the Next.js app and issues JWTs through its JWT plugin. The API verifies the JWT with the JWKS endpoint at `CLIENT_URL/api/auth/jwks`, then loads the current user from MongoDB so role changes take effect immediately.

Send the token on every protected request:

```http
Authorization: Bearer <jwt>
```

Role middleware:

- `verifyToken` — 401 when the token is missing, invalid, or expired
- `verifyCustomer` — 403 unless the user role is `customer`
- `verifyTechnician` — 403 unless the user role is `technician`
- `verifyAdmin` — 403 unless the user role is `admin`

## API Reference

All routes are prefixed with `/api`.

### Services

| Method | Route | Access |
| --- | --- | --- |
| `GET` | `/services` | Public — approved + available, supports `search`, `category`, `serviceMode`, `minPrice`, `maxPrice`, `sort`, `limit` |
| `GET` | `/services/:id` | Public — approved + available only |
| `GET` | `/services/technician` | Technician — own services |
| `POST` | `/services` | Technician — creates a pending service |
| `PATCH` | `/services/:id` | Technician owner — resets approval to pending |
| `PATCH` | `/services/:id/availability` | Technician owner |
| `DELETE` | `/services/:id` | Technician owner |

### Bookings

| Method | Route | Access |
| --- | --- | --- |
| `POST` | `/bookings` | Customer — creates a repair request |
| `GET` | `/bookings/my` | Customer — own bookings |
| `GET` | `/bookings/technician` | Technician — own jobs, optional `status` |
| `GET` | `/bookings/:id` | Owner or admin |
| `PATCH` | `/bookings/:id/cancel` | Customer owner — only while `requested` |
| `PATCH` | `/bookings/:id/status` | Technician owner — enforced pipeline |

Allowed status pipeline:

```text
requested -> accepted | rejected
accepted  -> in-progress
in-progress -> completed (requires finalAmount > 0)
```

### Payments

| Method | Route | Access |
| --- | --- | --- |
| `POST` | `/payments/create-checkout-session` | Customer owner of a completed, unpaid booking |
| `GET` | `/payments/verify?session_id=...` | Customer owner |
| `GET` | `/payments/my` | Customer — payment history |
| `POST` | `/payments/webhook` | Stripe signature verified |

Payments are idempotent: `stripeSessionId` and `bookingId` have unique indexes.

### Users

| Method | Route | Access |
| --- | --- | --- |
| `GET` | `/users/me` | Any authenticated user |
| `PATCH` | `/users/profile` | Any authenticated user |

### Admin

| Method | Route | Access |
| --- | --- | --- |
| `GET` | `/admin/users` | Admin |
| `PATCH` | `/admin/users/:id/role` | Admin — cannot change own role |
| `GET` | `/admin/services` | Admin — optional `status` filter |
| `PATCH` | `/admin/services/:id/approval` | Admin |
| `GET` | `/admin/bookings` | Admin — optional `status` filter |
| `GET` | `/admin/payments` | Admin — includes total revenue |
| `GET` | `/admin/stats` | Admin — dashboard counts and chart data |

### Uploads

| Method | Route | Access |
| --- | --- | --- |
| `POST` | `/uploads` | Authenticated — accepts base64 image data and uploads to ImgBB |

## Response Shape

Successful responses use `{ data, message? }`. Errors use `{ message, issues? }`.

## Deployment

Set all environment variables on the hosting platform, allow the frontend origin in `CLIENT_URL`, and register `https://<backend-domain>/api/payments/webhook` in the Stripe Dashboard. Use the Stripe test-mode signing secret as `STRIPE_WEBHOOK_SECRET`.
