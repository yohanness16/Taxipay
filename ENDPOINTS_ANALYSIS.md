# TaxiPay Backend API Endpoints Analysis

## Overview
This document provides a concise analysis of each API endpoint in the TaxiPay backend system, built with Hono.js and TypeScript, using PostgreSQL as the database.

## Endpoints

### 1. **POST `/api/register`**
**Purpose**: Register a new driver with a 7-day free trial subscription.
**Inputs**:
- `phone` (string, Ethiopian format: +2519XXXXXXXX or +2517XXXXXXXX)
- `name` (string, 2-100 characters)
- `vehicle_number` (string, optional, max 20 characters)
- `password` (string, min 6 characters)
**Output** (201 Created):
```json
{
  "success": true,
  "driverId": number,
  "token": string (JWT),
  "trialExpires": string (ISO date)
}
```
**Key Actions**:
- Validates input with `registerSchema`
- Checks for existing phone number
- Hashes password
- Inserts driver record
- Creates trial subscription (7 days from now)
- Returns JWT token

### 2. **POST `/api/login`**
**Purpose**: Authenticate a driver and issue a JWT token.
**Inputs**:
- `phone` (string, Ethiopian format)
- `password` (string, min 1 character)
**Output** (200 OK):
```json
{
  "success": true,
  "token": string (JWT),
  "driverId": number,
  "name": string
}
```
**Key Actions**:
- Validates input with `loginSchema`
- Fetches driver by phone
- Verifies password hash
- Issues JWT token on success

### 3. **GET `/api/subscription/check/:phone`**
**Purpose**: Check subscription status for a driver (public endpoint).
**Inputs**:
- `:phone` (path parameter, Ethiopian format)
**Output** (200 OK):
```json
{
  "paid": boolean,
  "expires": string|null (ISO date),
  "status": string,
  "inGracePeriod": boolean
}
```
**Key Actions**:
- Validates phone format
- Retrieves most recent subscription for the phone
- Calculates paid status (includes 3-day grace period after end_date)
- Returns subscription details

### 4. **POST `/api/subscription/payment`**
**Purpose**: Process Stripe payment for subscription extension.
**Inputs** (JSON body):
- `phone` (string, Ethiopian format)
- `transaction_id` (string, min 3 characters)
- `amount` (number, positive)
- `status` (string, enum: completed|pending|failed, defaults to completed)
**Output** (201 Created):
```json
{
  "success": true,
  "paid": true,
  "expires": string (ISO date, 30 days from now or current end date)
}
```
**Key Actions**:
- Validates input with `paymentSchema`
- Fetches driver by phone
- Checks for duplicate transaction_id
- Extends subscription by 30 days (from current end date if active, else from now)
- Records payment in `subscription_payments`

### 5. **POST `/api/subscription/verify-telebirr`**
**Purpose**: Verify Telebirr SMS payment from drivers claiming via pasted SMS text.
**Inputs** (JSON body):
- `driverId` (number)
- `amount` (number, positive)
- `smsText` (string, containing Telebirr transaction ID)
**Output** (200 OK):
```json
{
  "success": true,
  "message": "Subscription payment verified and access extended successfully.",
  "data": {
    "subscriptionId": number,
    "extendedUntil": string (ISO date),
    "transactionId": string
  }
}
```
**Key Actions**:
- Extracts 10-character Telebirr transaction ID from SMS text using regex
- Finds pending SMS message matching transaction ID and amount
- Uses database transactions with row locking to prevent race conditions:
  - Locks SMS record (`FOR UPDATE`)
  - Locks latest subscription record (`FOR UPDATE`)
- Extends subscription by 30 days (from current end if active, else from now)
- Records payment in `subscription_payments`
- Marks SMS as processed
- Handles rollback on any error

### 6. **POST `/api/subscription/sms-webhook`**
**Purpose**: Secure endpoint for receiving Telebirr SMS notifications from gateway.
**Inputs**:
- Header: `X-Gateway-API-Key` (must match `SMS_GATEWAY_SECRET` env var if set)
- JSON body: SMS payload (auto-detects format from legacy or standard structure)
**Output** (201 Created):
```json
{
  "message": "SMS received and stored successfully"
}
```
**Key Actions**:
- Validates gateway API key (if configured)
- Parses SMS payload (handles both legacy multi-line and standard JSON formats)
- Extracts `from` (sender) and `message` (content)
- Filters to only process messages from Telebirr (contains "telebirr" or "8558" in sender)
- Inserts SMS into `sms_messages` table with status 'pending'
- Logs receipt for monitoring

### 7. **POST `/api/subscription/create`** (JWT-protected)
**Purpose**: Manually create/initiate a 7-day trial subscription for authenticated driver.
**Inputs**:
- JWT token in `Authorization: Bearer <token>` header (validated by authMiddleware)
**Output** (201 Created):
```json
{
  "success": true,
  "subscriptionId": number,
  "expires": string (ISO date, 7 days from now)
}
```
**Key Actions**:
- Extracts driver info from JWT via authMiddleware
- Creates new trial subscription record (7 days from now, amount 0, status 'trial')
- Returns subscription details

## Authentication
- Protected endpoints (`/api/subscription/create`) use JWT authentication via `authMiddleware`
- Token issued on `/api/register` and `/api/login` (expires in 30 days)
- Middleware sets `c.set("driver", { driverId, phone })` for route handlers

## Database Schema Highlights
- `drivers`: id, phone, name, vehicle_number, password_hash
- `subscriptions`: id, driver_id, start_date, end_date, amount, payment_method, transaction_id, status
- `subscription_payments`: id, driver_id, subscription_id, transaction_id, amount, status
- `sms_messages`: id, message, status ('pending'|'processed'), processed_by, processed_at, created_at

## Key Features
- **Concurrency Safety**: Uses `FOR UPDATE` locking in Telebirr verification to prevent double-charging
- **Grace Period**: 3-day grace period after subscription end date before marking as unpaid
- **Input Validation**: Uses Zod schemas for all incoming data
- **Secure Webhooks**: SMS gateway endpoint validates source via API key header
- **Multi-format SMS Handling**: Supports both legacy custom format and standard JSON payloads