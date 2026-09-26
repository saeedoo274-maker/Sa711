# REST API v1

القاعدة: `https://<DASHBOARD_URL>/api/v1` — على نفس منفذ خادم البوت (`PORT` أو `DASHBOARD_PORT`).

## المصادقة

**مفتاح API** (للأنظمة الخارجية): ينشئه مالك السيرفر بـ `/اعداد api action:create` ويظهر مرة واحدة فقط.

```
Authorization: Bearer sk_xxxxxxxxxxxxxxxxxxxxxxxx
```

- المفتاح مقيّد بسيرفر واحد، ويُخزَّن كتجزئة SHA-256 فقط.
- الإلغاء: `/اعداد api action:revoke id:<n>`.

**جلسة اللوحة**: نفس المسارات تعمل بكوكي الجلسة لمن يدير السيرفر (فحص حي بمستوى أدمن). الطلبات غير GET تحتاج ترويسة `X-CSRF-Token`.

## الصلاحيات (scopes)

| الصلاحية | تسمح بـ |
|---|---|
| `read` | معلومات السيرفر، الإعدادات (مع إخفاء الأسرار)، الأنظمة، الإحصاءات، المتصدرين، بيانات العضو |
| `read:moderation` | القضايا والتذاكر |
| `write:config` | `PATCH /config` (مسارات محددة فقط) |
| `write:features` | تشغيل/إيقاف الأنظمة |

أي صلاحية `write:*` تشمل `read`.

## الحدود

- 60 طلبًا/دقيقة لكل مفتاح (`X-RateLimit-Remaining`)، و120/دقيقة لكل IP. تجاوزها → `429` مع `Retry-After`.
- حجم الجسم ≤ 100KB (وإلا `413`). خلف وكيل عكسي فعّل `TRUST_PROXY=true` لقراءة IP الحقيقي.

## المسارات

| الطريقة | المسار | الصلاحية |
|---|---|---|
| GET | `/health` | عام |
| GET | `/guilds/:id` | read |
| GET | `/guilds/:id/config` | read |
| PATCH | `/guilds/:id/config` | write:config |
| GET | `/guilds/:id/features` | read |
| PUT | `/guilds/:id/features/:name` | write:features |
| GET | `/guilds/:id/stats?period=7d` | read |
| GET | `/guilds/:id/leaderboard/:type?period=&page=` | read |
| GET | `/guilds/:id/members/:userId` | read |
| GET | `/guilds/:id/cases?user=&limit=` | read:moderation |
| GET | `/guilds/:id/tickets?status=open\|closed` | read:moderation |

### تعديل الإعدادات

```bash
curl -X PATCH "$URL/api/v1/guilds/$GUILD/config" \
  -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  -d '{"changes":{"language":"en","welcome.channelId":"123456789012345678","tickets.cooldownMs":60000}}'
```

المسارات المسموحة فقط: `language`، `prefix`، `welcome.channelId`، `welcome.message`، `welcome.goodbye.channelId`، `levels.levelUp.channelId`، `appeals.channelId`، `suggestions.channelId`، `logs.<فئة>`، `staff.baseRoleId`، `tickets.categoryId`، `tickets.cooldownMs`، `levels.(messageXpMin|messageXpMax|voiceXpPerMinute|dailyCap|cooldownMs)`، `economy.enabled`. معرّفات القنوات والرتب تُتحقق أنها موجودة في نفس السيرفر. 1–25 تغييرًا لكل طلب، وأي خطأ يرفض الطلب كاملًا (`422`).

### الأخطاء

`{ "error": "<code>", ... }` — الرموز: `unauthorized` `invalid_key` `forbidden` `csrf` `not_found` `guild_not_found` `unsupported_version` `validation_failed` `rate_limited` `tooLarge` `badJson` `internal_error`.

### الإصدارات

كل الردود تحمل `X-API-Version: 1`. أي إصدار آخر يرد `404 unsupported_version`. التغييرات الكاسرة ستأتي في `/api/v2` مع إبقاء v1.
