// =========================================================================
// PENGATURAN APLIKASI CLIENT PORTAL
// Silakan ubah teks di dalam tanda kutip ("...") dengan data studio Anda.
// =========================================================================

const CONFIG_APP = {
    // 1. Nama Studio Foto Anda (Akan tampil di header dan portal klien)
    //    Jika mode server aktif, nama ini bisa diubah dari generatorLink (Pengaturan Studio)
    //    dan nilai di sini hanya menjadi cadangan.
    //namaVendor: "Portal Client",

    // 2. Google Drive API Key (Penting agar galeri bisa memuat foto)
    //googleApiKey: "AIzaSyAZczbLeVTXl-QKqLDJFWQLCd-lW9jqqxo",

    // 3. URL Server (Google Apps Script Web App) - OPSIONAL
    //    Isi dengan URL hasil Deploy > Web app dari Code.gs (lihat PANDUAN_SERVER.md).
    //    Jika diisi: pilihan klien tersimpan otomatis ke Google Sheet, batas waktu dicek
    //    oleh server, dan link ke klien menjadi pendek (?c=KODE).
    //    Jika dikosongkan (""): aplikasi berjalan seperti biasa tanpa server.
    urlServer: "https://script.google.com/macros/s/AKfycbzIllAVa5NaIJcQt1fR0OhUo-UdXsrChEJUnkjKtliFPrKP6QW6U5X81ig6P6UrIOZL/exec",

    // 4. Nomor WA admin (penerima list foto). Format 628xxx.
    //    Jika mode server aktif, nomor ini bisa diubah dari generatorLink (Pengaturan Studio)
    //    dan nilai di sini hanya menjadi cadangan.
    //whatsappAdmin: "62821000000000" // <-- Ganti dengan nomor WA admin
};
