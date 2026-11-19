# MRC FTP — Tasarım

Tarih: 2026-11-19 · Durum: onay bekliyor

## Amaç ve neden

MacBook'ta cPanel hostinglerine zahmetsizce bağlanıp dosya yükleyip indirmek için sade, güzel arayüzlü, açık kaynak bir masaüstü istemcisi. `.dmg` olarak kurulur. Mevcut istemciler (FileZilla, Cyberduck) işi yapıyor ama kalabalık; burada hedef az seçenekli, yormayan bir araç.

Kullanıcının söyledikleri: macOS, cPanel hostingleri, `.dmg`, basit ve güzel arayüz, açık kaynak, asıl iş dosya yükleme/indirme, ileride PuTTY benzeri terminal. Geri kalan her şey aşağıda "benim kararım" olarak işaretli.

## Hedefler (1. sürüm)

- FTP ve açık (explicit) FTPS ile bağlanmak. cPanel'in varsayılanı budur.
- Kayıtlı siteler: ad, sunucu, port, kullanıcı, şifre, başlangıç klasörü. Tek tıkla bağlan.
- Çift panel: solda Mac, sağda sunucu. Klasörlerde gezinme, ada/boyuta/tarihe göre sıralama.
- Aktarım: paneller arası sürükle-bırak, Finder'dan sunucu paneline sürükle-bırak, çift tıkla aktar. Klasörler iç içe aktarılır.
- Aktarım kuyruğu: ilerleme, hız, iptal, hata durumunda yeniden dene.
- Sunucuda temel dosya işleri: yeniden adlandır, sil (onay sorar), yeni klasör.
- Aynı adlı dosya varsa sorar: üzerine yaz / atla / hepsine uygula.
- `.dmg` çıktısı (Apple Silicon).

## Kapsam dışı (1. sürüm)

- SFTP ve SSH terminali. İkisi de aynı kütüphaneyi (`ssh2`) kullanır; birlikte 2. aşamada gelir.
- Uzaktan dosya düzenleme, senkronizasyon, dosya izinleri (chmod), yer imleri, sekmeler.
- Sunucu panelinden Finder'a sürükleyerek indirme (indirme sol paneldeki klasöre yapılır).
- Otomatik güncelleme, Apple imzası/noter onayı, Intel Mac derlemesi, Windows/Linux.
- İngilizce arayüz.

## Olmaması gerekenler

- Sertifika doğrulamasını sessizce kapatmak.
- Şifreleri düz metin olarak diske yazmak.
- FileZilla tarzı kalabalık araç çubukları ve ayar ekranları.
- Yarım kalan aktarımın başarılı görünmesi.

## Kısıtlar

- Makinede Node 22 ve Xcode 27.2 var; Rust yok.
- Apple Developer hesabı varsayılmıyor: uygulama imzasız olur. Kendi Mac'inde derlenince sorunsuz açılır; başkasına verilen `.dmg` ilk açılışta Gatekeeper uyarısı verir.
- Paylaşımlı cPanel sunucularında sertifika çoğu zaman bağlanılan alan adıyla eşleşmez (sertifika sunucunun kendi adınadır).

## Yaklaşımlar

| Yol | Artısı | Bedeli |
|---|---|---|
| **A — Electron + `basic-ftp` (+ sonra `ssh2`, `xterm.js`)** | FTPS olgun kütüphaneyle çözülü; terminal sonradan kolay; Node hazır | ~100 MB uygulama, tam yerli his değil |
| B — Yerli SwiftUI + gömülü libcurl | Küçük, hızlı, yerli görünüm | Apple'ın FTPS API'si yok, bakımlı Swift kütüphanesi yok; sistem curl'ünde şifreli veri kanalı sorunları raporlanmış |
| C — LoFTP/macSCP çatalı (MIT) | Özellikler hazır | Devralınan kod, incelenmemiş kalite |

**Seçilen: A** (kullanıcı seçti). Gerekçe: zor kısım hazır kütüphanede, emek arayüze gider.

## Nasıl çalışır

**Ekran ("Sakin" tasarımı, kullanıcı seçti).** Görsel referans: `docs/tasarim/mrc-ftp-sakin.html`. Tek pencere, soldan sağa dört bölge:

1. Kenar çubuğu: kayıtlı siteler (bağlı olanın yanında yeşil nokta) ve altta "+ Yeni site".
2. Mac paneli ve 3. Sunucu paneli: üstte tıklanabilir yol çubuğu, altında Ad / Boyut / Değişti sütun başlıkları (tıklayınca sıralar). İki panelin üstünde ortak bir çubuk: site adı, "Şifreli bağlantı" rozeti (düz FTP'de "Şifresiz" uyarı rozeti), "Yeni klasör" ve "Yenile".
4. Aktarım paneli (sağda): yalnızca aktarım varken görünür, hepsi bitince kendiliğinden kapanır ve iki panel tam genişliğe döner.

Altta ince durum satırı (öğe sayıları). Bağlı değilken sunucu paneli "Bir site seç" boş durumunu gösterir. Pencere sistemin açık/koyu temasını izler.

**Aktarım paneli.** Yukarıdan aşağıya: toplam ilerleme (kaç işten kaçı bitti, yüzde, kalan süre); süren aktarım (boyut, hız, kalan süre, iptal); soru kartları; hata kartları; "Sırada"; "Biten". Aynı adlı dosya sorusu (üzerine yaz / atla / hepsine uygula) ve "Yeniden dene" bu panelde kart olarak çıkar, ayrı pencere açılmaz. Soru bekleyen iş kuyruğu tutmaz: sıradaki işler sürer, soru yanıtlanınca o iş kuyruğa döner. Yüklenen dosya ayrıca sunucu panelinde, gideceği yerde soluk bir satır olarak ilerlemesiyle görünür.

**Bağlanma.** Varsayılan: FTPS (explicit TLS), port 21, pasif mod. Site formunda şifreleme seçeneği: "FTPS (önerilen)" veya "Düz FTP (şifresiz)". Düz FTP seçilince şifrenin açık gittiği tek satırla belirtilir.

**Sertifika uyuşmazlığı.** Doğrulama başarısız olursa bağlantı kurulmaz; kullanıcıya sertifikanın kime ait olduğu ve parmak izi gösterilir: "Bu sertifikaya bu site için güven" / "Vazgeç". Güvenilirse parmak izi siteyle birlikte saklanır ve sonraki bağlantılarda yalnızca o parmak izi kabul edilir. Parmak izi değişirse yeniden sorulur.

**Kimlik bilgileri.** Site listesi uygulamanın veri klasöründe bir JSON dosyasında durur. Şifreler Electron `safeStorage` ile (macOS Keychain destekli) şifrelenip öyle yazılır. `safeStorage` kullanılamıyorsa şifre kaydedilmez, her bağlantıda sorulur.

**Aktarım.** Sunucuya iki bağlantı açılır: biri gezinme, biri aktarım için; böylece aktarım sürerken klasörlerde gezilebilir. Kuyruk sırayla, tek tek işler. Bağlantı koparsa aktarım "hata" olur, yeniden dene ile baştan başlar.

**Güvenlik sınırı.** Arayüz (renderer) Node'a doğrudan erişmez: `contextIsolation` açık, `nodeIntegration` kapalı; FTP ve dosya işlemleri ana süreçte, dar bir `preload` köprüsü üzerinden çağrılır. Uzak içerik yüklenmez.

## Benim kararlarım (kullanıcı ayrıca söylemedi)

- Arayüz dili Türkçe.
- Arayüz çatısı yok: düz HTML/CSS/JS, paketleyici yok. Karmaşıklık artarsa eklenir.
- Paketleme: `electron-builder`, yalnızca arm64 `.dmg`.
- Lisans: MIT.
- Uygulama adı: "MRC FTP".
- Aynı anda tek aktarım.
- Kontrol: aktarım mantığı için yerel bir test FTP sunucusuna (`ftp-srv`, yalnızca geliştirme bağımlılığı) karşı çalışan tek bir test dosyası: yükle, indir, klasör, üzerine yazma sorusu, iptal.

- Sertifika sorusu her doğrulama hatasında çıkar (ad uyuşmazlığı, kendinden imzalı, güvenilmeyen zincir, süresi dolmuş); pencere hatanın nedenini açıkça yazar.
- Aynı ad sorusu iki yönde de geçerlidir (yükleme ve indirme). Klasörler birleştirilir; çakışan her dosya için panelde soru kartı çıkar, "hepsine uygula" seçilirse bir daha sormaz.
- Mac panelinde yalnızca gezinme ve aktarım var; yerel silme/yeniden adlandırma yok (Finder yapar).
- Yarım dosya bırakılmaz: aktarım geçici bir ada (`ad.mrcftp-part`) yazılır, bitince asıl ada taşınır. Hata veya iptalde geçici dosya silinir; asıl dosya aktarım bitene kadar dokunulmadan kalır.
- `.dmg` öncelikle kendi Mac'in için. Ad-hoc imzalanır; başkaları için README'de ilk açılış adımı yazılır. Apple noter onayı kapsam dışı.
- Taslaktaki renkler ve aralıklar uygulamada da kullanılır; yazı tipi Mac'in sistem yazı tipidir (taslaktaki Inter yerine; ek dosya gerektirmez, yerli görünür). Taslakla bu belge çelişirse belge geçerlidir.
- Uygulama simgesi 1. sürümde yok (Electron'un varsayılanı).

## Yapana bırakılanlar

- Dosya/klasör düzeni ve IPC kanal adları.
- Görsel ayrıntılar (aralıklar, simgeler), onaylanan taslağa sadık kalarak.
- Büyük klasör listelerinde performans önlemi gerekip gerekmediği.

## 2. aşama (ayrı tasarım)

SFTP ve SSH terminali (`ssh2` + `xterm.js`). PuTTY açık kaynaktır; tersine mühendislik gerekmez.
