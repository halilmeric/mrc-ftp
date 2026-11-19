# MRC FTP

cPanel hostinglerine bağlanıp dosya yüklemek ve indirmek için sade bir macOS FTP/FTPS istemcisi.

- Solda Mac, sağda sunucu; sürükleyip bırak ya da çift tıkla.
- Aktarımlar sağdaki panelde: ilerleme, iptal, yeniden dene, aynı adlı dosya sorusu.
- Şifreler macOS Keychain destekli şifrelemeyle saklanır.
- Sunucu sertifikası doğrulanamazsa bağlanmadan önce sorar; şifre ondan önce gönderilmez.
- Yarım dosya bırakmaz: aktarım geçici bir ada yazılır, bitince asıl ada taşınır.
- Bağlantı koparsa "Yeniden dene" kaldığı yerden sürdürür.
- Sunucudaki dosyayı kendi editöründe düzenle: sağ tık › Düzenle; her kayıtta geri yüklenir, dosya sunucuda değiştiyse önce sorar.
- Dosya izinleri (chmod): sağ tık › Bilgi ve izinler.
- Boşluk tuşuyla Hızlı Bakış; ok tuşları ve Enter ile gezinme.

## Geliştirme

```bash
npm install
npm start      # uygulamayı aç
npm test       # testler (yerel bir test FTP sunucusuna karşı)
npm run dist   # dist/ altında .dmg üret (Apple Silicon)
```

Elle denemek için yerel test sunucusu: `node test/helpers/server.js --tls --port 2121` (kullanıcı `test`, şifre `test`).

## Kurulum

`dist/` altındaki `.dmg` dosyasını aç, MRC FTP'yi Uygulamalar klasörüne sürükle.

Uygulama Apple tarafından imzalanmamıştır (yalnızca ad-hoc imza). Derlendiği Mac'te doğrudan açılır. Başka bir Mac'te ilk açılışta macOS engeller: **Sistem Ayarları › Gizlilik ve Güvenlik › Yine de aç**.

## Yol haritası

Sırada: SFTP, SSH anahtarı ve terminal; ardından eşzamanlı aktarım, sekmeler ve klasör eşitleme.

## Lisans

MIT
