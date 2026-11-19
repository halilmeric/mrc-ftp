# MRC FTP sürüm 2 — Tasarım

Tarih: 2026-11-19 · Durum: onay bekliyor · Önceki: `2026-11-19-mrc-ftp-design.md` (sürüm 1, geçerliliğini korur)

## Amaç

Sürüm 1 dosya yükleyip indiriyor. Sürüm 2, cPanel'de günlük işte en çok eksikliği hissedilen beş şeyi ekler; arayüz sade kalır, yeni bir panel ya da araç çubuğu gelmez.

Sürüm 3 (SFTP, SSH anahtarı, terminal) ve sürüm 4 (eşzamanlı aktarım, sekmeler, eşitleme, toplu ad değiştirme, hız sınırı, sık kullanılanlar) ayrı tasarımlardır. Bulut servisleri ve cihazlar arası eşitleme kapsam dışıdır (kullanıcı kararı).

## Özellikler

### 1. İzinler ve bilgi

Sunucu panelinde sağ tık › **"Bilgi ve izinler…"**. Pencere: tam yol, boyut, değişme tarihi; altında Sahip / Grup / Herkes × Oku / Yaz / Çalıştır onay kutuları ve yanında sayı alanı (`644`). İkisi birbirini günceller. **"Uygula"** `SITE CHMOD` yollar.

- Mevcut izin sunucu listesinden okunur. Okunamıyorsa pencere bunu söyler ve kutular boş başlar; kullanıcı yine de izin verebilir.
- Sunucu komutu reddederse hata pencerede gösterilir.
- Alt klasörlere toplu uygulama yok.

### 2. Sunucudaki dosyayı kendi editöründe düzenleme

Sağ tık › **"Düzenle"** (yalnızca dosyalarda).

1. Dosya uygulamanın geçici klasörüne iner ve Mac'teki varsayılan uygulamayla açılır.
2. Uygulama dosyayı izler. Her kaydedişte dosya sunucuya geri yüklenir; yükleme aktarım panelinde görünür.
3. Yüklemeden önce sunucudaki dosyaya bakılır. İndirdiğimizden beri değişmişse yükleme durur ve panelde sorar: **"Dosya sen düzenlerken sunucuda değişmiş"** › Üzerine yaz / Atla.
4. Alt durum satırında "N dosya düzenleniyor · Bitir" görünür. "Bitir" izlemeyi durdurur; geçici kopyalar bağlantı kesilince, site değişince ya da uygulama kapanınca silinir. Bunlardan biri yapılırken sunucuya gitmemiş bir düzenleme varsa önce sıradaki yüklemeler beklenir, yine de kalan olursa uygulama sorar.
5. Açıldığında çalışan dosya türleri (`.terminal`, `.webloc`, `.pkg`, `.command` vb.) düzenlemeye açılmaz.

- Sınır: 10 MB üstü dosyalar düzenlemeye açılmaz ("Düzenlemek için çok büyük, önce indir").
- Geri yükleme sürüm 1'deki güvenli yolu kullanır (geçici ada yaz, sonra taşı).
- Kaydedilmemiş son değişiklik "Bitir"de kaybolmaz: bekleyen yükleme varsa önce o biter.

### 3. Yarıda kalan aktarımı sürdürme

Bağlantı koparsa geçici dosya (`.mrcftp-part`) artık silinmez. **"Yeniden dene"** kaldığı bayttan devam eder; ilerleme çubuğu oradan başlar.

- Kaynak dosya arada değişmişse (boyut ya da tarih farklı) baştan başlar.
- **"İptal"** geçici dosyayı yine siler.
- Hata kartı kapatılırsa ya da bağlantı kesilirse yarım geçici dosya temizlenir.
- Sunucu devam etmeyi desteklemiyorsa sessizce baştan başlar.

### 4. Seçilen klasöre indirme

Sunucu panelinde sağ tık › **"İndirilenler'e indir"** ve **"Farklı indir…"** (klasör seçme penceresi). Sunucudan Finder'a sürükleme yapılmaz: Electron, macOS'in bunun için kullandığı mekanizmayı sunmuyor.

### 5. Hızlı Bakış ve klavye

Seçili dosyada **boşluk** tuşu macOS Hızlı Bakış'ı açar. Mac panelinde doğrudan; sunucu panelinde dosya önce geçici klasöre iner (sınır 50 MB).

Bunun için panellere klavye desteği gelir: yukarı/aşağı ok seçimi taşır, Enter klasöre girer ya da dosyayı aktarır, boşluk önizler.

## Olmaması gerekenler

- Düzenlenen dosyanın, kullanıcı görmeden sunucudaki daha yeni bir sürümün üzerine yazılması.
- Sürdürülen aktarımın bozuk dosya üretmesi (kaynak değiştiği halde eklenmesi).
- Geçici klasörde site dosyalarının kalıcı olarak birikmesi.

## Benim kararlarım

- Sunucu menüsü sırası: Düzenle · İndirilenler'e indir · Farklı indir… · Bilgi ve izinler… · Yeniden adlandır · Sil.
- İzleme, editörlerin "yeni dosya yazıp eskisinin yerine koyma" kaydetme biçiminde de çalışsın diye dosya değişim zamanına saniyede bir bakarak yapılır.
- Düzenleme ve önizleme indirmeleri gezinme oturumu üzerinden yapılır, kuyruğa girmez; geri yüklemeler kuyruğa girer.
- Kontrol: izin sayı/kutu dönüşümü, chmod, sürdürme (yükleme ve indirme, kaynak değişince baştan başlama) ve "sunucuda değişmiş" tespiti test sunucusuna karşı testlidir; pencere ve klavye davranışı çalışan uygulamada betikle doğrulanır.

## Ayrı iş: Apple imzası

Kullanıcının Apple Developer hesabı var; bu Mac'te "Developer ID Application" sertifikası ve noter kimlik bilgisi henüz yok. İkisi hazır olunca paketleme ayarına eklenir. Sürüm 2'yi beklemez, sürüm 2 de onu beklemez.
