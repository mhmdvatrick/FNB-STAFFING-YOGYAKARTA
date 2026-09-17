# Dashboard Web — Resto (Next.js + Tailwind)

## Setup
```bash
npx create-next-app@latest . --typescript --tailwind --app
npm install @supabase/supabase-js axios recharts lucide-react
```

## Halaman yang Direncanakan

```
src/app/
├── (auth)/
│   ├── login/page.tsx
│   └── register/page.tsx
├── dashboard/
│   ├── page.tsx              # Overview stats
│   ├── shifts/
│   │   ├── page.tsx          # Daftar shift + status
│   │   ├── new/page.tsx      # Form buat shift baru
│   │   └── [id]/page.tsx     # Detail shift + claims
│   ├── workers/
│   │   └── page.tsx          # Daftar worker & rating
│   └── finance/
│       └── page.tsx          # Saldo deposit & transaksi
```

## Komponen Utama yang Perlu Dibangun
- `ShiftCard` — Kartu info shift dengan status badge
- `WorkerList` — Tabel worker dengan tier indicator
- `AttendanceMap` — Peta real-time lokasi worker (Google Maps)
- `DepositWidget` — Widget saldo + tombol top-up (Xendit)
- `QRCodeDisplay` — Tampilkan QR code harian untuk supervisor
