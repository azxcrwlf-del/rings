# إصلاح نظام الصور (Cloudflare R2)

## سبب المشكلة

الموقع سليم. الخطأ في الـ Workers على Cloudflare:

| العنوان | النتيجة |
|---|---|
| `khatem-ali-media/health` | 200 يعمل |
| `khatem-ali-media/media/...` | **500 error code: 1101** |
| `khatem-ali-catalog/catalog` | **500 error code: 1101** |

الـ Worker يعمل، لكنه ينفجر فقط عند لمس التخزين → **ربط R2 (R2 binding) مفقود**.
تغيير الدومين لم يسبب هذا؛ السبب إعادة نشر الـ Worker بدون الربط.

## الإصلاح — 10 دقائق

### 1) Bucket على R2
Cloudflare Dashboard → **R2** → Create bucket (إن لم يوجد):
- `khatem-ali-media`
- `khatem-ali-catalog`

### 2) Worker: khatem-ali-media
Workers & Pages → `khatem-ali-media` → **Settings → Bindings → Add → R2 bucket**
- Variable name: `MEDIA_BUCKET`
- Bucket: `khatem-ali-media`

**Settings → Variables and Secrets → Add secret**
- `ADMIN_PASSWORD` = كلمة مرور الإدارة

ثم **Edit code** → الصق محتوى `media-worker.js` بالكامل → **Deploy**.

### 3) Worker: khatem-ali-catalog
نفس الخطوات:
- R2 binding: Variable name `CATALOG_BUCKET` → Bucket `khatem-ali-catalog`
- Secret: `ADMIN_PASSWORD` = **نفس** القيمة تماماً (مهم: التوكن مشترك بين الـ Workers)
- Edit code → الصق `catalog-worker.js` → **Deploy**

### 4) التحقق
افتح في المتصفح:

- `https://khatem-ali-media.azxcrwlf.workers.dev/health`
- `https://khatem-ali-catalog.azxcrwlf.workers.dev/health`

يجب أن يظهر `"bucketBound": true` و `"secretSet": true`.
إذا ظهر `false` فالربط لم يُحفظ — أعِد الخطوة 2 أو 3.

### 5) إعادة رفع الصور القديمة
الروابط القديمة مثل `/media/products/1/image-1.jpg` كانت في bucket قديم.
إذا كان الـ bucket فارغاً: افتح `#admin` → عدّل المنتج → ارفع الصور من جديد → **احفظ** ثم **انشر**.

## ملاحظة أمنية
`admin-auth.js` في المستودع يحتوي كلمة المرور `ALI2026` مكتوبة داخل الكود ويمكن لأي زائر رؤيتها.
الموقع الحقيقي (`index.html`) لا يستخدمه — يستخدم `/auth` على الـ Worker.
يُفضّل حذف `admin-auth.js` و`admin-handler.js` من المستودع.
