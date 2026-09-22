# NOTICE — происхождение кода и бинарных библиотек

## 1. oldweipro/hik-isup (Apache-2.0)

Часть исходного кода этого сервиса (JNA-биндинги `HCISUPCMS` / `HCISUPAlarm`,
структуры SDK, схема инициализации listen-серверов, Dockerfile-подход)
адаптирована из открытого проекта:

- **Проект:** https://github.com/oldweipro/hik-isup
- **Лицензия:** Apache License 2.0
- **Автор:** oldweipro

Оригинальные заголовки/комментарии в скопированных файлах сохранены там,
где они были. Изменения: пакет переименован в `kg.uniqum.isup.sdk`,
удалены неиспользуемые методы/структуры, добавлены комментарии.

## 2. Официальный ACS-демо Hikvision (ISUPSDK_JAVA_DEMO_ACS)

Код загрузки лиц (ISAPI-passthrough, `AcsFaceManagement`) и JSON-шаблоны
запросов в `src/main/resources/conf/acs/` адаптированы из демо-проекта:

- **Проект:** https://github.com/3395207/ISUPSDK_JAVA_DEMO_ACS
  (зеркало официального Java-демо Hikvision ISUP SDK для СКУД)
- Лицензия в репозитории не указана; код является демонстрационным
  кодом Hikvision, распространяемым вместе с ISUP SDK.

## 3. Нативные библиотеки Hikvision ISUP SDK (`sdk/linux/*.so`)

Бинарные библиотеки (`libHCISUPCMS.so`, `libHCISUPAlarm.so` и зависимые
`libcrypto`, `libssl`, `HCAapSDKCom` и т.д.) — проприетарные библиотеки
**Hikvision ISUP 5.0 SDK (linux x86_64)**.

- **Источник в этом репозитории:** скопированы из
  https://github.com/oldweipro/hik-isup (`sdk/linux/`) —
  **неофициальное зеркало**. Подлежат замене на официальную поставку SDK
  с https://www.hikvision.com / https://open.hikvision.com
  (или от дистрибьютора Hikvision) перед долгосрочной эксплуатацией.
- **Контрольная сумма ключевой библиотеки:**

  ```
  sha256(libHCISUPCMS.so) = 3440f80e3d58642262d93abbdb75fc6a375ca29049cbb76c7bda92afb2300a3f
  ```

- Библиотеки принадлежат Hangzhou Hikvision Digital Technology Co., Ltd.
  и распространяются на условиях лицензионного соглашения Hikvision SDK.
