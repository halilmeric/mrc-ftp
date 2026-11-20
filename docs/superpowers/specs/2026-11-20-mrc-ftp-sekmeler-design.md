# MRC FTP sekmeler — Tasarım

Tarih: 2026-11-20 · Durum: onay bekliyor · Önceki: sürüm 1–4a tasarımları

## Amaç

Aynı anda birden çok siteye bağlı kalmak: bir sitede aktarım sürerken diğerinde çalışmak, bağlantıları koparmadan aralarında geçmek.

Kapsam dışı: aynı sitenin klasörleri için sekmeler, klasör eşitleme (iptal edildi), bulut servisleri, cihazlar arası eşitleme.

## Davranış

- Her sekme bir sitedir ve tam bağımsızdır: kendi Mac/sunucu panelleri, aktarım kuyruğu, düzenlenen dosyaları ve terminali vardır.
- Sekmeler macOS'in kendi pencere sekmeleridir (Safari ve Finder'daki gibi): sekme çubuğu, ⌘⇧[ / ⌘⇧] ile geçiş, sekmeyi sürükleyip ayrı pencere yapma ve geri birleştirme sistemden gelir.
- **Yeni sekme:** ⌘T, sekme çubuğundaki "+" ya da Dosya › Yeni Sekme. Yeni sekme bağlı olmadan, site listesiyle açılır.
- **Siteyi yeni sekmede açma:** site listesinde ⌘-tık ya da sağ tık › "Yeni sekmede aç". Düz tık bugünkü gibi o sekmedeki siteyi değiştirir.
- Sekme başlığı bağlı sitenin adıdır; bağlı değilken "MRC FTP".
- Aynı site iki sekmede açılabilir; iki ayrı bağlantı olur.
- Bir sekmeyi kapatmak yalnızca o sitenin bağlantısını keser. Yüklenmemiş düzenleme varsa bugünkü soru o sekme için sorulur.
- Site listesi ortaktır: bir sekmede eklenen, düzenlenen ya da silinen site diğer sekmelerde de güncellenir. Başka bir sekmede bağlı olan site silinemez; uygulama bunu söyler.
- Hız sınırı ortaktır ve tüm sekmelerin toplamına uygulanır.
- Uygulama yeniden açıldığında sekmeler geri gelmez; tek, bağlı olmayan pencereyle başlar.

## Görünen bedel

macOS sekme çubuğu bizim gizli başlık çubuğumuzla birlikte kullanılınca arayüzün üstünü örtüyor (denemeyle ölçüldü: içerik alanı küçülmüyor). Bu yüzden pencere standart macOS başlık çubuğuna geçer: üstte ince bir başlık şeridi belirir, trafik ışıkları oraya taşınır, sol sütunun üstündeki boşluk kalkar.

## Olmaması gerekenler

- Bir sekmedeki işlemin başka sekmenin bağlantısına gitmesi (yanlış siteye yükleme ya da silme).
- Bir sekmenin bağlantısı kesilince başka sekmenin düzenlenen dosyalarının ya da önizleme kopyalarının silinmesi.
- Bir sekme kapanınca diğerlerinin aktarımının durması.

## Yaklaşımlar

1. **macOS pencere sekmeleri (seçilen).** Site başına bir pencere, sistem bunları sekme yapar. Arayüz kodu neredeyse aynen kalır; değişen, ana süreçte bağlantı durumunun pencere başına tutulmasıdır.
2. Pencere içinde kendi sekme şeridimiz: görünüm bizim olur, ama tüm arayüz sekme başına çoğaltılacak şekilde yeniden yazılır.
3. Tek pencerede gömülü görünümler: kendi şeridimiz, ama sürükleyip ayırma gibi davranışlar elle yazılır.

## Benim kararlarım

- Arayüzden gelen her istek, geldiği pencerenin bağlantısına yönlendirilir; ayrılmış terminal penceresi ana penceresinin bağlantısını kullanır.
- Geçici dosyalar (düzenleme, önizleme) pencere başına ayrı klasörde durur.
- Yeni pencere, o an öndeki pencereye sekme olarak eklenir (sistemdeki "sekmeleri tercih et" ayarından bağımsız).
- Kontrol: pencere yönlendirmesi ve yalıtım, iki sekme iki ayrı test sunucusuna bağlıyken çalışan uygulamada betikle doğrulanır (ana süreç Electron'a bağlı olduğu için birim testi yok); mevcut 107 test aynen geçer.
