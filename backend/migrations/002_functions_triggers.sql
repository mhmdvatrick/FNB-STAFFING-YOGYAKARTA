-- ============================================================
-- Migration 002: Functions & Triggers
-- Platform: On-Demand FnB Staffing Yogyakarta
-- ============================================================

-- ============================================================
-- FUNCTION: Auto-update updated_at timestamp
-- ============================================================
CREATE OR REPLACE FUNCTION trigger_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply trigger ke semua tabel dengan kolom updated_at
CREATE TRIGGER set_updated_at_users
    BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

CREATE TRIGGER set_updated_at_worker_profiles
    BEFORE UPDATE ON worker_profiles
    FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

CREATE TRIGGER set_updated_at_resto_profiles
    BEFORE UPDATE ON resto_profiles
    FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

CREATE TRIGGER set_updated_at_shifts
    BEFORE UPDATE ON shifts
    FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

CREATE TRIGGER set_updated_at_shift_claims
    BEFORE UPDATE ON shift_claims
    FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

CREATE TRIGGER set_updated_at_attendance_logs
    BEFORE UPDATE ON attendance_logs
    FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

CREATE TRIGGER set_updated_at_transactions
    BEFORE UPDATE ON transactions
    FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

-- ============================================================
-- FUNCTION: Recalculate worker average rating
-- Dipanggil setiap kali ada rating baru untuk worker
-- ============================================================
CREATE OR REPLACE FUNCTION recalculate_worker_rating()
RETURNS TRIGGER AS $$
DECLARE
    v_worker_user_id UUID;
    v_new_rating     NUMERIC(3,2);
    v_shift_count    INTEGER;
BEGIN
    -- Dapatkan user_id reviewee
    SELECT wp.user_id, wp.total_shifts_done
    INTO v_worker_user_id, v_shift_count
    FROM worker_profiles wp
    JOIN users u ON u.id = wp.user_id
    WHERE u.id = NEW.reviewee_id;

    -- Hitung rata-rata rating dari semua review yang diterima worker ini
    SELECT ROUND(AVG(r.rating_score)::NUMERIC, 2)
    INTO v_new_rating
    FROM ratings r
    WHERE r.reviewee_id = NEW.reviewee_id;

    -- Update worker_profiles
    UPDATE worker_profiles
    SET rating = v_new_rating,
        total_shifts_done = total_shifts_done + 1
    WHERE user_id = NEW.reviewee_id;

    -- Update tier berdasarkan total shift dan rating
    UPDATE worker_profiles
    SET tier = CASE
        WHEN total_shifts_done >= 50 AND rating >= 4.8 THEN 'PLATINUM'::worker_tier
        WHEN total_shifts_done >= 20 AND rating >= 4.5 THEN 'GOLD'::worker_tier
        WHEN total_shifts_done >= 10 AND rating >= 4.0 THEN 'SILVER'::worker_tier
        ELSE 'BRONZE'::worker_tier
    END
    WHERE user_id = NEW.reviewee_id;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER on_rating_created
    AFTER INSERT ON ratings
    FOR EACH ROW EXECUTE FUNCTION recalculate_worker_rating();

-- ============================================================
-- FUNCTION: Update filled_count di shifts saat claim status berubah
-- ============================================================
CREATE OR REPLACE FUNCTION update_shift_filled_count()
RETURNS TRIGGER AS $$
DECLARE
    v_filled INTEGER;
    v_headcount INTEGER;
BEGIN
    -- Hitung berapa CLAIMED/CONFIRMED/CHECKED_IN/CHECKED_OUT untuk shift ini
    SELECT COUNT(*), s.headcount
    INTO v_filled, v_headcount
    FROM shift_claims sc
    JOIN shifts s ON s.id = sc.shift_id
    WHERE sc.shift_id = COALESCE(NEW.shift_id, OLD.shift_id)
      AND sc.status IN ('CLAIMED', 'CONFIRMED', 'CHECKED_IN', 'CHECKED_OUT')
    GROUP BY s.headcount;

    v_filled := COALESCE(v_filled, 0);

    -- Update status shift
    UPDATE shifts
    SET filled_count = v_filled,
        status = CASE
            WHEN v_filled >= v_headcount AND status = 'OPEN' THEN 'FILLED'::shift_status
            WHEN v_filled < v_headcount AND status = 'FILLED' THEN 'OPEN'::shift_status
            ELSE status
        END
    WHERE id = COALESCE(NEW.shift_id, OLD.shift_id);

    RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER on_claim_status_changed
    AFTER INSERT OR UPDATE OF status ON shift_claims
    FOR EACH ROW EXECUTE FUNCTION update_shift_filled_count();

-- ============================================================
-- FUNCTION: Deduct resto deposit & credit worker wallet saat settlement
-- ============================================================
CREATE OR REPLACE FUNCTION process_salary_settlement(
    p_claim_id          UUID,
    p_gross_salary      BIGINT,
    p_service_fee       BIGINT,
    p_work_duration_min INTEGER,
    p_validation_method validation_method
)
RETURNS JSON AS $$
DECLARE
    v_worker_id     UUID;
    v_worker_user_id UUID;
    v_resto_id      UUID;
    v_resto_user_id UUID;
    v_total_deduct  BIGINT;
    v_resto_balance BIGINT;
BEGIN
    v_total_deduct := p_gross_salary + p_service_fee;

    -- Ambil data claim
    SELECT sc.worker_id, wp.user_id, s.resto_id
    INTO v_worker_id, v_worker_user_id, v_resto_id
    FROM shift_claims sc
    JOIN worker_profiles wp ON wp.id = sc.worker_id
    JOIN shifts s ON s.id = sc.shift_id
    WHERE sc.id = p_claim_id;

    -- Ambil user_id resto
    SELECT user_id INTO v_resto_user_id
    FROM resto_profiles WHERE id = v_resto_id;

    -- Cek saldo deposit resto cukup
    SELECT deposit_balance INTO v_resto_balance
    FROM resto_profiles WHERE id = v_resto_id;

    IF v_resto_balance < v_total_deduct THEN
        RAISE EXCEPTION 'INSUFFICIENT_BALANCE: Saldo deposit resto tidak cukup. Saldo: %, Kebutuhan: %',
            v_resto_balance, v_total_deduct;
    END IF;

    -- Deduct saldo deposit resto
    UPDATE resto_profiles
    SET deposit_balance = deposit_balance - v_total_deduct
    WHERE id = v_resto_id;

    -- Credit wallet worker
    UPDATE worker_profiles
    SET wallet_balance = wallet_balance + p_gross_salary
    WHERE id = v_worker_id;

    -- Update attendance_logs
    UPDATE attendance_logs
    SET work_duration_minutes = p_work_duration_min,
        gross_salary          = p_gross_salary,
        service_fee_total     = p_service_fee,
        net_salary            = p_gross_salary,
        settled_at            = NOW(),
        validation_method     = p_validation_method
    WHERE shift_claim_id = p_claim_id;

    -- Insert transaction records
    -- 1. Debit dari deposit resto (service fee)
    INSERT INTO transactions (user_id, amount, type, status, description, related_claim_id)
    VALUES (v_resto_user_id, -p_service_fee, 'SERVICE_FEE', 'SUCCESS',
            format('Service fee shift claim %s', p_claim_id), p_claim_id);

    -- 2. Debit dari deposit resto (gaji worker)
    INSERT INTO transactions (user_id, amount, type, status, description, related_claim_id)
    VALUES (v_resto_user_id, -p_gross_salary, 'PAYOUT', 'SUCCESS',
            format('Pembayaran gaji worker untuk claim %s', p_claim_id), p_claim_id);

    -- 3. Credit ke wallet worker
    INSERT INTO transactions (user_id, amount, type, status, description, related_claim_id)
    VALUES (v_worker_user_id, p_gross_salary, 'PAYOUT', 'SUCCESS',
            format('Gaji diterima untuk claim %s', p_claim_id), p_claim_id);

    -- Update status claim menjadi CHECKED_OUT
    UPDATE shift_claims SET status = 'CHECKED_OUT' WHERE id = p_claim_id;

    RETURN json_build_object(
        'success', true,
        'gross_salary', p_gross_salary,
        'service_fee', p_service_fee,
        'total_deducted_from_resto', v_total_deduct,
        'net_salary_to_worker', p_gross_salary,
        'work_duration_minutes', p_work_duration_min
    );
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- FUNCTION: Haversine Distance (PostgreSQL native)
-- Menghitung jarak dalam meter antara dua koordinat GPS
-- ============================================================
CREATE OR REPLACE FUNCTION haversine_distance_meters(
    lat1 DOUBLE PRECISION,
    lng1 DOUBLE PRECISION,
    lat2 DOUBLE PRECISION,
    lng2 DOUBLE PRECISION
)
RETURNS DOUBLE PRECISION AS $$
DECLARE
    earth_radius_m CONSTANT DOUBLE PRECISION := 6371000;
    d_lat DOUBLE PRECISION;
    d_lng DOUBLE PRECISION;
    a DOUBLE PRECISION;
    c DOUBLE PRECISION;
BEGIN
    d_lat := RADIANS(lat2 - lat1);
    d_lng := RADIANS(lng2 - lng1);
    a := SIN(d_lat/2)^2 + COS(RADIANS(lat1)) * COS(RADIANS(lat2)) * SIN(d_lng/2)^2;
    c := 2 * ATAN2(SQRT(a), SQRT(1-a));
    RETURN earth_radius_m * c;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- ============================================================
-- VIEW: Worker availability untuk matching engine
-- ============================================================
CREATE OR REPLACE VIEW v_available_workers AS
SELECT
    wp.id               AS worker_id,
    wp.user_id,
    wp.full_name,
    wp.tier,
    wp.rating,
    wp.reliability_score,
    wp.wallet_balance,
    wp.is_available,
    wp.current_lat,
    wp.current_lng,
    u.phone,
    u.fcm_token,
    u.status            AS user_status,
    ARRAY_AGG(DISTINCT sb.name) FILTER (WHERE sb.verified_at IS NOT NULL) AS verified_skills
FROM worker_profiles wp
JOIN users u ON u.id = wp.user_id
LEFT JOIN skill_badges sb ON sb.worker_id = wp.id
WHERE wp.is_available = TRUE
  AND u.status = 'ACTIVE'
  AND wp.current_lat IS NOT NULL
  AND wp.current_lng IS NOT NULL
  AND wp.location_updated_at > NOW() - INTERVAL '30 minutes'  -- Lokasi masih fresh
GROUP BY wp.id, wp.user_id, wp.full_name, wp.tier, wp.rating,
         wp.reliability_score, wp.wallet_balance, wp.is_available,
         wp.current_lat, wp.current_lng, u.phone, u.fcm_token, u.status;
