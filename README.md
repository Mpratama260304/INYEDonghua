# INYE Donghua — SEO Mirror Proxy

Reverse proxy berbasis Vinext/Cloudflare Worker untuk memirror
`https://donghua.ipkzone.my.id` melalui ChatGPT Sites.

Situs aktif:

- `https://seo-mirror-donghua.mpratama2603.chatgpt.site`

## Fitur

- Meneruskan semua path, query, metode request, halaman, dan aset ke origin.
- Menulis ulang URL origin di HTML, CSS, XML, JSON-LD, redirect, serta header.
- Membuat satu canonical absolut sesuai domain mirror.
- Membersihkan parameter `utm_*`, `fbclid`, `gclid`, dan parameter tracking lain dengan redirect 308.
- Memperbaiki posisi breadcrumb JSON-LD dan membuat breadcrumb dasar bila belum tersedia.
- Menghapus blok JSON-LD yang tidak dapat diurai.
- Mempertahankan respons 404/410 dan menambahkan `noindex` untuk mencegah soft-404.
- Menyediakan `/robots.txt`, `/sitemap.xml`, dan `/healthz`.
- Mendeteksi sitemap origin dari `/sitemap.xml`, `/sitemap_index.xml`, atau `/wp-sitemap.xml`.
- Menulis ulang seluruh `<loc>` sitemap agar memakai domain mirror.

## Struktur utama

Implementasi proxy dan transformasi SEO berada di:

```text
app/[[...path]]/route.ts
```

Origin dikonfigurasi pada konstanta berikut:

```ts
const ORIGIN = new URL("https://donghua.ipkzone.my.id");
```

## Menjalankan secara lokal

Persyaratan:

- Node.js 22.13 atau lebih baru
- npm

```bash
npm ci
npm run dev
```

Build produksi:

```bash
npm run build
npm run validate:artifact
```

## Endpoint

| Endpoint | Fungsi |
|---|---|
| `/healthz` | Health check JSON |
| `/robots.txt` | Aturan crawler dan URL sitemap mirror |
| `/sitemap.xml` | Sitemap origin yang telah ditulis ulang |
| `/*` | Full reverse proxy ke path origin yang sama |

Header `x-sitemap-source` pada `/sitemap.xml` menunjukkan sitemap origin yang
berhasil ditemukan. Nilai `fallback-homepage-only` berarti tidak ada kandidat
sitemap origin yang dapat diambil.

## Catatan SEO

Canonical merupakan sinyal, bukan jaminan Google akan mengindeks domain mirror.
Jika origin dan mirror sama-sama publik dengan konten identik, Google masih dapat
memilih origin sebagai canonical. Untuk migrasi domain penuh, gunakan redirect
permanen dari origin ke domain baru. Untuk dua website yang tetap aktif, berikan
konten atau nilai yang benar-benar berbeda pada mirror.

## Deployment

Repository ini memakai format ChatGPT Sites/Vinext. Identitas Sites berada di
`.openai/hosting.json`, sementara build menghasilkan Worker ESM pada
`dist/server/index.js`.

Gunakan proyek ini hanya untuk website yang Anda miliki atau memiliki izin untuk
diproxy. Pastikan penggunaan video, gambar, dan konten pihak ketiga mematuhi hak
cipta serta ketentuan layanan sumber.
