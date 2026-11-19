# MRC FTP sürüm 3 — Tasarım

Tarih: 2026-11-19 · Durum: onay bekliyor · Önceki: sürüm 1 ve sürüm 2 tasarımları (geçerliliğini korur)

## Amaç

SSH erişimi olan hostinglere SFTP ile bağlanmak ve aynı pencereden sunucuda komut çalıştırmak. Dosya tarafında kullanıcı FTP ile SFTP arasında fark görmez; terminal yalnızca SFTP sitelerinde vardır.

Sürüm 4 (eşzamanlı aktarım, sekmeler, eşitleme, toplu ad değiştirme, hız sınırı, sık kullanılanlar) ayrı tasarımdır. Bulut servisleri ve cihazlar arası eşitleme kapsam dışıdır.

## Özellikler

### 1. SFTP bağlantısı

Site penceresindeki "Şifreleme" alanı **"Bağlantı"** olur: SFTP (SSH) · FTPS (önerilen) · Düz FTP. SFTP seçilince port 22'ye, diğerlerinde 21'e döner (kullanıcı elle değiştirmişse dokunulmaz).

Sürüm 1 ve 2'deki her şey SFTP'de de çalışır: listeleme, yükleme/indirme, güvenli yazma (geçici ada yaz, sonra taşı), yarıda kalanı sürdürme, izinler, kendi editöründe düzenleme, Hızlı Bakış, seçilen klasöre indirme.

### 2. Giriş: şifre ya da SSH anahtarı

SFTP seçilince "Giriş" alanı çıkar: **Şifre** · **SSH anahtarı**.

- Anahtar: "Anahtar dosyası seç…" ile dosya seçilir (varsayılan klasör `~/.ssh`). Uygulama yalnızca dosyanın yolunu saklar, anahtarı kopyalamaz.
- Anahtar parolalıysa parola alanı doldurulur; şifreler gibi Anahtar Zinciri korumasıyla saklanır. Boş bırakılırsa bağlanırken sorulur.
- Anahtar dosyası bulunamaz ya da okunamazsa bağlanmadan önce açıkça söylenir.

### 3. Sunucu kimliği

FTPS'teki davranışın aynısı: ilk bağlantıda sunucunun anahtar parmak izi (SHA-256) gösterilir, kullanıcı "Bu siteye güven ve bağlan" derse saklanır. Sonraki bağlantılarda parmak izi değişmişse uygulama bağlanmaz ve sorar. Şifre ya da anahtar, sunucu kimliği onaylanmadan gönderilmez.

### 4. Terminal

SFTP sitesine bağlıyken üst çubukta **"Terminal"** düğmesi görünür (kısayol ⌃`). Düğme, iki panelin altında koyu bir terminal paneli açar/kapatır. Panelin üst kenarı sürüklenerek yüksekliği ayarlanır.

- Terminal, sunucu panelinde o an açık olan klasörde başlar.
- Panel başlığında **"Ayır"**: terminal kendi penceresine çıkar. O pencere kapatılınca ya da "Geri tak" denince alta döner. Ayırıp takarken oturum kopmaz, ekrandaki geçmiş korunur.
- Paneli kapatmak oturumu bitirmez, gizler; oturum bağlantı kesilince, site değişince ya da kabukta `exit` yazılınca biter. Bittiğinde panel "Oturum kapandı · Yeniden başlat" gösterir.
- Kopyala/yapıştır (⌘C / ⌘V), pencere boyutuna uyum, renkler ve tam ekran programlar (nano, vim, top) çalışır.
- Tek terminal oturumu vardır.
- Sunucu kabuk erişimi vermiyorsa (cPanel'de sık: SFTP açık, kabuk kapalı) panel bunu düz bir cümleyle söyler; dosya işlemleri etkilenmez.

## Olmaması gerekenler

- Sunucu kimliği doğrulanmadan şifre, anahtar ya da anahtar parolası gönderilmesi.
- Anahtar dosyasının ya da parolasının düz metin olarak diske yazılması, kayda geçmesi.
- Terminalde görünen sunucu çıktısının uygulamada bir şey çalıştırabilmesi (bağlantı açma, dosya açma). Bağlantılar tıklanabilir olmaz.
- SFTP eklenirken FTP/FTPS davranışının bozulması: mevcut 62 test aynen geçer.

## Yaklaşımlar

1. **`ssh2` + `xterm.js` (seçilen).** `ssh2` saf JavaScript, SFTP ve kabuk kanalını tek kütüphanede verir, içinde test için SSH sunucusu da var. `xterm.js` VS Code'un terminali. İki yeni çalışma zamanı bağımlılığı.
2. **Sistemdeki `ssh`/`sftp` komutlarını çalıştırmak.** Bağımlılık yok, ama terminal için yerel derlenen `node-pty` gerekir, ilerleme ve hata okuma metin ayrıştırmaya kalır, parmak izi kontrolü elimizden çıkar.
3. **Terminali Terminal.app'te açmak.** En az iş, ama "aynı pencerede" isteğini karşılamaz ve şifreyle girişte şifre yeniden sorulur.

## Benim kararlarım

- Aktarım kuyruğu bugün FTP kütüphanesini doğrudan çağırıyor. Araya küçük bir ortak oturum arayüzü girer (listele, klasör aç, taşı, sil, izin ver, boyut sor, indir/yükle + başlangıç baytı + ilerleme); FTP ve SFTP bunu ayrı ayrı uygular. Kuyruk, düzenleme ve önizleme yalnızca bu arayüzü bilir.
- Gezinme, aktarım kuyruğu ve terminal ayrı SSH bağlantıları kullanır (bugünkü FTP düzeniyle aynı); biri takılınca diğerleri etkilenmez.
- Terminal oturumu ana süreçte yaşar ve son çıktıyı (yaklaşık 1 MB) tutar; ayır/geri tak bu çıktıyı yeni görünüme yeniden yazar.
- ssh-agent, `~/.ssh/config` okuma, atlama sunucusu, port yönlendirme, birden çok terminal sekmesi ve terminal tema ayarı yok.
- `xterm.js` stil enjekte ettiği için içerik güvenlik kuralı gevşetilmek zorunda kalırsa yalnızca stil kuralı gevşetilir; betik kuralı aynı kalır.
- Kontrol: SFTP listeleme, aktarım, sürdürme, izin, parmak izi (ilk/aynı/değişmiş), anahtarla ve parolalı anahtarla giriş, kabuk reddi ve terminal oturumu (yaz-oku, boyut, ayır/tak sonrası geçmiş) yerel test SSH sunucusuna karşı testlidir. Panel, ayırma ve klavye çalışan uygulamada betikle doğrulanır.

## Yapana kalanlar

Dosya bölünmesi, arayüzün tam imzaları, `xterm.js`'in paketleyicisiz yüklenme biçimi, terminal renk paleti (Sakin'in koyu tonlarından).
