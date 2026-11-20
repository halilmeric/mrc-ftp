# MRC FTP — Ayarlar paneli (özellik anahtarları)

## Amaç
Arayüzü sadeleştirmek: kullanıcı kullanmadığı özelliği kapatır, o özelliğin düğmesi, menü maddesi ve kısayolu görünmez olur. Güvenlik kilidi değildir.

## Yaklaşımlar
- **A. Ana pencere içinde panel (seçildi):** mevcut `<dialog>` düzeniyle açılır; en az kod, görünüm aynı kalır.
- **B. Ayrı Ayarlar penceresi:** macOS'e daha uygun ama yeni pencere, yeni sayfa ve sekme çubuğundan ayırma gerekir; altı anahtar için fazla.

## Davranış
- Açılış: ⌘, ve uygulama menüsünde "Ayarlar…". Etkin sekmede açılır.
- Anahtarlar (hepsi açık gelir):
  | Anahtar | Kapalıyken |
  |---|---|
  | Terminal | Terminal düğmesi ve ⌃` çalışmaz; açık panel/ayrı pencere kapanır, kabuk oturumu sonlanır |
  | Sık kullanılanlar | "Sık kullanılanlar" düğmesi görünmez (kayıtlı liste silinmez) |
  | Eşzamanlı aktarım | Dosyalar tek tek aktarılır |
  | Sunucuda düzenleme | Sağ tık menüsünde "Düzenle" yok |
  | Toplu yeniden adlandırma | Sağ tık menüsünde "Toplu yeniden adlandır…" yok |
  | Hızlı Bakış | Boşluk tuşu önizleme açmaz |
- Değişiklik anında uygulanır, tüm sekmelere yansır, uygulama kapanınca hatırlanır.
- İstisna: "Eşzamanlı aktarım" bir sonraki bağlantıdan itibaren geçerlidir; panelde bu not yazar.
- Hız sınırı aktarım panelinde kalır.

## Nasıl
- Saklama: `localStorage['mrc.features']` (kapalı olanların listesi) + `storage` olayı; hız sınırıyla aynı düzen.
- Saf işlev `features(raw)` → `{terminal, favorites, parallel, edit, batch, preview}`; bozuk ya da eksik değer = hepsi açık. Test edilir.
- `connect` çağrısına `parallel` (1 ya da 3) eklenir; ana süreç yalnızca bu iki değeri kabul eder.
- Menü: ana süreç etkin pencereye `settings:open` gönderir.

## Kapsam dışı
Site başına ayar, kısayol özelleştirme, tema, çekirdek özellikleri (aktarım, izinler, SFTP/FTPS, sekmeler) kapatma.
