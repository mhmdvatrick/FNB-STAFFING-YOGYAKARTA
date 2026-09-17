-- ============================================================
-- Seed Data untuk Demo & Presentasi Client
-- Platform: On-Demand FnB Staffing Yogyakarta
-- ============================================================
-- PENTING: Jalankan SETELAH migrations/001 dan 002

-- ─── Users (password: "demo1234" → hash bcrypt) ──────────────────────────────
INSERT INTO users (id, email, phone, role, status) VALUES
  -- Resto owners
  ('10000000-0000-0000-0000-000000000001', 'kopi.kenangan@demo.com', '08111000001', 'RESTO', 'ACTIVE'),
  ('10000000-0000-0000-0000-000000000002', 'angkringan.prawirotaman@demo.com', '08111000002', 'RESTO', 'ACTIVE'),
  -- Workers (mahasiswa)
  ('20000000-0000-0000-0000-000000000001', 'budi.santoso@student.uny.ac.id', '08222000001', 'WORKER', 'ACTIVE'),
  ('20000000-0000-0000-0000-000000000002', 'dewi.rahayu@student.ugm.ac.id', '08222000002', 'WORKER', 'ACTIVE'),
  ('20000000-0000-0000-0000-000000000003', 'andi.kurniawan@student.uii.ac.id', '08222000003', 'WORKER', 'ACTIVE'),
  ('20000000-0000-0000-0000-000000000004', 'siti.aminah@student.amikom.ac.id', '08222000004', 'WORKER', 'ACTIVE'),
  -- Admin
  ('30000000-0000-0000-0000-000000000001', 'admin@fnbstaffing.id', '08333000001', 'ADMIN', 'ACTIVE');

-- ─── Resto Profiles ──────────────────────────────────────────────────────────
-- Lokasi: area Yogyakarta (Jl. Malioboro, Prawirotaman, Sagan)
INSERT INTO resto_profiles (user_id, resto_name, address, kelurahan, kecamatan, geo_lat, geo_lng, pic_name, pic_phone, qr_code_secret, pin_code, deposit_balance, is_verified) VALUES
  (
    '10000000-0000-0000-0000-000000000001',
    'Kopi Kenangan Malioboro',
    'Jl. Malioboro No. 52, Yogyakarta',
    'Sosromenduran', 'Gedongtengen',
    -7.7928, 110.3659,
    'Pak Hendra', '08111000001',
    'KK_MALIOBORO_SECRET_2024',
    '1234',
    5000000,  -- Rp 5.000.000 deposit awal
    TRUE
  ),
  (
    '10000000-0000-0000-0000-000000000002',
    'Angkringan Prawirotaman',
    'Jl. Prawirotaman No. 18, Yogyakarta',
    'Brontokusuman', 'Mergangsan',
    -7.8187, 110.3699,
    'Bu Sari', '08111000002',
    'AP_PRAWI_SECRET_2024',
    '5678',
    3000000,
    TRUE
  );

-- ─── Worker Profiles ─────────────────────────────────────────────────────────
-- Lokasi worker di sekitar Malioboro/Sagan/UGM (dalam radius 5 KM)
INSERT INTO worker_profiles (user_id, full_name, ktp_number, ktm_number, university, tier, rating, total_shifts_done, reliability_score, wallet_balance, is_available, current_lat, current_lng, location_updated_at) VALUES
  (
    '20000000-0000-0000-0000-000000000001',
    'Budi Santoso', '3404021012990001', 'UNY-2021-001',
    'Universitas Negeri Yogyakarta',
    'PLATINUM', 4.9, 67, 98.5, 250000,
    TRUE, -7.7950, 110.3680, -- ~300m dari Malioboro
    NOW() - INTERVAL '10 minutes'
  ),
  (
    '20000000-0000-0000-0000-000000000002',
    'Dewi Rahayu', '3404022002001002', 'UGM-2020-002',
    'Universitas Gadjah Mada',
    'GOLD', 4.7, 32, 95.0, 180000,
    TRUE, -7.7780, 110.3750, -- area Sagan
    NOW() - INTERVAL '5 minutes'
  ),
  (
    '20000000-0000-0000-0000-000000000003',
    'Andi Kurniawan', '3404023003001003', 'UII-2022-003',
    'Universitas Islam Indonesia',
    'SILVER', 4.6, 15, 92.0, 75000,
    TRUE, -7.8050, 110.3720, -- area Prawirotaman
    NOW() - INTERVAL '20 minutes'
  ),
  (
    '20000000-0000-0000-0000-000000000004',
    'Siti Aminah', '3404024004001004', 'AMIKOM-2023-004',
    'Universitas AMIKOM Yogyakarta',
    'BRONZE', 4.5, 5, 100.0, 25000,
    TRUE, -7.7900, 110.3600,
    NOW() - INTERVAL '8 minutes'
  );

-- ─── Skill Badges ────────────────────────────────────────────────────────────
INSERT INTO skill_badges (worker_id, name, quiz_passed, quiz_score, verified_at) VALUES
  -- Budi: WAITSTAFF + BARISTA (Platinum multi-skill)
  ((SELECT id FROM worker_profiles WHERE user_id = '20000000-0000-0000-0000-000000000001'), 'WAITSTAFF', TRUE, 92, NOW() - INTERVAL '6 months'),
  ((SELECT id FROM worker_profiles WHERE user_id = '20000000-0000-0000-0000-000000000001'), 'BARISTA', TRUE, 88, NOW() - INTERVAL '4 months'),
  -- Dewi: BARISTA + CASHIER (Gold)
  ((SELECT id FROM worker_profiles WHERE user_id = '20000000-0000-0000-0000-000000000002'), 'BARISTA', TRUE, 85, NOW() - INTERVAL '8 months'),
  ((SELECT id FROM worker_profiles WHERE user_id = '20000000-0000-0000-0000-000000000002'), 'CASHIER', TRUE, 90, NOW() - INTERVAL '3 months'),
  -- Andi: WAITSTAFF (Silver)
  ((SELECT id FROM worker_profiles WHERE user_id = '20000000-0000-0000-0000-000000000003'), 'WAITSTAFF', TRUE, 80, NOW() - INTERVAL '2 months'),
  -- Siti: CASHIER (Bronze, baru)
  ((SELECT id FROM worker_profiles WHERE user_id = '20000000-0000-0000-0000-000000000004'), 'CASHIER', TRUE, 78, NOW() - INTERVAL '1 month');

-- ─── Sample Shift (besok pagi) ────────────────────────────────────────────────
INSERT INTO shifts (id, resto_id, title, role_required, headcount, hourly_rate, start_time, end_time, status, dress_code, instructions, min_rating) VALUES
  (
    'shift-00000000-0000-0000-0000-000000000001',
    (SELECT id FROM resto_profiles WHERE user_id = '10000000-0000-0000-0000-000000000001'),
    'Barista Weekend Pagi',
    'BARISTA', 2, 20000,
    (NOW() + INTERVAL '1 day')::DATE + TIME '07:00:00',
    (NOW() + INTERVAL '1 day')::DATE + TIME '13:00:00',
    'OPEN',
    'Kemeja putih + apron hitam',
    'Datang 10 menit lebih awal. Familiar dengan espresso machine Jura.',
    4.5
  ),
  (
    'shift-00000000-0000-0000-0000-000000000002',
    (SELECT id FROM resto_profiles WHERE user_id = '10000000-0000-0000-0000-000000000002'),
    'Waitstaff Malam Minggu',
    'WAITSTAFF', 3, 18000,
    (NOW() + INTERVAL '2 days')::DATE + TIME '17:00:00',
    (NOW() + INTERVAL '2 days')::DATE + TIME '23:00:00',
    'OPEN',
    'Batik + celana hitam',
    'Pengalaman layanan meja diutamakan. Ada menu spesial malam Minggu.',
    4.0
  );

-- ─── Sample Claim (Budi klaim shift barista) ──────────────────────────────────
INSERT INTO shift_claims (id, shift_id, worker_id, status) VALUES
  (
    'claim-0000000-0000-0000-0000-000000000001',
    'shift-00000000-0000-0000-0000-000000000001',
    (SELECT id FROM worker_profiles WHERE user_id = '20000000-0000-0000-0000-000000000001'),
    'CLAIMED'
  ),
  (
    'claim-0000000-0000-0000-0000-000000000002',
    'shift-00000000-0000-0000-0000-000000000001',
    (SELECT id FROM worker_profiles WHERE user_id = '20000000-0000-0000-0000-000000000002'),
    'CLAIMED'
  );
