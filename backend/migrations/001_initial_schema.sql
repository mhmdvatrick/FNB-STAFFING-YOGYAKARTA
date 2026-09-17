-- ============================================================
-- Migration 001: Initial Schema
-- Platform: On-Demand FnB Staffing Yogyakarta
-- ============================================================

-- Enable extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "postgis";  -- Untuk geo query (opsional, bisa pakai lat/lng biasa)

-- ============================================================
-- ENUM TYPES
-- ============================================================

CREATE TYPE user_role AS ENUM ('WORKER', 'RESTO', 'ADMIN');
CREATE TYPE user_status AS ENUM ('PENDING', 'ACTIVE', 'SUSPENDED', 'BANNED');
CREATE TYPE worker_tier AS ENUM ('BRONZE', 'SILVER', 'GOLD', 'PLATINUM');
CREATE TYPE skill_badge_name AS ENUM ('WAITSTAFF', 'BARISTA', 'KITCHEN', 'CASHIER');
CREATE TYPE shift_status AS ENUM ('OPEN', 'FILLED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');
CREATE TYPE shift_role AS ENUM ('WAITSTAFF', 'BARISTA', 'KITCHEN', 'CASHIER');
CREATE TYPE claim_status AS ENUM ('CLAIMED', 'STANDBY', 'CONFIRMED', 'CHECKED_IN', 'CHECKED_OUT', 'NO_SHOW', 'CANCELLED');
CREATE TYPE validation_method AS ENUM ('GPS_QR', 'GPS_PIN', 'GPS_QR_PIN');
CREATE TYPE transaction_type AS ENUM ('DEPOSIT', 'PAYOUT', 'SERVICE_FEE', 'STANDBY_COMPENSATION', 'REFUND');
CREATE TYPE transaction_status AS ENUM ('PENDING', 'SUCCESS', 'FAILED', 'CANCELLED');

-- ============================================================
-- TABLE: users
-- ============================================================
CREATE TABLE users (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email           VARCHAR(255) UNIQUE,
    phone           VARCHAR(20) UNIQUE NOT NULL,
    password_hash   TEXT,
    role            user_role NOT NULL,
    status          user_status NOT NULL DEFAULT 'PENDING',
    fcm_token       TEXT,                          -- Firebase Cloud Messaging token
    last_login_at   TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_users_phone ON users(phone);
CREATE INDEX idx_users_role ON users(role);
CREATE INDEX idx_users_status ON users(status);

-- ============================================================
-- TABLE: worker_profiles
-- ============================================================
CREATE TABLE worker_profiles (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id             UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    full_name           VARCHAR(255) NOT NULL,
    ktp_number          VARCHAR(20) UNIQUE,        -- Nomor KTP (16 digit)
    ktm_number          VARCHAR(50),               -- Nomor KTM mahasiswa
    university          VARCHAR(255),
    avatar_url          TEXT,
    tier                worker_tier NOT NULL DEFAULT 'BRONZE',
    rating              NUMERIC(3,2) NOT NULL DEFAULT 0.00,
    total_shifts_done   INTEGER NOT NULL DEFAULT 0,
    reliability_score   NUMERIC(5,2) NOT NULL DEFAULT 100.00, -- 0-100
    wallet_balance      BIGINT NOT NULL DEFAULT 0,  -- dalam Rupiah (integer, hindari float)
    is_available        BOOLEAN NOT NULL DEFAULT TRUE,
    current_lat         DOUBLE PRECISION,
    current_lng         DOUBLE PRECISION,
    location_updated_at TIMESTAMPTZ,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_worker_profiles_user_id ON worker_profiles(user_id);
CREATE INDEX idx_worker_profiles_tier ON worker_profiles(tier);
CREATE INDEX idx_worker_profiles_rating ON worker_profiles(rating);
CREATE INDEX idx_worker_profiles_available ON worker_profiles(is_available);
-- Indeks untuk query geo-radius (lat/lng range)
CREATE INDEX idx_worker_profiles_location ON worker_profiles(current_lat, current_lng)
    WHERE current_lat IS NOT NULL AND current_lng IS NOT NULL;

-- ============================================================
-- TABLE: resto_profiles
-- ============================================================
CREATE TABLE resto_profiles (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id         UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    resto_name      VARCHAR(255) NOT NULL,
    address         TEXT NOT NULL,
    kelurahan       VARCHAR(100),
    kecamatan       VARCHAR(100),
    geo_lat         DOUBLE PRECISION NOT NULL,
    geo_lng         DOUBLE PRECISION NOT NULL,
    pic_name        VARCHAR(255) NOT NULL,         -- Person In Charge
    pic_phone       VARCHAR(20) NOT NULL,
    qr_code_secret  VARCHAR(100) NOT NULL,         -- Secret untuk generate QR statis
    pin_code        CHAR(4) NOT NULL,              -- PIN 4 digit supervisor
    deposit_balance BIGINT NOT NULL DEFAULT 0,     -- Saldo deposit resto (Rupiah)
    logo_url        TEXT,
    is_verified     BOOLEAN NOT NULL DEFAULT FALSE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_resto_profiles_user_id ON resto_profiles(user_id);
CREATE INDEX idx_resto_profiles_location ON resto_profiles(geo_lat, geo_lng);

-- ============================================================
-- TABLE: skill_badges
-- ============================================================
CREATE TABLE skill_badges (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    worker_id       UUID NOT NULL REFERENCES worker_profiles(id) ON DELETE CASCADE,
    name            skill_badge_name NOT NULL,
    quiz_passed     BOOLEAN NOT NULL DEFAULT FALSE,
    quiz_score      INTEGER,                       -- 0-100
    verified_at     TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(worker_id, name)                        -- Satu badge per skill per worker
);

CREATE INDEX idx_skill_badges_worker_id ON skill_badges(worker_id);
CREATE INDEX idx_skill_badges_name ON skill_badges(name);
CREATE INDEX idx_skill_badges_verified ON skill_badges(verified_at) WHERE verified_at IS NOT NULL;

-- ============================================================
-- TABLE: shifts
-- ============================================================
CREATE TABLE shifts (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    resto_id        UUID NOT NULL REFERENCES resto_profiles(id) ON DELETE RESTRICT,
    title           VARCHAR(255) NOT NULL,
    role_required   shift_role NOT NULL,
    headcount       INTEGER NOT NULL DEFAULT 1 CHECK (headcount >= 1 AND headcount <= 20),
    hourly_rate     INTEGER NOT NULL CHECK (hourly_rate > 0),  -- Rupiah/jam
    start_time      TIMESTAMPTZ NOT NULL,
    end_time        TIMESTAMPTZ NOT NULL,
    status          shift_status NOT NULL DEFAULT 'OPEN',
    dress_code      TEXT,
    instructions    TEXT,
    min_rating      NUMERIC(3,2) NOT NULL DEFAULT 4.5,
    filled_count    INTEGER NOT NULL DEFAULT 0,
    cancelled_at    TIMESTAMPTZ,
    cancelled_reason TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT shift_time_valid CHECK (end_time > start_time),
    CONSTRAINT shift_min_duration CHECK (end_time - start_time >= INTERVAL '1 hour')
);

CREATE INDEX idx_shifts_resto_id ON shifts(resto_id);
CREATE INDEX idx_shifts_status ON shifts(status);
CREATE INDEX idx_shifts_start_time ON shifts(start_time);
CREATE INDEX idx_shifts_role ON shifts(role_required);

-- ============================================================
-- TABLE: shift_claims
-- ============================================================
CREATE TABLE shift_claims (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    shift_id            UUID NOT NULL REFERENCES shifts(id) ON DELETE RESTRICT,
    worker_id           UUID NOT NULL REFERENCES worker_profiles(id) ON DELETE RESTRICT,
    status              claim_status NOT NULL DEFAULT 'CLAIMED',
    confirmed_at        TIMESTAMPTZ,               -- Worker tekan CONFIRM H-2 jam
    reminder_sent_at    TIMESTAMPTZ,               -- Waktu reminder dikirim
    standby_comp_paid   BOOLEAN NOT NULL DEFAULT FALSE,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(shift_id, worker_id)                    -- Satu worker hanya bisa claim sekali per shift
);

CREATE INDEX idx_shift_claims_shift_id ON shift_claims(shift_id);
CREATE INDEX idx_shift_claims_worker_id ON shift_claims(worker_id);
CREATE INDEX idx_shift_claims_status ON shift_claims(status);

-- ============================================================
-- TABLE: attendance_logs
-- ============================================================
CREATE TABLE attendance_logs (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    shift_claim_id      UUID NOT NULL UNIQUE REFERENCES shift_claims(id) ON DELETE RESTRICT,
    check_in_time       TIMESTAMPTZ,
    check_out_time      TIMESTAMPTZ,
    check_in_lat        DOUBLE PRECISION,
    check_in_lng        DOUBLE PRECISION,
    check_out_lat       DOUBLE PRECISION,
    check_out_lng       DOUBLE PRECISION,
    selfie_url          TEXT,                      -- URL selfie di Supabase Storage
    validation_method   validation_method,
    -- Hasil settlement
    work_duration_minutes INTEGER,                 -- Durasi kerja dalam menit (sudah dibulatkan)
    gross_salary        BIGINT,                    -- Gaji kotor (Rupiah)
    service_fee_total   BIGINT,                    -- Total service fee platform
    net_salary          BIGINT,                    -- Gaji bersih worker
    settled_at          TIMESTAMPTZ,               -- Waktu settlement dilakukan
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_attendance_logs_claim_id ON attendance_logs(shift_claim_id);

-- ============================================================
-- TABLE: transactions
-- ============================================================
CREATE TABLE transactions (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id             UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    amount              BIGINT NOT NULL,            -- Rupiah (positif = credit, negatif = debit)
    type                transaction_type NOT NULL,
    status              transaction_status NOT NULL DEFAULT 'PENDING',
    reference_id        VARCHAR(255),              -- Xendit invoice/disbursement ID
    description         TEXT,
    related_shift_id    UUID REFERENCES shifts(id),
    related_claim_id    UUID REFERENCES shift_claims(id),
    xendit_payload      JSONB,                     -- Raw response dari Xendit
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_transactions_user_id ON transactions(user_id);
CREATE INDEX idx_transactions_type ON transactions(type);
CREATE INDEX idx_transactions_status ON transactions(status);
CREATE INDEX idx_transactions_reference_id ON transactions(reference_id);

-- ============================================================
-- TABLE: ratings
-- ============================================================
CREATE TABLE ratings (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    shift_id        UUID NOT NULL REFERENCES shifts(id) ON DELETE RESTRICT,
    claim_id        UUID NOT NULL REFERENCES shift_claims(id) ON DELETE RESTRICT,
    reviewer_id     UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    reviewee_id     UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    rating_score    NUMERIC(3,2) NOT NULL CHECK (rating_score >= 1 AND rating_score <= 5),
    feedback        TEXT,
    is_favorite     BOOLEAN NOT NULL DEFAULT FALSE, -- Resto bisa tandai worker favorit
    is_blocked      BOOLEAN NOT NULL DEFAULT FALSE, -- Resto bisa blokir worker
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(claim_id, reviewer_id)                   -- Satu review per claim per reviewer
);

CREATE INDEX idx_ratings_reviewee_id ON ratings(reviewee_id);
CREATE INDEX idx_ratings_shift_id ON ratings(shift_id);
CREATE INDEX idx_ratings_is_favorite ON ratings(reviewee_id, is_favorite) WHERE is_favorite = TRUE;

-- ============================================================
-- TABLE: notifications (audit log push notif)
-- ============================================================
CREATE TABLE notifications (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title           VARCHAR(255) NOT NULL,
    body            TEXT NOT NULL,
    data            JSONB,
    is_read         BOOLEAN NOT NULL DEFAULT FALSE,
    sent_at         TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_notifications_user_id ON notifications(user_id);
CREATE INDEX idx_notifications_unread ON notifications(user_id, is_read) WHERE is_read = FALSE;
