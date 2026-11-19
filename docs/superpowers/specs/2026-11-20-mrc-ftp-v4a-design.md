# MRC FTP sürüm 4a — Tasarım

Tarih: 2026-11-20 · Durum: kullanıcı "4a bitir" dedi, onay beklenmeden uygulanıyor · Önceki: sürüm 1–3 tasarımları

4b (klasör eşitleme, sekmeler) ayrı tasarımdır. Bulut servisleri ve cihazlar arası eşitleme kapsam dışıdır.

## Özellikler

### 1. Eşzamanlı aktarım
Kuyruk aynı anda en çok **3** dosya aktarır; her biri kendi bağlantısını kullanır. Ayar yoktur.
- Sunucu fazladan bağlantıyı reddederse (bağlantı sınırı) uygulama sessizce daha az bağlantıyla sürer.
- Aynı hedefe giden iki iş aynı anda çalışmaz (geçici dosya çakışmasın).
- Yanlış şifrede yine tek giriş denemesi yapılır.

### 2. Hız sınırı
Aktarım panelinin başlığında bir seçim: Sınırsız · 100 KB/sn · 500 KB/sn · 1 MB/sn · 5 MB/sn. Sınır tüm eşzamanlı aktarımların toplamına uygulanır ve hatırlanır. Yeni sınır sıradaki dosyadan itibaren geçerlidir.

### 3. Sık kullanılan klasörler
Bağlıyken üst çubukta **"Sık kullanılanlar"** düğmesi: "Bu klasörü ekle / çıkar" ve o sitenin kayıtlı klasörleri; tıklayınca sunucu paneli oraya gider. Liste siteyle birlikte saklanır.

### 4. Toplu ad değiştirme
Sunucu panelinde birden çok öğe seçiliyken sağ tık › **"Toplu yeniden adlandır…"**.
- "Bul" doluysa: adlarda bul → değiştir.
- "Bul" boşsa: "Değiştir" yeni ad kalıbıdır, uzantı korunur.
- İki durumda da `{n}` sıra numarasıdır (seçim sayısına göre başına sıfır eklenir).
- Pencere eski → yeni adları önceden gösterir. Çakışan, boş kalan ya da `/` içeren ad varsa "Uygula" kapalıdır.

## Olmaması gerekenler
- Eşzamanlılık yüzünden bozuk ya da karışmış dosya.
- Toplu ad değiştirmenin var olan bir dosyanın üzerine yazması.
- Bağlantı sınırı düşük sunucuda aktarımların hata vermesi.

## Benim kararlarım
- Kuyruk, listeleme/taşıma gibi küçük işler için ayrı bir bağlantı tutar: aktarım başına 1 + 1 (en çok 4), gezinme ve terminalle birlikte en çok 6.
- Hız sınırı gezinme oturumundaki düzenleme/önizleme indirmelerine uygulanmaz.
- Toplu ad değiştirme yalnızca sunucu panelinde.
