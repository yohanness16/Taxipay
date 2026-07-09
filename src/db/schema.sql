-- Telebirr Driver SaaS — Backend schema (run in Supabase SQL editor)

CREATE TABLE IF NOT EXISTS drivers (
  id SERIAL PRIMARY KEY,
  phone VARCHAR(15) UNIQUE NOT NULL,
  name VARCHAR(100) NOT NULL,
  vehicle_number VARCHAR(20),
  password_hash TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS subscriptions (
  id SERIAL PRIMARY KEY,
  driver_id INTEGER REFERENCES drivers(id) ON DELETE CASCADE,
  start_date TIMESTAMP NOT NULL,
  end_date TIMESTAMP NOT NULL,
  amount DECIMAL(10,2) DEFAULT 100.00,
  payment_method VARCHAR(50),
  transaction_id VARCHAR(100),
  status VARCHAR(20) DEFAULT 'trial', -- trial | active | expired
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS subscription_payments (
  id SERIAL PRIMARY KEY,
  driver_id INTEGER REFERENCES drivers(id) ON DELETE CASCADE,
  subscription_id INTEGER REFERENCES subscriptions(id) ON DELETE SET NULL,
  transaction_id VARCHAR(100) UNIQUE NOT NULL,
  amount DECIMAL(10,2) NOT NULL,
  status VARCHAR(20) DEFAULT 'completed', -- pending | completed | failed
  created_at TIMESTAMP DEFAULT NOW()
);

-- Create an explicit state ENUM for the gateway logs
CREATE TYPE sms_status AS ENUM ('pending', 'processed', 'failed');

CREATE TABLE IF NOT EXISTS sms_messages (
  id SERIAL PRIMARY KEY,
  
  -- The raw, unaltered SMS block received from the Telebirr notification hook
  message TEXT NOT NULL,
  
  -- Tracking flag to stop malicious replay attacks (double-claiming)
  status sms_status NOT NULL DEFAULT 'pending',
  
  -- Links back to the driver who successfully claimed this text payload
  processed_by INTEGER REFERENCES drivers(id) ON DELETE SET NULL,
  
  -- Temporal metadata
  processed_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW()
);

-- CRITICAL PERFORMANCE INDEX
-- Optimizes raw text pattern lookups (ILIKE) down to 0ms by only indexing unspent records
CREATE INDEX IF NOT EXISTS idx_sms_pending_lookup 
ON sms_messages(status) 
INCLUDE (message) 
WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_drivers_phone ON drivers(phone);
CREATE INDEX IF NOT EXISTS idx_subscriptions_driver ON subscriptions(driver_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_end_date ON subscriptions(end_date);
