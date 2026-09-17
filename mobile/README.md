# Mobile App — Worker (React Native)

## Setup
```bash
npx create-expo-app mobile --template blank-typescript
npm install @supabase/supabase-js expo-location expo-camera
npm install @react-navigation/native @react-navigation/stack
npm install react-native-maps expo-barcode-scanner
```

## Screen yang Direncanakan

```
src/screens/
├── auth/
│   ├── LoginScreen.tsx
│   └── RegisterScreen.tsx
├── home/
│   └── HomeScreen.tsx        # Daftar shift tersedia + map
├── shift/
│   ├── ShiftListScreen.tsx   # Browse & filter shift
│   ├── ShiftDetailScreen.tsx # Detail + tombol CLAIM
│   └── MyShiftsScreen.tsx    # Shift yang sudah diklaim
├── attendance/
│   ├── CheckInScreen.tsx     # GPS + QR/PIN + Selfie camera
│   └── CheckOutScreen.tsx    # Konfirmasi check-out
├── wallet/
│   └── WalletScreen.tsx      # Saldo + riwayat transaksi
└── profile/
    └── ProfileScreen.tsx     # Skill badges + rating + tier
```

## Fitur Utama
- Real-time GPS tracking (expo-location)
- QR Code scanner (expo-barcode-scanner)
- Selfie camera (expo-camera)
- Push notification (Expo Notifications / FCM)
- Offline-first dengan optimistic update
